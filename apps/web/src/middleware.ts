import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_HINT_COOKIE, sessionRedirect } from '@/lib/sessionGate';

/** Signed-out visitors to /platform/* go straight to sign-in (see lib/sessionGate). */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const target = sessionRedirect(pathname, search, req.cookies.has(SESSION_HINT_COOKIE));
  return target ? NextResponse.redirect(new URL(target, req.url)) : NextResponse.next();
}

export const config = { matcher: ['/platform', '/platform/:path*'] };
