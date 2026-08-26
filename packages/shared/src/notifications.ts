export const NOTIFICATION_TYPE_DEFINITIONS = [
  { value: 'approval_request', label: 'Approval requests' },
  { value: 'po_issued', label: 'Purchase orders issued' },
  { value: 'invoice_exception', label: 'Invoice exceptions' },
  { value: 'invoice_approved', label: 'Invoices approved' },
  { value: 'spend_guard', label: 'Spend guard alerts' },
  { value: 'software_license', label: 'Software license renewals' },
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPE_DEFINITIONS)[number]['value'];

export const DEFAULT_NOTIFICATION_TYPES: NotificationType[] = NOTIFICATION_TYPE_DEFINITIONS.map(
  ({ value }) => value,
);

export type NotificationFrequency = 'instant' | 'daily' | 'weekly';

export type NotificationPreferences = {
  emailEnabled: boolean;
  frequency: NotificationFrequency;
  enabledTypes: string[];
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  emailEnabled: true,
  frequency: 'instant',
  enabledTypes: [...DEFAULT_NOTIFICATION_TYPES],
};

export function notificationTypeLabel(type: string): string {
  return (
    NOTIFICATION_TYPE_DEFINITIONS.find((definition) => definition.value === type)?.label ??
    type.replace(/_/g, ' ')
  );
}
