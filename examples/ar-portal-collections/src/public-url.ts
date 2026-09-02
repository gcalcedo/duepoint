/**
 * Solari sandbox preview URLs are gated by a short-lived `pt_token`. The first request with the
 * token sets an HttpOnly cookie for the origin, after which same-origin navigation and fetches
 * work without it — so every URL we hand to a browser carries the token, and the pages' own
 * relative fetches ride on the cookie.
 */
export interface PublicTarget {
  baseUrl: string
  accessToken?: string
}

/** Live preview token — refreshed by the server while it runs (tokens last ~1h). */
export const previewAuth: { token?: string } = {}

export function publicUrl(target: PublicTarget, path: string): string {
  const url = new URL(path, target.baseUrl.endsWith("/") ? target.baseUrl : `${target.baseUrl}/`)
  const token = target.accessToken ?? previewAuth.token
  if (token) url.searchParams.set("pt_token", token)
  return url.toString()
}

/** Keep preview tokens and long Solari session ids out of logs and the activity feed. */
export function redactToken(text: string): string {
  return text
    .replace(/pt_token=[^&"'\s)]+/g, "pt_token=…")
    .replace(/"sessionId":"([^"]{12})[^"]*"/g, '"sessionId":"$1…"')
}
