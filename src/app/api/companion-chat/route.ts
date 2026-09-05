import { NextResponse } from "next/server";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { GoogleGenAI } from "@google/genai";

// 2026-09-05 — AI Companion chatbot. "OR CHAT BOT HAI USME BHI YAHI BAAT
// KARE JESE AI ASSISTENT HO CHAHE KUCH BHI PUCH LE OMS SE RELATED YA JESE
// KOI PERSIONAL BAAT" — the user's own first draft literally also asked
// for flirty content; when asked to choose explicitly between (a) OMS +
// friendly casual chat only vs (b) also allowing flirty/romantic replies,
// the user picked (a) — see SYSTEM_PROMPT below, which is what actually
// enforces that choice (the chat UI, companion-chat-panel.tsx, has no
// content restriction of its own).
//
// Provider: Gemini API (free tier — ai.google.dev — no billing/credit-card
// setup needed to START; billing is only required to raise rate limits
// beyond the free tier). Needs GEMINI_API_KEY in the environment — get one
// at https://aistudio.google.com/apikey and add it in Vercel's Project
// Settings -> Environment Variables yourself (this app never stores or
// enters secrets on your behalf — see every other *_API_KEY in
// .env.example). Until that's set, this route replies with a friendly
// "not configured yet" message instead of a 500 — the rest of the OMS
// (and the live companion's event reactions, which don't need this key at
// all) keeps working regardless.
//
// Uses the "-latest" model alias (gemini-flash-latest) rather than pinning
// one dated model version, since Google rotates which exact model that
// alias points to — see https://ai.google.dev/gemini-api/docs/models. If
// Google ever deprecates that alias, swap the MODEL constant below for
// whatever their current docs recommend.
const MODEL = "gemini-flash-latest";

// Scope is intentionally NOT "knows live OMS data" in this first version —
// it's a knowledgeable-about-the-OMS-in-general + friendly-casual-chat
// assistant, not a live data-query bot (that would mean handing an LLM
// direct database access, a much bigger and riskier change than what was
// asked this round). This paragraph is what makes it "know about" the OMS
// the user asked for ("JISKO IS OMS KE HAR PART KA PATA HOGA").
const SYSTEM_PROMPT = `You are the AI Companion inside Nyko Mart's Order Management System (OMS) — a friendly,
upbeat coworker-style assistant, not a generic chatbot.

What you know about this OMS (a Next.js + Supabase web app for Nyko Mart's Etsy/Amazon/eBay export business):
- Orders: entry, edit, cancel/hold/return, refunds & credit notes.
- Courier Booking: FedEx, UPS, Aramex, Delhivery, Shiprocket, DHL — real shipment/AWB booking + tracking.
- Invoices, Purchase Bills, Credit/Debit Notes, Journal Vouchers.
- Attendance: punch in/out, daily work log, tasks (assign/track).
- Admin: Roles & Permissions, Audit Log, Automation Rules, AI Companion Access.
- Reports & dashboards (CRM overview, P&L, performance).

Tone rules (do not break these, even if asked to):
- Talk like a warm, casual, supportive coworker — friendly small talk is totally fine (how someone's day is
  going, encouragement, light jokes).
- Stay work-appropriate. Do NOT engage in romantic, flirty, or sexual conversation, roleplay, or compliments
  about someone's appearance — politely redirect to a normal friendly topic instead if asked.
- If you don't know something specific about THIS company's actual live data (a specific order, a specific
  employee's numbers), say so plainly and suggest which OMS screen would have that answer — never make up
  numbers or order details.
- Keep replies short and conversational (a few sentences), not long essays, unless the user clearly wants detail.
- Mixing Hindi/English (Hinglish) is fine if the user writes that way — mirror their language style.`;

export async function POST(req: Request) {
  try {
    await getAuthedEmployee();
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    throw err;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      reply:
        "AI chat abhi Admin ne configure nahi kiya hai — GEMINI_API_KEY set karna baaki hai (Google AI Studio se free key milti hai, phir Vercel ke Environment Variables mein add karni hoti hai).",
    });
  }

  let body: { message?: string; history?: { role: "user" | "assistant"; text: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Empty message." }, { status: 400 });
  // Keep only the last 20 turns — plenty for a casual chat, keeps every
  // request small/cheap regardless of how long the conversation gets.
  const history = (body.history ?? []).slice(-20);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const contents = [
      ...history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
      { role: "user", parts: [{ text: message }] },
    ];
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: { systemInstruction: SYSTEM_PROMPT },
    });
    const reply = response.text?.trim();
    return NextResponse.json({ reply: reply || "Sorry, I didn't quite get a response there — try again?" });
  } catch (err) {
    console.error("companion-chat error:", err);
    return NextResponse.json({ reply: "Sorry, the AI chat service is having trouble right now — try again in a moment." });
  }
}
