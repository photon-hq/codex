import { CodexIcon, TopNav } from "@/components/chrome";
import { ConnectCta } from "@/components/connect-cta";

export default function HomePage() {
  return (
    <main className="relative flex flex-1 flex-col">
      <TopNav right={<span />} />
      <Hero />
    </main>
  );
}

function Hero() {
  return (
    <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 pb-20 pt-4 text-center sm:px-6 sm:pb-24 sm:pt-8">
      <div className="fade-up fade-up-1">
        <CodexIcon />
      </div>
      <h1 className="hero-title fade-up fade-up-2 mt-3 max-w-[18ch] sm:mt-4">Codex on iMessage</h1>
      <p className="hero-tagline fade-up fade-up-3 mt-1.5 max-w-[42rem] !leading-[1.2] sm:mt-2">
        A coding agent that helps you build and ship with AI,
        <br />
        powered by ChatGPT, now on iMessage.
      </p>
      <div className="fade-up fade-up-4 mt-4 flex flex-col items-center gap-3 sm:mt-5">
        <ConnectCta />
      </div>
    </section>
  );
}
