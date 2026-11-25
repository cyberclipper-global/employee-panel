/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Baseline security headers for every page and API route.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), microphone=(self)' },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    // Handle Node.js modules in browser environment
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        buffer: false,
        crypto: false,
        stream: false,
        util: false,
        url: false,
        querystring: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        events: false,
        punycode: false,
        string_decoder: false,
        tty: false,
        domain: false,
        constants: false,
        vm: false,
        module: false,
        _stream_duplex: false,
        _stream_passthrough: false,
        _stream_readable: false,
        _stream_transform: false,
        _stream_writable: false,
      };
    }
    
    return config;
  },
};

export default nextConfig;
