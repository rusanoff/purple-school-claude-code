import path from 'node:path';
import type { NextConfig } from 'next';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  // Proxy API calls to the NestJS backend so the browser only ever talks to
  // this origin — that keeps the backend free of any CORS configuration.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
