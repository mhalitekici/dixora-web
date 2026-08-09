import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * HTTPS-only hardening (HSTS + upgrade-insecure-requests).
 *
 * On by default in production, but a POS is sometimes served over plain HTTP on
 * a venue's local network, where these directives would break every request.
 * Set WEB_FORCE_HTTPS=false for that deployment shape.
 */
const forceHttps = isProduction && process.env.WEB_FORCE_HTTPS !== "false";

/**
 * Content-Security-Policy for the whole app.
 *
 * Next.js inlines hydration data and its style runtime, so 'unsafe-inline' is
 * required for scripts and styles until a nonce-based setup is introduced —
 * every other directive is kept explicit rather than falling back to '*'.
 * `connect-src` must cover the API origin and both ws/wss for live updates.
 */
function contentSecurityPolicy(): string {
  // Only absolute values matter here: the defaults are same-origin paths that
  // 'self' already covers. Deployments that point these at another host must
  // have that host in the policy or live updates and media silently break.
  const origins = [
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_WS_URL,
    process.env.NEXT_PUBLIC_MEDIA_URL,
  ]
    .filter((value): value is string => Boolean(value && /^(https?|wss?):\/\//.test(value)))
    .map((value) => new URL(value).origin);

  const connect = ["'self'", ...origins, "ws:", "wss:"].join(" ");
  const media = ["'self'", "data:", "blob:", ...origins].join(" ");
  const directives = [
    "default-src 'self'",
    // 'unsafe-eval' is only tolerated in dev, where React refresh needs it.
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    // data:/blob: cover QR codes and locally cropped image previews.
    `img-src ${media}`,
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (forceHttps) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/v1/media/:objectKey*",
        destination: "/api/backend/media/:objectKey*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:workspace(admin|waiter|cashier|kitchen|super-admin)/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(self)",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          // Only meaningful over HTTPS, and actively harmful on a plain-HTTP
          // local setup, so it is production-only.
          ...(forceHttps
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
