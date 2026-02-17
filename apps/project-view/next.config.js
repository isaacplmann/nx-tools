/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not bundle sqlite3 (native .node bindings); load at runtime on server
  serverExternalPackages: ['sqlite3'],
};

module.exports = nextConfig;
