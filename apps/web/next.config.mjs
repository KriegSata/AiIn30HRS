import { fileURLToPath } from 'node:url';
const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Socket.IO requires /socket.io/; an HTTP slash redirect cannot complete a WebSocket upgrade.
  skipTrailingSlashRedirect: true,
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/socket.io', destination: `${api}/socket.io/` },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
};
export default nextConfig;
