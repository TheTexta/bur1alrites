import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";

import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bur1alrites.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "bur1alrites | Portfolio",
    template: "%s | bur1alrites",
  },
  description: "bur1alrites is a visual portfolio of moving-image and touch designer work.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "bur1alrites",
    title: "bur1alrites | Portfolio",
    description: "A visual portfolio of moving-image and touch designer work.",
    images: [
      {
        url: "/assets/logo.png",
        width: 866,
        height: 1070,
        alt: "bur1alrites",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "bur1alrites | Portfolio",
    description: "A visual portfolio of moving-image and touch designer work.",
    images: ["/assets/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/assets/logo.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "bur1alrites",
    url: `${SITE_URL}/`,
    publisher: {
      "@type": "Organization",
      name: "bur1alrites",
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/assets/logo.png`,
      sameAs: ["https://www.instagram.com/bur1alrites/"],
    },
  };

  return (
    <html
      lang="en"
      className="h-full"
    >
      <body className="min-h-full flex flex-col bg-black text-[#e2e1e1] font-[Times_New_Roman,Times,serif]">
        {children}
        <Analytics />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </body>
    </html>
  );
}
