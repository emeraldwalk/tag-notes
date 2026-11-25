// Copied from family-mail's apps/app/test/fakeIdp.ts, itself from /workspaces/tools/idp/packages/idp-client/test/fake-idp.ts
// (the client's own test provider, MIT). Keep it in step with the client version in package.json.

// A scripted OpenID provider for unit tests: `globalThis.fetch` is replaced by a router that answers
// discovery, JWKS, token and session-status requests, signs ID tokens with a real ES256 key, and
// records every call. Each fake gets its own issuer, so the client's per-isolate caches never leak
// between tests.

import { vi } from 'vitest';

const enc = new TextEncoder();
const b64url = (input: Uint8Array | string) => {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let counter = 0;

export interface Call {
  method: string;
  url: string;
  path: string;
  headers: Headers;
  body: string;
}

type Override = number | 'network' | ((call: Call) => Response | Promise<Response>);

export interface FakeIdpOptions {
  /** Claims added to (or replacing) the default ID token claims. */
  claims?: Record<string, unknown>;
  /** The session status answer (default `{ active: true, acr: "basic", authTime: <now> }`). */
  status?: Record<string, unknown>;
}

export class FakeIdp {
  readonly issuer = `https://idp${++counter}.example.test`;
  readonly clientId = 'client-123';
  readonly clientSecret = 'secret-456';
  readonly calls: Call[] = [];
  claims: Record<string, unknown>;
  status: Record<string, unknown> | null;
  /** Scripted answers per path, used in order before the normal answer. */
  readonly overrides = new Map<string, Override[]>();
  /** Codes issued by `authorizeRedirect`, with what the token endpoint checks. */
  private codes = new Map<string, { nonce: string; challenge: string; redirectUri: string }>();
  private keys!: CryptoKeyPair;
  private otherKeys!: CryptoKeyPair;
  /** Sign ID tokens with a key that isn't in the JWKS. */
  signWithUnknownKey = false;
  /** Replace the nonce the token endpoint puts in the ID token. */
  nonceOverride: string | undefined;

  constructor(opts: FakeIdpOptions = {}) {
    this.claims = opts.claims ?? {};
    this.status = opts.status ?? null;
  }

  async start(): Promise<this> {
    this.keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    this.otherKeys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => this.handle(input, init));
    return this;
  }

  override(path: string, ...answers: Override[]) {
    this.overrides.set(path, [...(this.overrides.get(path) ?? []), ...answers]);
  }

  callsTo(path: string): Call[] {
    return this.calls.filter((c) => c.path === path);
  }

  metadata() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/api/auth/oauth2/authorize`,
      token_endpoint: `${this.issuer}/api/auth/oauth2/token`,
      userinfo_endpoint: `${this.issuer}/api/auth/oauth2/userinfo`,
      jwks_uri: `${this.issuer}/.well-known/jwks.json`,
      end_session_endpoint: `${this.issuer}/logout`,
      session_status_endpoint: `${this.issuer}/oidc/session-status`,
      authorization_response_iss_parameter_supported: true,
      id_token_signing_alg_values_supported: ['ES256'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      acr_values_supported: ['basic', 'strong'],
    };
  }

  /** What the provider would redirect to after the user signs in, for a login response's Location. */
  authorizeRedirect(location: string, extra: Record<string, string> = {}): string {
    const auth = new URL(location);
    const redirectUri = auth.searchParams.get('redirect_uri')!;
    const code = `code-${crypto.randomUUID()}`;
    this.codes.set(code, {
      nonce: auth.searchParams.get('nonce')!,
      challenge: auth.searchParams.get('code_challenge')!,
      redirectUri,
    });
    const back = new URL(redirectUri);
    back.searchParams.set('code', code);
    back.searchParams.set('state', auth.searchParams.get('state')!);
    back.searchParams.set('iss', this.issuer);
    for (const [k, v] of Object.entries(extra)) back.searchParams.set(k, v);
    return back.href;
  }

  private async handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body === undefined || init.body === null ? '' : String(init.body);
    const call: Call = { method: init?.method ?? 'GET', url: url.href, path: url.pathname, headers: new Headers(init?.headers), body };
    this.calls.push(call);
    if (url.origin !== this.issuer) throw new TypeError(`fetch failed: unexpected host ${url.origin}`);
    const queued = this.overrides.get(url.pathname);
    const next = queued?.shift();
    if (next !== undefined) {
      if (next === 'network') throw new TypeError('fetch failed');
      if (typeof next === 'number') return new Response(`status ${next}`, { status: next });
      return next(call);
    }
    switch (url.pathname) {
      case '/.well-known/openid-configuration':
        return Response.json(this.metadata());
      case '/.well-known/jwks.json': {
        const jwk = (await crypto.subtle.exportKey('jwk', this.keys.publicKey)) as JsonWebKey; // cast: Workers types overload exportKey
        return Response.json({ keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid: 'k1', alg: 'ES256', use: 'sig' }] });
      }
      case '/api/auth/oauth2/token':
        return this.token(call);
      case '/oidc/session-status':
        return this.sessionStatus(call);
      default:
        return new Response('not found', { status: 404 });
    }
  }

  /** HTTP Basic with form-encoded id and secret (RFC 6749 §2.3.1), as the real provider reads it. */
  private basicOk(call: Call): boolean {
    const match = /^Basic (.+)$/.exec(call.headers.get('Authorization') ?? '');
    if (!match) return false;
    const [id, secret] = atob(match[1]!).split(':').map((s) => decodeURIComponent(s.replace(/\+/g, ' ')));
    return id === this.clientId && secret === this.clientSecret;
  }

  private async token(call: Call): Promise<Response> {
    if (!this.basicOk(call)) return Response.json({ error: 'invalid_client' }, { status: 401 });
    const form = new URLSearchParams(call.body);
    const code = form.get('code') ?? '';
    const stored = this.codes.get(code);
    this.codes.delete(code);
    if (!stored || form.get('redirect_uri') !== stored.redirectUri) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(form.get('code_verifier') ?? ''))));
    if (challenge !== stored.challenge) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: this.issuer,
      aud: this.clientId,
      sub: 'user-1',
      iat: now,
      exp: now + 900,
      auth_time: now - 10,
      nonce: this.nonceOverride ?? stored.nonce,
      sid: 'sid-1',
      acr: 'basic',
      amr: ['pwd'],
      preferred_username: 'alex',
      name: 'Alex Example',
      is_managed: false,
      stay_signed_in: false,
      roles: ['tester'],
      ...this.claims,
    };
    return Response.json(
      { access_token: 'at-1', token_type: 'Bearer', expires_in: 900, id_token: await this.sign(claims) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  private async sessionStatus(call: Call): Promise<Response> {
    if (!this.basicOk(call)) return Response.json({ error: { code: 'invalid_client', message: 'x' } }, { status: 401 });
    return Response.json(this.status ?? { active: true, acr: 'basic', authTime: Math.floor(Date.now() / 1000) - 10 });
  }

  async sign(claims: Record<string, unknown>): Promise<string> {
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'JWT' }));
    const payload = b64url(JSON.stringify(claims));
    const key = this.signWithUnknownKey ? this.otherKeys.privateKey : this.keys.privateKey;
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`)));
    return `${header}.${payload}.${b64url(sig)}`;
  }
}

/** The Set-Cookie values of a response, by cookie name. */
export function setCookies(res: Response): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of res.headers.getSetCookie()) out.set(line.slice(0, line.indexOf('=')), line);
  return out;
}

/** "name=value" for a Cookie header, from a Set-Cookie line. */
export const cookiePair = (line: string) => line.split(';')[0]!;
