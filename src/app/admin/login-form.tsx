"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function LoginForm({ destination, initialMessage }: { destination: string; initialMessage: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setMessage(body?.error ?? "Unable to sign in.");
        return;
      }

      router.replace(destination);
      router.refresh();
    } catch {
      setMessage("Unable to reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
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