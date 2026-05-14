// Shared CORS helpers for the Break Room Games leaderboard Edge Functions.
//
// Allowlist covers:
//   - GitHub Pages origin where the games are hosted today
//   - pepinc.io / www.pepinc.io for when games are embedded as Webflow custom code
//   - localhost for hand-testing
//
// Update this list as new origins are added.

const ALLOWED_ORIGINS = new Set<string>([
  "https://timothypoore-blip.github.io",
  "https://pepinc.io",
  "https://www.pepinc.io",
  "http://localhost:8000",
  "http://localhost:3000",
  "http://127.0.0.1:8000",
]);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers":
      "authorization, x-client-info, apikey, content-type",
    "access-control-max-age": "86400",
    "vary": "origin",
  };
  // Only set allow-origin if the request's origin is on the allowlist.
  // Omitting the header (vs. setting it to empty) is what causes the
  // browser to reject the response — the correct behavior for unknown
  // origins. Same-origin and non-browser callers (curl, server-to-server)
  // either send no Origin header or one that doesn't matter; both are fine.
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

export function preflightResponse(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

export function json(
  req: Request,
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "content-type": "application/json" },
  });
}
