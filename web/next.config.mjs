/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fully static export — the app is 100 % client-side (all RPC lands at
  // the Alephium node from the browser), so we can host it as a static
  // bundle on GitHub Pages with no server component.
  output: 'export',
  // Pages serves from /openabx/ when using the default username.github.io
  // path. Override via NEXT_PUBLIC_BASE_PATH when deploying elsewhere
  // (e.g. a custom domain at the root).
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || '',
  images: { unoptimized: true },
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  transpilePackages: ['@openabx/sdk', '@openabx/contracts'],
  // Match the revised plan's §1 stance: we do NOT ship Swap or Perps.
  env: {
    NEXT_PUBLIC_FEATURE_SWAP: 'false',
    NEXT_PUBLIC_FEATURE_PERPS: 'false',
  },
  webpack: (config, { isServer }) => {
    // `pino-pretty` is a dev-only optional dep of WalletConnect's pino logger.
    // Marking it external silences a harmless "module not found" warning.
    if (!isServer) {
      config.externals = [
        ...(config.externals || []),
        { 'pino-pretty': 'commonjs pino-pretty' },
      ]
    }
    return config
  },
}

export default nextConfig
