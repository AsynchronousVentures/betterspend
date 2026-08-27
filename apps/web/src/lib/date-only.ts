function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

/** Formats an API date column as the same local calendar date the user entered. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  return parseDateOnly(value)?.toLocaleDateString() ?? '—';
}

/** Compares date-only values by local calendar day, not by a UTC timestamp. */
export function isDateOnlyBeforeToday(value: string | null | undefined, now = new Date()): boolean {
  if (!value) return false;
  const date = parseDateOnly(value);
  if (!date) return false;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date < today;
}
