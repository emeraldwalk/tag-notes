import type { AppSession } from '@emeraldwalk/idp-client';
import { escapeHtml } from './http';

/** Plan 07's placeholder home page; plan 08 replaces it with the PWA. */
export function placeholderPage(session: AppSession, commit: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tracker</title>
<style>
  body { font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 2rem auto; max-width: 32rem; padding: 0 1rem; color: #1d2b24; }
  h1 { color: #2f6f4f; }
  dt { font-weight: 600; margin-top: 0.75rem; }
  dd { margin: 0; }
  code { font-size: 0.9em; user-select: all; }
  footer { margin-top: 2rem; color: #6b7a72; font-size: 0.875rem; }
</style>
</head>
<body>
<h1>Tracker</h1>
<p>Signed in. The app moves here soon.</p>
<dl>
  <dt>Name</dt><dd>${escapeHtml(session.name)}</dd>
  <dt>User id</dt><dd><code>${escapeHtml(session.sub)}</code></dd>
</dl>
<p><a href="/auth/logout">Sign out</a></p>
<footer>Build ${escapeHtml(commit)}</footer>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
