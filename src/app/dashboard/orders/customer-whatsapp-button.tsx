"use client";

import { useState } from "react";

/**
 * 2026-08-18 — "WhatsApp customer/staff notifications best banao jo mene
 * bhi except nahi kiya" (build the best customer/staff WhatsApp
 * notification system you can, better than I expected).
 *
 * Deliberately built on the SAME manual, human-in-the-loop pattern already
 * established twice in this codebase (order-whatsapp-button.tsx,
 * order-hold-cancel-actions.tsx) — see BRAIN.md §9: the user explicitly
 * decided 2026-08-18 NOT to integrate automated WhatsApp sending (OpenWA),
 * given the real account-ban risk an unofficial/reverse-engineered client
 * carries. This is the "best" version achievable within that constraint:
 * one click composes the right message for the order's current status
 * (Confirmed/Dispatched/Delivered, with courier/AWB details folded in
 * automatically when known) and opens it in WhatsApp — the staff member
 * still presses Send themselves, same as every other WhatsApp integration
 * point in this app.
 *
 * Deliberately does NOT silently auto-fill the customer's number and fire
 * wa.me — order-whatsapp-button.tsx's own comment already documents why:
 * "a customer's saved contact number often isn't a WhatsApp number at
 * all." Instead this shows the number (prefilled from contact_no) in an
 * editable field so staff can correct it before sending — same reasoning,
 * applied to the one place in the app that actually needs to target the
 * buyer's own number.
 *
 * Deliberately does NOT persist a "customer was notified" timestamp/table
 * — unlike whatsapp_sent_at on the order itself (which tracks the internal
 * packing message), there's no reliable delivery signal to hang that on
 * here (the message is composed here but actually sent from inside
 * WhatsApp, outside this app's visibility), and adding an unreliable
 * "notified ✓" indicator would be worse than no indicator at all.
 */

type Tracking = { awbNo: string | null; courierName: string | null; deliveredDate: string | null } | undefined;

type OrderForMessage = {
  ref_no: string;
  status: string;
  buyer_name_address: string | null;
  contact_no: string | null;
  item_category_name: string;
  size_label: string | null;
  qty: number;
};

const TEMPLATES: Record<string, (o: OrderForMessage, t: Tracking) => string> = {
  Confirmed: (o) =>
    `Hi! Your order *${o.ref_no}* (${o.qty} x ${o.item_category_name}${o.size_label ? ", " + o.size_label : ""}) has been confirmed and is now in production. We'll message you again as soon as it's dispatched. Thank you for shopping with us!`,
  "In Production": (o) =>
    `Hi! Your order *${o.ref_no}* is currently in production. We'll message you again as soon as it's dispatched. Thank you for your patience!`,
  Dispatched: (o, t) =>
    `Hi! Your order *${o.ref_no}* has been dispatched${t?.courierName ? ` via ${t.courierName}` : ""}${
      t?.awbNo ? `, tracking number *${t.awbNo}*` : ""
    }. It should reach you soon — thank you for shopping with us!`,
  Delivered: (o) =>
    `Hi! We hope your order *${o.ref_no}* has reached you safely. Thank you for shopping with us — we'd love to hear what you think!`,
};

function normalizePhone(raw: string): string {
  // wa.me needs digits only, no +/spaces/dashes. Doesn't validate the
  // number is real or on WhatsApp — that's still on whoever presses send,
  // same as every other WhatsApp entry point in this app.
  return raw.replace(/[^\d]/g, "");
}

export function CustomerWhatsAppButton({ order, tracking }: { order: OrderForMessage; tracking?: Tracking }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(order.contact_no ?? "");
  const template = TEMPLATES[order.status];
  const [message, setMessage] = useState(() => (template ? template(order, tracking) : ""));

  if (!template) {
    // No customer-facing template for this status (Pending/Hold/Cancelled/
    // Returned) — nothing sensible to send a buyer yet, so the button
    // doesn't render at all rather than showing a dead/disabled control.
    return null;
  }

  function handleOpenToggle() {
    if (!open) setMessage(template(order, tracking));
    setOpen(!open);
  }

  function handleSend() {
    const digits = normalizePhone(phone);
    const url = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpenToggle}
        className="rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100"
      >
        📲 Notify Customer
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <label className="mb-1 block text-[11px] font-medium text-slate-500" htmlFor={`cust-phone-${order.ref_no}`}>
            Customer WhatsApp Number
          </label>
          <input
            id={`cust-phone-${order.ref_no}`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 919876543210"
            className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-teal-500"
          />
          <p className="mb-1 text-[11px] text-slate-400">
            Double-check this is really a WhatsApp number before sending — the saved contact number sometimes isn&apos;t.
          </p>
          <label className="mb-1 block text-[11px] font-medium text-slate-500" htmlFor={`cust-msg-${order.ref_no}`}>
            Message ({order.status})
          </label>
          <textarea
            id={`cust-msg-${order.ref_no}`}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-teal-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              className="flex-1 rounded-md bg-teal-600 px-2 py-1 text-xs font-semibold text-white hover:bg-teal-700"
            >
              Open in WhatsApp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
