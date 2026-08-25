import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * 2026-08-25 — shared tile used for every "grid of things you can go do"
 * screen (home dashboard, HR Letters hub). Replaces each page's own
 * hand-rolled `<Link className="group rounded-xl border border-slate-200
 * bg-white p-5 shadow-sm ...">` card, which is where the complained-about
 * description text lived. Per the user's explicit ask — "button ki
 * descreption jahabhi likhi ho usko remove karna ahi" — this component takes
 * only an icon and a label, on purpose: there is no `description` prop to
 * pass one in even by accident. `CAPABILITY_INFO`/`LETTER_TEMPLATES` keep
 * their `description` fields (still used elsewhere, e.g. as future tooltip
 * copy), the tile itself just never renders them.
 *
 * Built on the `.oms-tile` / `.oms-tile-icon` / `.oms-tile-enter` classes in
 * globals.css — theme-token-based (correct in all 5 dashboard themes) with
 * the hover-lift + press-down motion the user asked for ("button style &
 * page style motion button triger"). `index` staggers each tile's entrance
 * animation via the `--oms-tile-i` custom property the CSS reads.
 */
export function NavTile({
  href,
  icon,
  label,
  index = 0,
  prefetch,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  index?: number;
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className="oms-tile oms-tile-enter group"
      style={{ "--oms-tile-i": index } as CSSProperties}
    >
      <div className="oms-tile-icon mb-3 text-xl">{icon}</div>
      <h3 className="font-semibold text-[var(--oms-text)] transition-colors group-hover:text-[var(--oms-accent)]">
        {label}
      </h3>
    </Link>
  );
}

export function NavTileGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
