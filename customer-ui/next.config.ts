import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Customer UI runs on port 3002 (set via --port in package.json scripts).
  // BACKEND_URL points to the tenant-core server (default: http://localhost:4000).
};

export default nextConfig;
