"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { requestAdminJson } from "./dashboard/admin-api";

export function LoginForm({ destination, initialMessage }: { destination: string; initialMessage: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    requestAdminJson<{ ok: true }>("/api/admin/me")
      .then(() => { if (active) router.replace(destination); })
      .catch(() => {});
    return () => { active = false; };
  }, [destination, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      try {
        await requestAdminJson<{ ok: true }>("/api/admin/me");
      } catch (adminError) {
        await supabase.auth.signOut();
        throw adminError;
      }
      router.replace(destination);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
      <label htmlFor="admin-email" className="flex flex-col gap-2 text-xs uppercase tracking-[0.12em]">
        Email
        <input
          id="admin-email"
          autoComplete="username"
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-h-12 border border-black bg-transparent px-3 py-3 text-base normal-case focus-visible:outline-2 focus-visible:outline-offset-1"
        />
      </label>
      <label htmlFor="admin-password" className="flex flex-col gap-2 text-xs uppercase tracking-[0.12em]">
        Password
        <input
          id="admin-password"
          autoFocus
          autoComplete="current-password"
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="min-h-12 border border-black bg-transparent px-3 py-3 text-base normal-case outline-none transition-colors focus:bg-white focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        />
      </label>
      <p aria-live="polite" className={`min-h-5 text-sm ${message ? "text-red-700" : ""}`}>
        {message}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-12 items-center justify-between border border-black bg-black px-4 py-3 text-left text-sm text-white transition-colors hover:bg-transparent hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-50"
      >
        {pending ? "Checking..." : "Continue"}
        <ArrowRight aria-hidden="true" size={18} />
      </button>
    </form>
  );
}
