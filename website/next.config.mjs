import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  reactStrictMode: true,
  // Every page exports as folder/index.html, which any static host serves.
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  // A static export has no image optimization server.
  images: { unoptimized: true },
};

export default withMDX(config);
