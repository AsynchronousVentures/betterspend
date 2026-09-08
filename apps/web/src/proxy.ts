import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isPublicPath } from './lib/public-routes';
export { isPublicPath } from './lib/public-routes';

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
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
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
