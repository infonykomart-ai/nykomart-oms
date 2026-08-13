"use client";

import { useActionState } from "react";
import { updateMyProfile, type MyProfileFormState } from "./actions";
import { ProfileFields, type ProfileFieldDefaults } from "../admin/employees/profile-fields";

const initialState: MyProfileFormState = { error: null, success: false };

export function MyProfileForm({ defaults }: { defaults: ProfileFieldDefaults }) {
  const [state, formAction, pending] = useActionState(updateMyProfile, initialState);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Profile updated.</p>}

      <ProfileFields defaults={defaults} />

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save Profile"}
        </button>
      </div>
    </form>
  );
}
