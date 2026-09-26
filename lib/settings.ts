import { prisma } from '@/lib/prisma';

/**
 * Runtime settings an operator can change without a deploy.
 *
 * `SystemSetting` is a plain key/value table, which is flexible and unsafe at
 * the same time: a typo'd key would sit there forever doing nothing. So every
 * key the app reads is declared here, with its type, its default and the words
 * the settings page shows. The panel only edits what is in this registry.
 */

export type SettingKind = 'toggle' | 'number' | 'text';

export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  kind: SettingKind;
  default: string;
  /** For `number`: the accepted range. */
  min?: number;
  max?: number;
}

export const SETTINGS: SettingDefinition[] = [
  {
    key: 'maintenance_mode',
    label: 'Maintenance mode',
    description:
      'Visitors cannot create new shares or download files; pages still explain what is happening. Admins keep full access.',
    kind: 'toggle',
    default: 'off',
  },
  {
    key: 'maintenance_message',
    label: 'Maintenance message',
    description: 'Shown to visitors while maintenance mode is on.',
    kind: 'text',
    default:
      'Sharetofnd is being upgraded — new links and downloads are paused for a few minutes.',
  },
  {
    key: 'expired_share_retention_hours',
    label: 'Keep expired shares for',
    description:
      'How long an expired share (and its files) is kept before the cleanup job removes it. The link itself already stops working at 24 hours.',
    kind: 'number',
    default: '24',
    min: 0,
    max: 24 * 30,
  },
  {
    key: 'cleanup_enabled',
    label: 'Background cleanup',
    description:
      'Whether the scheduled cleanup endpoint deletes expired shares and orphaned files. Turn it off to inspect them first.',
    kind: 'toggle',
    default: 'on',
  },
];

const BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));

export function settingDefinition(key: string): SettingDefinition | null {
  return BY_KEY.get(key) ?? null;
}

/** Coerce whatever is in the row into the shape the definition promises. */
export function settingValue(
  key: string,
  raw: string | undefined | null,
): string {
  const definition = BY_KEY.get(key);
  const fallback = definition?.default ?? '';
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (!definition) return raw;

  switch (definition.kind) {
    case 'toggle':
      return raw === 'on' ? 'on' : 'off';
    case 'number': {
      const value = Number(raw);
      if (!Number.isFinite(value)) return fallback;
      const min = definition.min ?? Number.NEGATIVE_INFINITY;
      const max = definition.max ?? Number.POSITIVE_INFINITY;
      return String(Math.min(max, Math.max(min, Math.round(value))));
    }
    default:
      return raw.slice(0, 500);
  }
}

/** How long a cached answer may be reused. Settings change rarely. */
const CACHE_MS = 10_000;

let cache: { values: Map<string, string>; readAt: number } | null = null;

async function loadAll(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cache.readAt < CACHE_MS) return cache.values;

  const values = new Map<string, string>();
  try {
    const rows = await prisma.systemSetting.findMany({
      select: { key: true, value: true },
    });
    for (const row of rows) values.set(row.key, row.value);
  } catch (error) {
    // The database is unreachable: fall back to the declared defaults rather
    // than treating every setting as broken.
    console.warn('[settings] could not read the settings table', error);
  }
  cache = { values, readAt: now };
  return values;
}

/** The effective value of one setting (row, or the declared default). */
export async function getSetting(key: string): Promise<string> {
  const values = await loadAll();
  return settingValue(key, values.get(key));
}

/** Every setting, defaults included — what the admin panel renders. */
export async function getSettings(): Promise<
  { definition: SettingDefinition; value: string; stored: boolean }[]
> {
  const values = await loadAll();
  return SETTINGS.map((definition) => ({
    definition,
    value: settingValue(definition.key, values.get(definition.key)),
    stored: values.has(definition.key),
  }));
}

export interface SetSettingResult {
  ok: boolean;
  error?: string;
  value?: string;
}

/**
 * Write one setting. Only keys from the registry are accepted, and the value
 * is coerced to the type the registry declares — the database should never be
 * able to hold something the app cannot read.
 */
export async function setSetting(
  key: string,
  raw: string,
  updatedBy: string | null,
): Promise<SetSettingResult> {
  const definition = settingDefinition(key);
  if (!definition) return { ok: false, error: `Unknown setting "${key}".` };

  const value = settingValue(key, raw);
  try {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy },
    });
    clearSettingsCache();
    return { ok: true, value };
  } catch (error) {
    console.warn('[settings] could not write a setting', error);
    return { ok: false, error: 'Could not save that setting.' };
  }
}

export function clearSettingsCache(): void {
  cache = null;
}

export interface MaintenanceState {
  active: boolean;
  message: string;
}

/** Is the app in maintenance mode, and what should visitors be told? */
export async function maintenanceState(): Promise<MaintenanceState> {
  const [mode, message] = await Promise.all([
    getSetting('maintenance_mode'),
    getSetting('maintenance_message'),
  ]);
  return { active: mode === 'on', message };
}
