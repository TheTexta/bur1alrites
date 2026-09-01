import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next"

import "./globals.css";

export const metadata: Metadata = {
  title: "bur1alrites",
  description: "bur1alrites",
  icons: {
    icon: "/assets/logo.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full"
    >
      <body className="min-h-full flex flex-col bg-black text-[#e2e1e1] font-[Times_New_Roman,Times,serif]">{children}</body>
    </html>
  );
}
