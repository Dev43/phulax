/** @type {import('next').NextConfig} */
// basePath is baked at build time. Dev runs at "/" (env unset). The single-box
// deploy bakes "/web" via deploy/Dockerfile.web's --build-arg so Caddy can
// path-mount the dashboard alongside KeeperHub at the apex.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig = {
  reactStrictMode: true,
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
