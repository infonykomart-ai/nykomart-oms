"use server";

// 2026-09-05 — AI Companion per-employee access toggle. "YE ADMIN KE PASS
// POWER HO KIS KIS EMPLOYEE KO YE FEATURE APPROVE KARNA HAI" — deliberately
// a plain per-employee column (employees.companion_enabled), not a role
// grant; see db/2026-09-05-ai-companion-live.sql's header comment for why
// this is a one-off deviation from the rest of this codebase's role-based
// permission system. Mirrors toggleRoleCapability's own shape
// (admin/permissions/actions.ts) — optimistic client-side toggle, server
// re-check via requireCapability, logAudit on every actual change.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { revalidatePath } from "next/cache";
import { GoogleGenAI } from "@google/genai";

export type ToggleResult = { error: string | null };

export async function setCompanionEnabled(employeeId: string, enabled: boolean): Promise<ToggleResult> {
  const employee = await requireCapability("companion_admin");
  const supabase = createServiceRoleClient();

  const { data: target } = await supabase.from("employees").select("id, name").eq("id", employeeId).maybeSingle();
  if (!target) return { error: "Employee not found." };

  const { error } = await supabase.from("employees").update({ companion_enabled: enabled }).eq("id", employeeId);
  if (error) return { error: error.message };

  await logAudit(supabase, {
    employeeId: employee.id,
    employeeName: employee.name,
    action: enabled ? "companion_access.granted" : "companion_access.revoked",
    entityType: "employee",
    entityId: target.id,
    entityLabel: target.name,
    changes: { companion_enabled: { from: !enabled, to: enabled } },
  });

  revalidatePath("/dashboard/admin/companion-access");
  return { error: null };
}

// 2026-09-05, round 2 — "REAL AI-GENERATED IMAGE BANWAO": a one-time,
// admin-triggered generation of a real character image via the same
// GEMINI_API_KEY already used for the chatbot (/api/companion-chat/
// route.ts) — this environment cannot invoke that live secret on its own,
// so this button is what actually calls it, using YOUR configured key.
//
// Model: gemini-2.5-flash-image ("Nano Banana") — a conversational
// image-generation model reached through the SAME ai.models.generateContent()
// call the chatbot uses (not the separate Imagen product line, which
// typically needs Vertex AI/billing set up — this one works on the same
// free-tier Gemini API key). The generated image comes back as an
// inlineData part on the response (base64 + mimeType), not as normal text.
//
// Stored in Supabase Storage (the 'companion-images' bucket, PUBLIC — see
// db/2026-09-05-ai-companion-refinements.sql), always at the SAME path
// with upsert:true, so regenerating just replaces it in place — the
// dashboard layout appends the row's generated_at as a cache-busting query
// param, so browsers pick up the new image immediately.
const IMAGE_MODEL = "gemini-2.5-flash-image";
const CHARACTER_IMAGE_BUCKET = "companion-images";
const CHARACTER_IMAGE_PATH = "character.png";

const DEFAULT_IMAGE_PROMPT =
  "A cute, friendly full-body mascot character for a warehouse and logistics office app, standing in a " +
  "relaxed front-facing pose. Round glasses, wavy shoulder-length brown hair, a cream/beige top. Flat " +
  "vector illustration style with soft cel shading, warm and approachable, centered in frame, plain solid " +
  "white background, no text, no watermark, no logo.";

export type GenerateImageResult = { error: string | null; imageUrl: string | null };

export async function generateCompanionCharacterImage(promptOverride?: string): Promise<GenerateImageResult> {
  const employee = await requireCapability("companion_admin");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      error: "GEMINI_API_KEY is not set yet — add it in Vercel's Environment Variables first (same key the chatbot uses).",
      imageUrl: null,
    };
  }

  const prompt = promptOverride?.trim() || DEFAULT_IMAGE_PROMPT;

  let base64: string;
  let mimeType: string;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseModalities: ["TEXT", "IMAGE"] },
    });
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      return { error: "The model didn't return an image this time — try again, or tweak the prompt.", imageUrl: null };
    }
    base64 = imagePart.inlineData.data;
    mimeType = imagePart.inlineData.mimeType || "image/png";
  } catch (err) {
    console.error("generateCompanionCharacterImage: Gemini call failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Image generation failed: ${message}`, imageUrl: null };
  }

  const supabase = createServiceRoleClient();
  const buffer = Buffer.from(base64, "base64");
  const { error: uploadError } = await supabase.storage.from(CHARACTER_IMAGE_BUCKET).upload(CHARACTER_IMAGE_PATH, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (uploadError) return { error: `Upload failed: ${uploadError.message}`, imageUrl: null };

  const { data: publicUrlData } = supabase.storage.from(CHARACTER_IMAGE_BUCKET).getPublicUrl(CHARACTER_IMAGE_PATH);

  const { error: dbError } = await supabase.from("companion_character_image").upsert({
    id: "default",
    image_url: publicUrlData.publicUrl,
    prompt,
    generated_at: new Date().toISOString(),
    generated_by: employee.id,
  });
  if (dbError) return { error: `Saved the image but failed to record it: ${dbError.message}`, imageUrl: null };

  await logAudit(supabase, {
    employeeId: employee.id,
    employeeName: employee.name,
    action: "companion_character_image.generated",
    entityType: "companion_character_image",
    entityId: "default",
    entityLabel: "AI Companion character image",
    changes: { prompt: { from: null, to: prompt } },
  });

  revalidatePath("/dashboard", "layout");
  return { error: null, imageUrl: publicUrlData.publicUrl };
}
