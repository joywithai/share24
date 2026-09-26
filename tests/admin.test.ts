import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The admin panel's own guards, the settings registry and the cleanup helpers.
 *
 * The database is mocked — what matters here is the *decision* each piece
 * makes: who may act, which values are storable, and which files the cleanup
 * job is allowed to touch.
 */

const userFindUnique = vi.fn();
const adminLogCreate = vi.fn();
const systemSettingFindMany = vi.fn();
const systemSettingUpsert = vi.fn();
const getSession = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) =>
        (userFindUnique as (...rest: unknown[]) => unknown)(...args),
    },
    adminLog: { create: (...args: unknown[]) => adminLogCreate(...args) },
    systemSetting: {
      findMany: () => systemSettingFindMany(),
      upsert: (...args: unknown[]) =>
        (systemSettingUpsert as (...rest: unknown[]) => unknown)(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getSession: () => getSession(),
}));

const { currentAdmin, isAdmin, pageInfo, searchTerm, shortDateTime } =
  await import('@/lib/admin');
const {
  clearSettingsCache,
  getSetting,
  getSettings,
  maintenanceState,
  SETTINGS,
  setSetting,
  settingValue,
} = await import('@/lib/settings');

afterEach(() => {
  vi.clearAllMocks();
  clearSettingsCache();
});

const adminRow = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@sharetofnd.dev',
  role: 'admin',
  status: 'active',
};

describe('currentAdmin', () => {
  it('returns the account for an active administrator', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1' } });
    userFindUnique.mockResolvedValue(adminRow);

    expect(await currentAdmin()).toEqual(adminRow);
  });

  it('refuses an anonymous visitor', async () => {
    getSession.mockResolvedValue(null);
    expect(await currentAdmin()).toBeNull();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('refuses a signed-in non-admin', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });
    userFindUnique.mockResolvedValue({ ...adminRow, role: 'user' });
    expect(await currentAdmin()).toBeNull();
  });

  it('refuses a suspended administrator', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1' } });
    userFindUnique.mockResolvedValue({ ...adminRow, status: 'suspended' });
    expect(await currentAdmin()).toBeNull();
  });

  it('refuses a session whose account is gone', async () => {
    getSession.mockResolvedValue({ user: { id: 'ghost' } });
    userFindUnique.mockResolvedValue(null);
    expect(await currentAdmin()).toBeNull();
  });
});

describe('isAdmin', () => {
  it('is true only for the admin role', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
    expect(isAdmin({ role: 'user' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe('pageInfo', () => {
  it('clamps the page into range', () => {
    expect(pageInfo(undefined, 10, 25)).toMatchObject({ page: 1, pages: 1 });
    expect(pageInfo('3', 100, 25)).toMatchObject({ page: 3, skip: 50 });
    expect(pageInfo('99', 100, 25)).toMatchObject({ page: 4, skip: 75 });
    expect(pageInfo('-4', 100, 25)).toMatchObject({ page: 1, skip: 0 });
    expect(pageInfo('nonsense', 100, 25)).toMatchObject({ page: 1, skip: 0 });
  });

  it('never reports zero pages, even for an empty table', () => {
    expect(pageInfo('1', 0, 25).pages).toBe(1);
  });
});

describe('searchTerm', () => {
  it('trims, caps and unwraps array params', () => {
    expect(searchTerm('  hello  ')).toBe('hello');
    expect(searchTerm(['first', 'second'])).toBe('first');
    expect(searchTerm(undefined)).toBe('');
    expect(searchTerm('x'.repeat(200))).toHaveLength(80);
  });
});

describe('shortDateTime', () => {
  it('renders a stable, sortable string', () => {
    expect(shortDateTime(new Date('2026-09-26T12:34:56Z'))).toBe(
      '2026-09-26 12:34',
    );
    expect(shortDateTime('2026-01-02T03:04:05Z')).toBe('2026-01-02 03:04');
  });
});

describe('settingValue', () => {
  it('falls back to the declared default', () => {
    expect(settingValue('maintenance_mode', undefined)).toBe('off');
    expect(settingValue('maintenance_mode', '')).toBe('off');
    expect(settingValue('expired_share_retention_hours', null)).toBe('24');
  });

  it('keeps toggles to on/off', () => {
    expect(settingValue('maintenance_mode', 'on')).toBe('on');
    expect(settingValue('maintenance_mode', 'ON')).toBe('off');
    expect(settingValue('maintenance_mode', 'yes')).toBe('off');
  });

  it('clamps numbers into their declared range', () => {
    expect(settingValue('expired_share_retention_hours', '72')).toBe('72');
    expect(settingValue('expired_share_retention_hours', '99999')).toBe(
      String(24 * 30),
    );
    expect(settingValue('expired_share_retention_hours', '-4')).toBe('0');
    expect(settingValue('expired_share_retention_hours', 'abc')).toBe('24');
    expect(settingValue('expired_share_retention_hours', '12.7')).toBe('13');
  });

  it('caps free text', () => {
    expect(settingValue('maintenance_message', 'x'.repeat(900))).toHaveLength(
      500,
    );
  });

  it('passes through an unknown key untouched (nothing reads it anyway)', () => {
    expect(settingValue('not_a_setting', 'value')).toBe('value');
  });
});

describe('settings reads and writes', () => {
  it('reads stored values, defaults for the rest', async () => {
    systemSettingFindMany.mockResolvedValue([
      { key: 'maintenance_mode', value: 'on' },
    ]);

    expect(await getSetting('maintenance_mode')).toBe('on');
    expect(await getSetting('cleanup_enabled')).toBe('on');
    expect((await maintenanceState()).active).toBe(true);
  });

  it('never leaks a value the app cannot read', async () => {
    systemSettingFindMany.mockResolvedValue([
      { key: 'expired_share_retention_hours', value: 'not-a-number' },
    ]);
    expect(await getSetting('expired_share_retention_hours')).toBe('24');
  });

  it('falls back to defaults when the table cannot be read', async () => {
    systemSettingFindMany.mockRejectedValue(new Error('connection refused'));
    expect(await getSetting('maintenance_mode')).toBe('off');
  });

  it('writes only declared keys, with a coerced value', async () => {
    systemSettingUpsert.mockResolvedValue({});

    const unknown = await setSetting('evil_key', 'x', 'admin@example.com');
    expect(unknown.ok).toBe(false);
    expect(systemSettingUpsert).not.toHaveBeenCalled();

    const ok = await setSetting(
      'expired_share_retention_hours',
      '99999',
      'admin@example.com',
    );
    expect(ok).toEqual({ ok: true, value: String(24 * 30) });
    expect(systemSettingUpsert.mock.calls[0][0]).toMatchObject({
      where: { key: 'expired_share_retention_hours' },
      update: { value: String(24 * 30), updatedBy: 'admin@example.com' },
    });
  });

  it('reports a write failure instead of pretending', async () => {
    systemSettingUpsert.mockRejectedValue(new Error('read-only'));
    const result = await setSetting('maintenance_mode', 'on', null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not save/i);
  });

  it('lists every declared setting for the panel', async () => {
    systemSettingFindMany.mockResolvedValue([]);
    const rows = await getSettings();

    expect(rows).toHaveLength(SETTINGS.length);
    expect(rows.map((row) => row.definition.key)).toContain('maintenance_mode');
    expect(rows.every((row) => row.stored === false)).toBe(true);
  });
});
