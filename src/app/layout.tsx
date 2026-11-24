import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MARKET MASTER — Momentum & Market Structure Intelligence",
  description:
    "Dual-layer NSE F&O momentum, futures positioning, options premium and dynamic support/resistance intelligence terminal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5, user-scalable=yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#07080a" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- single shared stylesheet, loaded for every route via the root layout */}
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="overscroll-none">{children}</body>
    </html>
  );
}
