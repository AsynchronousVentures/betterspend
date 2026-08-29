import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATH_PREFIXES = ['/login', '/signup', '/punchout'];
const PUBLIC_EXACT_PATHS = new Set(['/runtime-version']);

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_EXACT_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public auth pages
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for session token set by the web app after login
  const token = request.cookies.get('bs_token')?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next.js internals and public static files
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|icon-.*\\.png).*)',
  ],
};
