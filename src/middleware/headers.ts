import type { Env } from "../types";

const HTML_CSP = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

export function applySecurityHeaders(
  response: Response,
  request: Request,
  env: Pick<Env, "ENVIRONMENT">,
): Response {
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  const isHttps = url.protocol === "https:" || env.ENVIRONMENT !== "local";

  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "referrer-policy",
    url.pathname.startsWith("/auth/") ? "no-referrer" : "same-origin",
  );
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");

  if (isHttps) {
    headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }

  const contentType = headers.get("content-type") ?? "";
  if (contentType.toLowerCase().startsWith("text/html")) {
    headers.set("x-frame-options", "DENY");
    if (!headers.has("content-security-policy")) {
      headers.set("content-security-policy", HTML_CSP);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
