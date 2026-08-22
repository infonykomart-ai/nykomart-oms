"use client";

// 2026-08-22 — "URL ki jagah upload ka option kar do": the old field
// (profile-fields.tsx, pre this change) was a plain paste-a-link text
// input, and pasted links routinely weren't direct image links, so the
// preview showed "Couldn't load an image from this URL." with no way to
// fix it except finding a better link. Per the explicit ask, this REPLACES
// manual URL typing entirely with a real file upload (unlike
// orders/photo-url-field.tsx, which keeps both — that was a different,
// explicit "dono option rakho" request). The uploaded file's public URL is
// still what's submitted as `photo_url` (a hidden input), so
// actions.ts/profileFields() needs no changes downstream.
import { useRef, useState, type ChangeEvent } from "react";
import { uploadEmployeePhoto } from "./actions";

export function EmployeePhotoField({ defaultValue }: { defaultValue?: string | null }) {
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
      const result = await uploadEmployeePhoto(fd);
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
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="photo_upload">
        Photo
      </label>
      <input type="hidden" name="photo_url" value={url} />
      <div className="flex items-center gap-2">
        {url && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Preview"
            onError={() => setBroken(true)}
            onLoad={() => setBroken(false)}
            className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-300">
            {url ? "✕" : "—"}
          </div>
        )}
        <label
          htmlFor="photo_upload"
          className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {uploading ? "Uploading…" : url ? "📁 Change Photo" : "📁 Upload Photo"}
          <input
            ref={fileInputRef}
            id="photo_upload"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </label>
        {url && !uploading && (
          <button
            type="button"
            onClick={() => {
              setUrl("");
              setBroken(false);
            }}
            className="text-xs text-slate-400 hover:text-red-500"
          >
            Remove
          </button>
        )}
      </div>
      {url && broken && (
        <p className="mt-1 text-xs text-red-500">Photo uploaded but couldn&apos;t load a preview — it should still save fine.</p>
      )}
      {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
    </div>
  );
}
