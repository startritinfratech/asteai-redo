const { HOST_REDIRECTS, LEGACY_REDIRECTS } = require('./redirects');
const { buildSecurityHeaders } = require('./securityHeaders');

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
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: buildSecurityHeaders({
        apiUrl: process.env.NEXT_PUBLIC_API_URL,
        wsUrl: process.env.NEXT_PUBLIC_WS_URL,
        // e.g. https://asteai-resumes.s3.ap-south-1.amazonaws.com (résumé uploads go straight to S3)
        uploadUrl: process.env.NEXT_PUBLIC_RESUME_UPLOAD_ORIGIN,
        dev: process.env.NODE_ENV !== 'production',
      }),
    }];
  },
  async redirects() {
    return [...HOST_REDIRECTS, ...LEGACY_REDIRECTS];
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
