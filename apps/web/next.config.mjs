import path from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.API_URL ?? "http://localhost:4100";
export default {
  output: "standalone",
  // monorepo: telusuri dependensi dari root agar standalone lengkap
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../"),
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
