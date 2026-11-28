import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const scriptPolicy = process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co"
      : "script-src 'self' 'unsafe-inline' https://js.paystack.co";
    const securityHeaders = [
      { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://checkout.paystack.com; object-src 'none'; img-src 'self' data: blob: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; ${scriptPolicy}; connect-src 'self' https://*.convex.cloud https://*.convex.site wss://*.convex.cloud https://api.cloudinary.com; frame-src https://checkout.paystack.com; media-src 'self' blob: https:; upgrade-insecure-requests` },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(self)" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    ];
    const metaHeaders = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      { key: "Content-Security-Policy", value: securityHeaders[0].value.replace(scriptPolicy, `${scriptPolicy} https://connect.facebook.net`).replace("https://api.cloudinary.com;", "https://api.cloudinary.com https://www.facebook.com https://graph.facebook.com https://connect.facebook.net;").replace("frame-src https://checkout.paystack.com;", "frame-src https://checkout.paystack.com https://www.facebook.com https://web.facebook.com;") },
    ];
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/onboarding/connect", headers: metaHeaders },
      { source: "/settings", headers: metaHeaders },
    ];
  },
};

export default nextConfig;
