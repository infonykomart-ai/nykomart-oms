import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist (courier-bill PDF parsing, src/lib/courier-bills/pdf-layout.ts)
  // must NOT be webpack-bundled — its legacy Node build does its own runtime
  // conditional requires that break under bundling. Left external, Node
  // requires it natively at runtime, same as it works under plain `node`.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
