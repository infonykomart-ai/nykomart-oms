import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist (courier-bill PDF parsing, src/lib/courier-bills/pdf-layout.ts)
  // must NOT be webpack-bundled — its legacy Node build does its own runtime
  // conditional requires that break under bundling. Left external, Node
  // requires it natively at runtime, same as it works under plain `node`.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // pdfjs-dist's main module loads pdf.worker.mjs itself via a runtime-
  // computed path (not a literal import), so Next's output file tracer
  // can't discover it and leaves it out of the deployed function bundle —
  // surfaced on Vercel as "Cannot find module '.../pdf.worker.mjs'" even
  // though pdf.mjs itself loads fine. Force it into the bundle explicitly.
  outputFileTracingIncludes: {
    "/dashboard/documents": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
