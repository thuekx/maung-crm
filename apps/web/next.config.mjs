const API = process.env.API_URL ?? "http://localhost:4100";
export default {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
