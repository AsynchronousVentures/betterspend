const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/signup',
  '/punchout',
  '/forgot-password',
  '/reset-password',
  '/vendor-portal',
  '/account/verify-email',
];

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/runtime-version' ||
    PUBLIC_PATH_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}
