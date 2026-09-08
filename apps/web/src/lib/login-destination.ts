/** Only root-relative destinations are accepted, even when an absolute URL is same-origin. */
export function loginDestination(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20\x7f]/.test(value))
    return '/';
  try {
    const origin = 'https://betterspend.invalid';
    const url = new URL(value, origin);
    if (url.origin !== origin) return '/';
    // Dot-segment normalization must not produce a protocol-relative destination.
    if (url.pathname.startsWith('//')) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
