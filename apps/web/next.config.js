/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      allowedOrigins: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim().replace(/^https?:\/\//, ""))
        : ["localhost:3000"],
    },
  },
  images: {
    domains: [],
  },
};

module.exports = nextConfig;
