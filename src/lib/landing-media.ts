import fs from "node:fs";
import path from "node:path";

// 2026-10-16 — Owner-supplied brand artwork for the landing page's showcase
// strip. The landing page works completely without these files (every other
// visual on the page is drawn in CSS/WebGL), so this only ever ADDS images:
// drop any .png/.jpg/.webp/.avif into public/landing/ and the showcase
// section appears with them on the next render (dev) or next deploy.
// Nothing is hardcoded to a path that may not exist, which is also why the
// page can't ship a broken image.
const LANDING_DIR = path.join(process.cwd(), "public", "landing");
const IMAGE_FILE = /\.(png|jpe?g|webp|avif)$/i;

export type LandingImage = { src: string; caption: string };

// Captions for the artwork the owner actually sent, matched on the file name
// without its extension ("security-shield.png" → the security line). Any
// other file still gets a readable, humanized name instead of a raw one.
const CAPTIONS: Record<string, string> = {
  "security-shield": "Security first — encrypted, permissioned, audited",
  cloud: "Hosted infrastructure and scheduled jobs, no server to babysit",
  "cloud-infra": "Hosted infrastructure and scheduled jobs, no server to babysit",
  innovation: "Automation that keeps the process improving",
  "global-logistics": "Global freight — air, sea and last mile",
  storefront: "Marketplaces and the website selling as one business",
  devices: "The same data on the office desktop and the floor phone",
  support: "Support that answers — every order, punch and bill is traceable",
  growth: "Targets and growth on one dashboard",
  office: "One operations team across three companies",
};

function humanize(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function landingImages(): LandingImage[] {
  try {
    return fs
      .readdirSync(LANDING_DIR)
      .filter((file) => IMAGE_FILE.test(file))
      .sort()
      .map((file) => ({
        src: `/landing/${encodeURIComponent(file)}`,
        caption: CAPTIONS[file.replace(/\.[^.]+$/, "").toLowerCase()] ?? humanize(file),
      }));
  } catch {
    // public/landing/ simply doesn't exist yet — the showcase stays hidden.
    return [];
  }
}
