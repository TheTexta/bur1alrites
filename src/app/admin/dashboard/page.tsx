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
    redirect("/admin?expired=1&next=/admin/dashboard");
  }

  return (
    <main className="min-h-svh bg-[#e2e1e1] bg-[linear-gradient(to_right,rgba(5,5,5,0.045)_1px,transparent_1px)] bg-[size:64px_100%] px-4 py-5 text-[#050505] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <GalleryEditor />
      </div>
    </main>
  );
}