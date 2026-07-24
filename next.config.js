/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'finaclzgxelyyaxoioyh.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // ONWARD fitness app (static PWA in public/onward-em1998). Real files
  // (_expo assets, icons, manifest) are served first; any client-side route
  // falls through to the app's index.html. `afterFiles` = assets win.
  async rewrites() {
    return {
      afterFiles: [
        { source: '/onward-em1998', destination: '/onward-em1998/index.html' },
        { source: '/onward-em1998/:path*', destination: '/onward-em1998/index.html' },
      ],
    };
  },
};

export default nextConfig;