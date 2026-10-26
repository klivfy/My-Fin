import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * CSP estática (sem nonce): `'unsafe-inline'` em script-src é exigência do
 * boot do Next.js App Router (inline Flight scripts); para CSP estrita com
 * nonce por request seria preciso renderização 100% dinâmica, o que o
 * deploy estático no Netlify não faz. Ainda assim a política abaixo bloqueia
 * object/embed, framing externo e formulários para origens terceiras.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`, // unsafe-eval: só em dev (React debugging)
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS só faz sentido (e só é honrado) sob HTTPS — nunca em dev local.
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
