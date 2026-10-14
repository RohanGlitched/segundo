import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { GasNotice } from "@/components/GasNotice";
import { Header } from "@/components/Header";
import { PageNav } from "@/components/PageNav";
import { Providers } from "@/components/Providers";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

const title = "Segundo: get paid every second you work";
const description =
  "Clients abroad fund a tab in AUSD, Agora's digital dollar. While you're clocked in, pay lands on Monad every second. No invoices, no ten-day wait, no wire fees.";

export const metadata: Metadata = {
  title: { default: title, template: "%s | Segundo" },
  description,
  applicationName: "Segundo",
  // Pinned so every host (mera.segundo.world, previews) names segundo.world as the canonical page.
  metadataBase: new URL("https://segundo.world"),
  // "./" resolves to each page's own path: /tab/4 becomes https://segundo.world/tab/4.
  alternates: { canonical: "./" },
  // The card image is app/opengraph-image.png; icons from app/icon.tsx and app/apple-icon.tsx.
  openGraph: { type: "website", siteName: "Segundo", title, description, locale: "en", url: "./" },
  twitter: { card: "summary_large_image", title, description },
  appleWebApp: { capable: true, title: "Segundo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EDF1EC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1A17" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <head>
        <link rel="preload" href="/fonts/dollar.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/currency.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Providers>
          <Header />
          <GasNotice />
          <div id="main" tabIndex={-1} className="main">
            {children}
          </div>
          <PageNav />
        </Providers>
      </body>
    </html>
  );
}
