import { saveSettingAction } from '@/app/actions/admin';
import { ActionButton } from '@/components/admin/ActionButton';
import { AdminForm } from '@/components/admin/AdminForm';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * /admin/settings — the runtime settings from `lib/settings.ts`.
 *
 * Only keys declared in that registry are rendered or accepted, so the panel
 * can never write a setting the app does not read.
 */
export default async function AdminSettingsPage() {
  const settings = await getSettings();

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-sub">
          Stored in the database, applied within seconds, no deploy needed.
        </p>
      </div>

      <div className="space-y-4">
        {settings.map(({ definition, value, stored }) => (
          <Card key={definition.key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                {definition.label}
                <Badge variant={stored ? 'default' : 'neutral'}>
                  {stored ? 'custom' : `default: ${definition.default}`}
                </Badge>
              </CardTitle>
              <CardDescription>{definition.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <AdminForm
                action={saveSettingAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="key" value={definition.key} />

                {definition.kind === 'toggle' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <select
                      name="value"
                      defaultValue={value}
                      className="h-9 rounded-md border border-line bg-card-soft px-3 text-sm text-fg outline-none focus:border-accent"
                    >
                      <option value="on">on</option>
                      <option value="off">off</option>
                    </select>
                  </label>
                ) : definition.kind === 'number' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      name="value"
                      type="number"
                      defaultValue={value}
                      min={definition.min}
                      max={definition.max}
                      className="h-9 w-32 rounded-md border border-line bg-card-soft px-3 text-sm text-fg outline-none focus:border-accent"
                    />
                    <span className="text-xs text-sub">
                      hours ({definition.min}–{definition.max})
                    </span>
                  </label>
                ) : (
                  <input
                    name="value"
                    defaultValue={value}
                    className="h-9 min-w-[20rem] flex-1 rounded-md border border-line bg-card-soft px-3 text-sm text-fg outline-none focus:border-accent"
                  />
                )}

                <ActionButton size="default">Save</ActionButton>
              </AdminForm>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
