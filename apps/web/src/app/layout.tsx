import type { Metadata } from "next";

import { AppProviders } from "@/components/providers";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "Dixora · Restoran Operasyon Platformu",
    template: "%s · Dixora",
  },
  description:
    "Masa, sipariş, mutfak, QR menü, stok ve raporlamayı tek çalışma alanında birleştiren işletme operasyon platformu. İlk 30 gün ücretsiz.",
  applicationName: "Dixora",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brand/dixora-mark.svg", type: "image/svg+xml" },
      {
        url: "/brand/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/brand/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Dixora",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" suppressHydrationWarning className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
