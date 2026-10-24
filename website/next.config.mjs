import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  reactStrictMode: true,
  // A static export has no image optimization server.
  images: { unoptimized: true },
};

export default withMDX(config);
