"use client";

// 2026-08-18 — "photo ka preview nahi aata" + "photo ke link kaam nahi
// karte": shared by the New Order form (new/order-form.tsx, one per item
// block) and the inline Order edit form (order-edit-form.tsx). Gives BOTH
// the old paste-a-link field (still supported, now with a live preview so
// a broken link is obvious immediately instead of only found later on the
// printed invoice/WhatsApp message) AND a real "Upload" button that sends
// the file straight to the order-photos Storage bucket and fills the URL
// field with the resulting public link — per user's explicit "dono option
// rakho" (keep both options).
import { useRef, useState, type ChangeEvent } from "react";
import { uploadOrderPhoto } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function PhotoUrlField({
  id,
  name,
  defaultValue,
  label = "Photo URL",
  labelClass = "mb-1 block text-sm font-medium text-slate-700",
}: {
  id: string;
  name: string;
  defaultValue?: string | null;
  label?: string;
  labelClass?: string;
}) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [broken, setBroken] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadOrderPhoto(fd);
      if (result.error) {
        setUploadError(result.error);
      } else if (result.url) {
        setUrl(result.url);
        setBroken(false);
      }
    } catch {
      setUploadError("Upload failed — try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        {url && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Preview"
            onError={() => setBroken(true)}
            onLoad={() => setBroken(false)}
            className="h-9 w-9 shrink-0 rounded border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-300">
            {url ? "✕" : "—"}
          </div>
        )}
        <input
          id={id}
          name={name}
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setBroken(false);
          }}
          placeholder="https://… (ya upload karein)"
          className={inputClass}
        />
        <label className="shrink-0 cursor-pointer rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
          {uploading ? "…" : "📁 Upload"}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </label>
      </div>
      {url && broken && (
        <p className="mt-1 text-xs text-red-500">
          Yeh link se photo load nahi ho rahi — direct image link paste karein ya Upload button use karein.
        </p>
      )}
      {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
    </div>
  );
}
