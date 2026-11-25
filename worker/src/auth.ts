import { type AuthClient, createAuthClient } from '@emeraldwalk/idp-client';

export const ORIGIN = 'https://tracker.ingles.place';
export const SESSION_COOKIE = 'tracker_session';
/** Owner's choice (2026-11-24): 30 days without use, 30 days at most. Re-sign-in is silent while the IdP session lasts. */
export const SESSION_SECONDS = 30 * 86_400;

export interface AuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  cookieSecret: string;
  origin?: string;
}

export function createTrackerAuth(config: AuthConfig): AuthClient {
  const origin = config.origin ?? ORIGIN;
  return createAuthClient({
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    cookieSecret: config.cookieSecret,
    redirectUri: `${origin}/auth/callback`,
    postLogoutRedirectUri: `${origin}/`,
    cookieName: SESSION_COOKIE,
    session: { idleSeconds: SESSION_SECONDS, maxSeconds: SESSION_SECONDS },
  });
}
