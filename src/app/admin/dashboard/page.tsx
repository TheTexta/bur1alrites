import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_SESSION_COOKIE,
  isValidAdminSession,
} from "@/lib/admin-auth";

import { GalleryEditor } from "./gallery-editor";

export default async function AdminDashboardPage() {
  const session = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;

  if (!isValidAdminSession(session)) {
    redirect("/admin");
  }

  return (
    <main className="min-h-svh bg-[#e2e1e1] px-6 py-10 text-black">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs uppercase tracking-[0.2em]">bur1alrites / admin</p>
        <h1 className="mt-8 text-4xl">Gallery contents</h1>
        <p className="mt-3 max-w-xl text-sm">Edit the metadata shown over each gallery clip.</p>
        <GalleryEditor />
      </div>
    </main>
  );
}