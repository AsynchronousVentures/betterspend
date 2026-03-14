'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BellRing, Monitor, Moon, Sun } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Select } from '../../components/ui/select';

type NotificationPrefs = {
  emailEnabled: boolean;
  frequency: 'instant' | 'daily' | 'weekly';
  enabledTypes: string[];
};

type AppearancePreference = 'light' | 'dark' | 'system';

const DEFAULT_PREFS: NotificationPrefs = {
  emailEnabled: true,
  frequency: 'instant',
  enabledTypes: [
    'approval_request',
    'po_issued',
    'invoice_exception',
    'invoice_approved',
    'spend_guard',
    'software_license',
  ],
};

const APPEARANCE_STORAGE_KEY = 'betterspend:appearance-preference';

const APPEARANCE_OPTIONS: Array<{
  value: AppearancePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  { value: 'system', label: 'System', description: 'Follow the device theme once alternate themes are enabled.', icon: Monitor },
  { value: 'light', label: 'Light', description: 'Prefer the light workspace palette.', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Save your dark-mode preference for future theme support.', icon: Moon },
];

function applyAppearancePreference(preference: AppearancePreference) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme =
    preference === 'system' ? '' : preference;
}

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [appearance, setAppearance] = useState<AppearancePreference>('system');
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsMessage, setPrefsMessage] = useState('');
  const [prefsError, setPrefsError] = useState('');
  const [appearanceMessage, setAppearanceMessage] = useState('');

  useEffect(() => {
    Promise.all([
      api.notifications.getPreferences().catch(() => DEFAULT_PREFS),
      api.notifications.types().catch(() => []),
    ])
      .then(([storedPrefs, types]) => {
        setPrefs({ ...DEFAULT_PREFS, ...storedPrefs });
        setAvailableTypes(types);
      })
      .finally(() => setLoadingPrefs(false));

    const storedPreference =
      typeof window !== 'undefined'
        ? (window.localStorage.getItem(APPEARANCE_STORAGE_KEY) as AppearancePreference | null)
        : null;
    const nextPreference =
      storedPreference && APPEARANCE_OPTIONS.some((option) => option.value === storedPreference)
        ? storedPreference
        : 'system';
    setAppearance(nextPreference);
    applyAppearancePreference(nextPreference);
  }, []);

  async function persistPreferences(nextPrefs: NotificationPrefs) {
    setPrefs(nextPrefs);
    setSavingPrefs(true);
    setPrefsError('');
    setPrefsMessage('');
    try {
      const saved = await api.notifications.updatePreferences(nextPrefs);
      setPrefs({ ...DEFAULT_PREFS, ...saved });
      setPrefsMessage('Notification settings updated.');
    } catch (err: any) {
      setPrefsError(err.message ?? 'Failed to save notification settings.');
    } finally {
      setSavingPrefs(false);
    }
  }

  function handleAppearanceChange(nextPreference: AppearancePreference) {
    setAppearance(nextPreference);
    setAppearanceMessage(`Appearance preference set to ${nextPreference}.`);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, nextPreference);
    }
    applyAppearancePreference(nextPreference);
  }

  const notificationTypes = availableTypes.length > 0 ? availableTypes : DEFAULT_PREFS.enabledTypes;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Settings"
        description="Manage your personal BetterSpend preferences, including notifications and saved appearance choices."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="rounded-lg">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <BellRing className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl">Notifications</CardTitle>
                <CardDescription>Choose what reaches you and how often BetterSpend sends it.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {prefsError ? (
              <Alert variant="destructive">
                <AlertDescription>{prefsError}</AlertDescription>
              </Alert>
            ) : null}
            {prefsMessage ? (
              <Alert variant="success">
                <AlertDescription>{prefsMessage}</AlertDescription>
              </Alert>
            ) : null}

            <label className="flex gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
              <input
                type="checkbox"
                checked={prefs.emailEnabled}
                disabled={loadingPrefs || savingPrefs}
                onChange={(event) => persistPreferences({ ...prefs, emailEnabled: event.target.checked })}
              />
              <div>
                <div className="text-sm font-medium text-foreground">Email notifications</div>
                <div className="text-xs text-muted-foreground">Send important updates to your inbox in addition to the in-app feed.</div>
              </div>
            </label>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Digest Frequency</div>
              <Select
                value={prefs.frequency}
                disabled={loadingPrefs || savingPrefs}
                onChange={(event) =>
                  persistPreferences({ ...prefs, frequency: event.target.value as NotificationPrefs['frequency'] })
                }
                className="w-full"
              >
                <option value="instant">Instant</option>
                <option value="daily">Daily digest</option>
                <option value="weekly">Weekly digest</option>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Enabled Types</div>
              <div className="grid gap-2">
                {notificationTypes.map((type) => (
                  <label key={type} className="flex items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={prefs.enabledTypes.includes(type)}
                      disabled={loadingPrefs || savingPrefs}
                      onChange={(event) => {
                        const enabledTypes = event.target.checked
                          ? [...prefs.enabledTypes, type]
                          : prefs.enabledTypes.filter((item) => item !== type);
                        void persistPreferences({ ...prefs, enabledTypes });
                      }}
                    />
                    <span className="capitalize">{type.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/70 pt-4">
              <div className="text-sm text-muted-foreground">Need the full feed and read status controls?</div>
              <Button asChild variant="outline">
                <Link href="/notifications">Open Notifications</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Appearance</CardTitle>
              <CardDescription>Save your preferred theme mode for this device.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {APPEARANCE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = appearance === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleAppearanceChange(option.value)}
                    className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                      selected
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border/70 bg-background hover:bg-muted/30'
                    }`}
                  >
                    <div className={`rounded-full p-2 ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{option.label}</div>
                      <div className="text-xs leading-5 text-muted-foreground">{option.description}</div>
                    </div>
                  </button>
                );
              })}

              <Alert>
                <AlertDescription>
                  Theme selection is stored now so the account-level preference is ready when alternate visual themes ship.
                </AlertDescription>
              </Alert>
              {appearanceMessage ? (
                <div className="text-xs text-muted-foreground">{appearanceMessage}</div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Account</CardTitle>
              <CardDescription>Profile details and security settings stay on your account page.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                Update your name, photo, email, and password from the profile screen.
              </div>
              <Button asChild variant="outline">
                <Link href="/profile">Open Profile</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
