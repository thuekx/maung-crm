import path from "node:path";
import { fileURLToPath } from "node:url";

const isProd = process.env.NODE_ENV === "production";
// Rewrite API hanya untuk pengembangan/uji (API_URL diisi). Produksi: Caddy mengarahkan /crm/api/* langsung ke crm-api.
const API = process.env.API_URL;

// CSP dasar (produksi saja; dev butuh eval). script-src memakai 'unsafe-inline' karena hidrasi Next tanpa nonce —
// ini membatasi pemuatan skrip/sumber eksternal dan eksfiltrasi lewat connect/img/form, BUKAN pelindung XSS penuh.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export default {
  output: "standalone",
  basePath: "/crm",
  // monorepo: telusuri dependensi dari root agar standalone lengkap
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../"),
  async rewrites() {
    return API ? [{ source: "/api/:path*", destination: `${API}/crm/api/:path*` }] : [];
  },
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
    ];
    return [{ source: "/:path*", headers: isProd ? [...common, { key: "Content-Security-Policy", value: csp }] : common }];
  },
};
