"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { requestAdminJson } from "./admin-api";

export function AdminHeader({ hasUnsavedChanges }: { hasUnsavedChanges: boolean }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (hasUnsavedChanges && !window.confirm("Discard unsaved gallery changes and sign out?")) return;

    setLoggingOut(true);
    setError("");
    try {
      await requestAdminJson<{ ok: true }>("/api/admin/logout", { method: "POST" });
      router.replace("/admin");
      router.refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Could not sign out.");
      setLoggingOut(false);
    }
  }

  return (
    <header className="flex min-h-16 items-center justify-between border-b border-black pb-5">
      <div>
        <p className="text-xs uppercase tracking-[0.2em]">bur1alrites / admin</p>
        <h1 className="mt-2 text-2xl sm:text-3xl">Gallery control</h1>
      </div>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          title="Sign out"
          disabled={loggingOut}
          onClick={logout}
          className="flex min-h-11 items-center gap-2 border border-black px-3 text-sm transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
        >
          <LogOut aria-hidden="true" size={17} />
          <span className="hidden sm:inline">{loggingOut ? "Signing out..." : "Sign out"}</span>
        </button>
        <p aria-live="polite" className="text-xs text-red-700">{error}</p>
      </div>
    </header>
  );
}