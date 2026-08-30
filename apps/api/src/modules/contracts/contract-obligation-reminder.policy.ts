export const CONTRACT_OBLIGATION_REMINDER_JOB_NAME = 'scan-due-obligations';
export const CONTRACT_OBLIGATION_REMINDER_JOB_ID = 'contract-obligation-reminders-daily';
export const CONTRACT_OBLIGATION_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CONTRACT_OBLIGATION_REMINDER_ATTEMPTS = 5;
export const CONTRACT_OBLIGATION_REMINDER_TYPE = 'contract_obligation';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const NOTIFICATION_TITLE_MAX_LENGTH = 255;
const CONTRACT_OBLIGATION_REMINDER_TITLE_PREFIX = 'Contract obligation due: ';

/** Compose a readable notification title without splitting Unicode graphemes. */
export function contractObligationReminderTitle(obligationTitle: string) {
  const availableLength =
    NOTIFICATION_TITLE_MAX_LENGTH - Array.from(CONTRACT_OBLIGATION_REMINDER_TITLE_PREFIX).length;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let title = '';
  let length = 0;

  for (const { segment } of segmenter.segment(obligationTitle)) {
    const segmentLength = Array.from(segment).length;
    if (length + segmentLength > availableLength) break;
    title += segment;
    length += segmentLength;
  }

  return `${CONTRACT_OBLIGATION_REMINDER_TITLE_PREFIX}${title}`;
}

/** A reminder becomes eligible at the due date minus its configured lead window. */
export function isContractObligationReminderDue(
  dueDate: Date | null | undefined,
  notificationLeadDays: number,
  now: Date,
) {
  const dueAt = dueDate?.getTime() ?? Number.NaN;
  const nowAt = now.getTime();
  if (
    !Number.isFinite(dueAt) ||
    !Number.isFinite(nowAt) ||
    !Number.isFinite(notificationLeadDays)
  ) {
    return false;
  }

  return dueAt - notificationLeadDays * MILLISECONDS_PER_DAY <= nowAt;
}

/** Resolve ownership without crossing the organization boundary. */
export function resolveContractObligationOwner(
  obligationOwnerId: string | null | undefined,
  contractOwnerId: string | null | undefined,
  createdById: string | null | undefined,
) {
  return obligationOwnerId ?? contractOwnerId ?? createdById ?? null;
}

/** Keep one notification for each obligation due-date schedule and recipient. */
export function contractObligationReminderIdempotencyKey(
  organizationId: string,
  obligationId: string,
  dueDate: Date,
  ownerId: string,
) {
  return `contract-obligation-reminder:${organizationId}:${obligationId}:${dueDate.toISOString()}:${ownerId}`;
}
