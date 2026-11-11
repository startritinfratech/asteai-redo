/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@asteai/types'],
  env: {
    // Always inlined (as 'true' or 'false'), so `process.env.NEXT_PUBLIC_DEMO_LOGIN === 'true'`
    // is a build-time constant and the sign-in page's demo-accounts import is dropped from a
    // production build without the flag (see app/auth/login/LoginForm.tsx).
    NEXT_PUBLIC_DEMO_LOGIN: process.env.NEXT_PUBLIC_DEMO_LOGIN === 'true' ? 'true' : 'false',
  },
  experimental: {
    // App Router is the default in Next 14
  },
  images: {
    domains: ['asteai.com'],
  },
  async rewrites() {
    return [
      {
        // Proxy all /api/v1/* calls to the NestJS backend during development
        source: '/api/v1/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
