import { BackdropVideo } from "@/components/chrome";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans-loaded",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono-loaded",
  display: "swap",
});

const SITE_URL = process.env.PUBLIC_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Codex on iMessage",
  description:
    "A coding agent that helps you build and ship with AI — powered by ChatGPT, now on iMessage.",
  openGraph: {
    type: "website",
    title: "Codex on iMessage",
    description:
      "A coding agent that helps you build and ship with AI — powered by ChatGPT, now on iMessage.",
    url: "/",
    siteName: "Codex on iMessage",
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex on iMessage",
    description:
      "A coding agent that helps you build and ship with AI — powered by ChatGPT, now on iMessage.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        <link
          rel="preload"
          as="video"
          href="https://persistent.oaistatic.com/codex/background-video-jan-28.mp4"
          type="video/mp4"
          crossOrigin="anonymous"
        />
      </head>
      <body className="hero-bg relative min-h-dvh overflow-x-hidden">
        <BackdropVideo />
        <div className="relative z-10 flex min-h-dvh flex-col">{children}</div>
        <Toaster
          position="top-center"
          richColors
          closeButton
          theme="light"
          duration={4500}
          toastOptions={{
            classNames: {
              toast:
                "!rounded-2xl !border !border-white/55 !bg-white/85 !shadow-[0_8px_32px_-16px_rgba(40,30,90,0.3)] !backdrop-blur-xl !font-sans",
              title: "!font-medium !tracking-[-0.01em] !text-[13.5px]",
              description: "!text-[12.5px] !leading-snug !text-[var(--color-text-muted)]",
              closeButton:
                "!border-white/55 !bg-white/70 !text-[var(--color-text-muted)] hover:!text-[var(--color-text)]",
            },
          }}
        />
      </body>
    </html>
  );
}
