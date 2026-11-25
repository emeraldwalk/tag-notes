/** JSON error in the API's shape: `{ "error": "<code>" }`, never cached. */
export function jsonError(status: number, code: string): Response {
  return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Copies a response with extra Set-Cookie lines (session refreshes from the IdP client). */
export function withCookie(response: Response, setCookie: string | undefined): Response {
  if (!setCookie) return response;
  const out = new Response(response.body, response);
  out.headers.append('Set-Cookie', setCookie);
  return out;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
