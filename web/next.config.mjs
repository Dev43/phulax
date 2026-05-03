/** @type {import('next').NextConfig} */
import path from "node:path";
import { fileURLToPath } from "node:url";

// basePath is baked at build time. Dev runs at "/" (env unset). The single-box
// deploy bakes "/web" via deploy/Dockerfile.web's --build-arg so Caddy can
// path-mount the dashboard alongside KeeperHub at the apex.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  basePath,
  assetPrefix: basePath || undefined,
  // Standalone output bundles only the modules actually imported by the app.
  output: "standalone",
  // Trace from the monorepo root so the bundle picks up the *real* files
  // behind pnpm's `node_modules/.pnpm/<pkg>/...` symlinks. Without this,
  // Next defaults to the workspace dir (web/) and the standalone output
  // ships symlinks pointing at a `.pnpm` store that doesn't exist in the
  // image — `require('next')` then fails with MODULE_NOT_FOUND at startup.
  outputFileTracingRoot: path.join(here, ".."),
};

export default nextConfig;
