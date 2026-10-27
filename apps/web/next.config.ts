import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  transpilePackages: ['@superapp/rides','@superapp/food','@superapp/database'],
  // DB driver stays in the Node.js runtime; never import from client components.
  serverExternalPackages: ['pg', '@prisma/adapter-pg'],
};
export default nextConfig;
