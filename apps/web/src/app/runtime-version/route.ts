import { resolveReleaseVersion } from '@betterspend/shared';
import { NextResponse } from 'next/server';
import { appReleaseVersion } from '../../lib/release';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  const version = resolveReleaseVersion(process.env.APP_VERSION, appReleaseVersion);
  const response = NextResponse.json({ version });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
