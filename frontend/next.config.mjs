/** @type {import('next').NextConfig} */
const apiInternalUrl = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function connectSrc() {
  const origins = new Set(["'self'"]);
  const publicApi = process.env.NEXT_PUBLIC_API_URL;
  if (publicApi) {
    try {
      origins.add(new URL(publicApi).origin);
    } catch {
      /* ignore invalid URL */
    }
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:8000");
    origins.add("http://127.0.0.1:8000");
  }
  return [...origins].join(" ");
}

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSrc()}`,
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
