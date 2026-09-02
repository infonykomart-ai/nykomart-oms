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
  // 2026-09-02: order-whatsapp-image/route.ts reads 2 .ttf files from
  // src/lib/fonts/ at request time via fs.readFileSync (see that route's
  // header comment — @napi-rs/canvas font registration, fontconfig-free
  // text rendering). Next's output tracer follows literal `import`s, not
  // a runtime-computed fs path, so — same reasoning as the pdf.worker.mjs
  // entry above — it has to be listed explicitly or Vercel deploys the
  // function without the fonts and every glyph silently goes missing
  // again.
  outputFileTracingIncludes: {
    "/dashboard/documents": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/order-whatsapp-image": ["./src/lib/fonts/*.ttf"],
  },
  // 2026-08-14: Direct Messaging (src/app/dashboard/messages) lets an
  // employee attach one file/image per message via a Server Action —
  // Next's default Server Action body-size cap is 1MB, too small for a
  // real photo. Raised to 10MB (matches the server-side check in
  // sendMessage() in messages/actions.ts — keep both in sync if changed).
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
