"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Unable to sign in.");
      setPending(false);
      return;
    }

    router.push("/admin/dashboard");
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#e2e1e1] px-6 text-black">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-5">
        <p className="text-xs uppercase tracking-[0.2em]">bur1alrites / admin</p>
        <h1 className="text-3xl">Enter password</h1>
        <label className="flex flex-col gap-2 text-sm">
          Password
          <input
            autoFocus
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="border border-black bg-transparent px-3 py-3 outline-none focus:bg-white"
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="border border-black px-3 py-3 text-left disabled:opacity-50"
        >
          {pending ? "Checking..." : "Continue"}
        </button>
      </form>
    </main>
  );
}