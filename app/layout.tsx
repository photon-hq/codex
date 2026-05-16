import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { BackdropVideo } from "@/components/chrome";
import { Footer } from "@/components/footer";
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

const SITE_URL =
  process.env.PUBLIC_URL ??
  (process.env.NODE_ENV === "production" ? "https://codex.pho.town" : "http://localhost:3000");

export const viewport: Viewport = {
  themeColor: "#1a1a19",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Codex on iMessage",
  description:
    "A coding agent that helps you build and ship with AI, powered by ChatGPT, now on iMessage.",
  openGraph: {
    type: "website",
    title: "Codex on iMessage",
    description:
      "A coding agent that helps you build and ship with AI, powered by ChatGPT, now on iMessage.",
    url: "/",
    siteName: "Codex on iMessage",
    images: [
      {
        url: "/og.jpg",
        width: 1024,
        height: 576,
        alt: "Codex on iMessage",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex on iMessage",
    description:
      "A coding agent that helps you build and ship with AI, powered by ChatGPT, now on iMessage.",
    images: ["/og.jpg"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className={`${geist.variable} ${geistMono.variable}`} lang="en">
      <head>
        <link crossOrigin="anonymous" href="https://persistent.oaistatic.com" rel="preconnect" />
        <link href="https://persistent.oaistatic.com" rel="dns-prefetch" />
        <link
          as="image"
          fetchPriority="high"
          href="https://persistent.oaistatic.com/codex/icon.png"
          rel="preload"
        />
        <link
          as="video"
          crossOrigin="anonymous"
          fetchPriority="high"
          href="https://persistent.oaistatic.com/codex/icon-gif.mp4"
          rel="preload"
          type="video/mp4"
        />
        <link
          as="video"
          crossOrigin="anonymous"
          fetchPriority="low"
          href="https://persistent.oaistatic.com/codex/background-video-jan-28.mp4"
          rel="preload"
          type="video/mp4"
        />
      </head>
      <body className="hero-bg relative min-h-screen overflow-x-hidden">
        <BackdropVideo />
        <div className="relative z-10 flex min-h-screen flex-col">
          {children}
          <Footer />
        </div>
        <Toaster
          closeButton
          duration={4500}
          position="top-center"
          richColors
          theme="light"
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
