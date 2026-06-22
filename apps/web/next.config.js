/** @type {import('next').NextConfig} */
const isElectron = process.env.NEXT_BUILD_TARGET === 'electron'

const nextConfig = {
  // Electron build: static export — no Node.js server, Electron serves files directly
  // Dev / web deploy: standalone server (keeps mock API routes)
  output: isElectron ? 'export' : 'standalone',
  trailingSlash: true,
  images: { unoptimized: true },
  ...(!isElectron && {
    experimental: {
      serverActions: {
        allowedOrigins: process.env.ALLOWED_ORIGINS
          ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim().replace(/^https?:\/\//, ''))
          : ['localhost:3000'],
      },
    },
  }),
}

module.exports = nextConfig
