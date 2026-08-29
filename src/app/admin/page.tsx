import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_SESSION_COOKIE, isValidAdminSession } from "@/lib/admin-auth";

import { LoginForm } from "./login-form";

type SearchParams = Promise<{ expired?: string; next?: string }>;

function safeDestination(value: string | undefined) {
  return value?.startsWith("/admin/dashboard") ? value : "/admin/dashboard";
}

export default async function AdminLoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const destination = safeDestination(params.next);
  const session = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;

  if (isValidAdminSession(session)) {
    redirect(destination);
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-white px-5 py-10 text-black">
      <div className="w-full max-w-md border border-black bg-white p-6 sm:p-9">
        <p className="text-xs uppercase tracking-[0.2em]">bur1alrites / admin</p>
        <h1 className="mt-10 text-4xl">Sign in</h1>
        <LoginForm
          destination={destination}
          initialMessage={params.expired ? "Your session ended. Sign in to continue." : ""}
        />
      </div>
    </main>
  );
}