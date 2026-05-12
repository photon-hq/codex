import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["postgres", "spectrum-ts"],
  turbopack: { root: __dirname },
};

export default config;
