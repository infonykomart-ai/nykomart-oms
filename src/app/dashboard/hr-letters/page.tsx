import { requireCapability } from "@/lib/auth/require-capability";
import { NavTile, NavTileGrid } from "@/components/nav-tile";
import { LETTER_TEMPLATES } from "@/lib/hr-letters/templates";

/**
 * HR Letters hub — item 7/8/9. Certificates (item 9) and all 7 letter
 * templates (item 8, from HR_Letters_Certificates_Company_Policy.docx) are
 * live here. Company Policy Handbook (docx section 8) is a static
 * per-company reference doc, not a per-employee generated letter — it gets
 * its own simple page next rather than the generic letter-form flow.
 */
export default async function HrLettersHubPage() {
  await requireCapability("hr_letters");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">HR Letters</h1>
        <p className="mt-1 text-sm text-slate-500">
          You always get a chance to edit any letter or certificate before printing or sending it — nothing goes
          straight to &ldquo;ready to print&rdquo;.
        </p>
      </div>

      <NavTileGrid>
        <NavTile href="/dashboard/hr-letters/certificates" icon="🏆" label="Certificates" index={0} />

        {LETTER_TEMPLATES.map((t, i) => (
          <NavTile key={t.slug} href={`/dashboard/hr-letters/${t.slug}`} icon={t.icon} label={t.title} index={i + 1} />
        ))}

        <NavTile
          href="/dashboard/hr-letters/policy-handbook"
          icon="📘"
          label="Company Policy Handbook"
          index={LETTER_TEMPLATES.length + 1}
        />

        {/* 2026-08-27 — "record kese dikhega, kaha par mantain hoyega sab
            dikhe": the issued-letters log, one click from the hub. */}
        <NavTile
          href="/dashboard/hr-letters/records"
          icon="📋"
          label="Issued Letters Record"
          index={LETTER_TEMPLATES.length + 2}
        />
      </NavTileGrid>
    </div>
  );
}
