import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname),
  // Every response: no framing by other sites (practice keys live in the browser and pages have one-tap money
  // actions), no MIME sniffing, a trimmed referrer, and no camera, microphone or location. Passkeys stay allowed for
  // the page itself. Only frame-ancestors is set in the CSP: Privy, WalletConnect and inline styles need the rest open.
  // The passkey-only mirror (mera.segundo.world) carries the same pages, so search engines index segundo.world only.
  // The Android app: Android reads assetlinks.json to let it open segundo.world full screen, and the APK downloads
  // as a file rather than opening as text.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
          },
        ],
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "mera\\..*" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      {
        source: "/.well-known/assetlinks.json",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        source: "/segundo.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: 'attachment; filename="segundo.apk"' },
        ],
      },
    ];
  },
};

export default config;
