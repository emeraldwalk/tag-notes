import type { AppSession } from '@emeraldwalk/idp-client';
import type { GlucoseStatus } from './glucose';
import { escapeHtml } from './http';

const ARROWS: Record<number, string> = { 1: '↓', 2: '↘', 3: '→', 4: '↗', 5: '↑' };

function glucoseSection(status: GlucoseStatus, timeZone: string): string {
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';
  const last = status.lastReading;
  const reading = last
    ? `${last.mgDl} mg/dL ${last.trend ? (ARROWS[last.trend] ?? '') : ''} <span class="dim">at ${escapeHtml(when(last.ts))}</span>`
    : 'No readings yet';
  const { llu } = status;
  const error = llu.lastError ? ` · error <code>${escapeHtml(llu.lastError)}</code>` : '';
  const paused = llu.backoffUntil ? ` · paused until ${escapeHtml(when(llu.backoffUntil))}` : '';
  return `<h2>Glucose</h2>
<dl>
  <dt>Last reading</dt><dd>${reading}</dd>
  <dt>LibreLinkUp</dt><dd>Last run ${escapeHtml(when(llu.lastRunAt))} · last success ${escapeHtml(when(llu.lastOkAt))}${error}${paused}</dd>
</dl>`;
}

/** Plan 07's placeholder home page, with plan 14's glucose status; plan 08 replaces it with the PWA. */
export function placeholderPage(session: AppSession, commit: string, glucose: GlucoseStatus, timeZone = 'America/Chicago'): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tracker</title>
<style>
  body { font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 2rem auto; max-width: 32rem; padding: 0 1rem; color: #1d2b24; }
  h1 { color: #2f6f4f; }
  h2 { margin-top: 2rem; font-size: 1.1rem; }
  dt { font-weight: 600; margin-top: 0.75rem; }
  dd { margin: 0; }
  code { font-size: 0.9em; user-select: all; }
  .dim { color: #6b7a72; }
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
${glucoseSection(glucose, timeZone)}
<p><a href="/auth/logout">Sign out</a></p>
<footer>Build ${escapeHtml(commit)}</footer>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
