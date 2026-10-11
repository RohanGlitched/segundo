import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { GasNotice } from "@/components/GasNotice";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Till: get paid every second you work", template: "%s · Till" },
  description:
    "Clients abroad fund a tab in AUSD, Agora's digital dollar. While you're clocked in, pay lands on Monad every second. No invoices, no ten-day wait, no wire fees.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://till-pay.vercel.app"),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EDF1EC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1A17" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <Providers>
          <Header />
          <GasNotice />
          {children}
        </Providers>
      </body>
    </html>
  );
}
