import type { ReactNode } from "react";

const PHOTON_URL = "https://photon.codes";
const DISCORD_URL = "https://discord.gg/Y6ymaZYpsz";
const GITHUB_URL = "https://github.com/photon-hq/codex";
const TERMS_URL = "https://github.com/photon-hq/codex/blob/main/docs/TERMS.md";
const PRIVACY_URL = "https://github.com/photon-hq/codex/blob/main/docs/PRIVACY.md";
const NOTICE_URL = "https://github.com/photon-hq/codex/blob/main/docs/NOTICE.md";

export function Footer() {
  return (
    <div className="relative z-10 mt-auto flex w-full flex-col">
      <div className="flex w-full items-center justify-center px-6 py-3 sm:px-10 sm:py-4">
        <a
          aria-label="View on GitHub"
          className="inline-flex items-center gap-1.5 font-medium text-[12.5px] text-[var(--color-text-muted)] tracking-[-0.005em] transition-colors hover:text-[var(--color-text)]"
          href={GITHUB_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <GithubIcon />
          View on GitHub
        </a>
      </div>
      <footer className="border-white/10 border-t bg-[#1a1a19] px-5 pt-4 pb-[clamp(1rem,env(safe-area-inset-bottom),1.75rem)] text-white sm:px-10 sm:pt-2.5 sm:pb-2.5">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-4 sm:grid sm:grid-cols-[1fr_auto_1fr]">
          <a
            aria-label="Powered by photon"
            className="group inline-flex items-center gap-2 whitespace-nowrap text-[12.5px] text-white/55 tracking-[-0.005em] transition-colors hover:text-white sm:justify-self-start"
            href={PHOTON_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="select-none">powered by</span>
            <img
              alt="photon"
              className="h-[12px] w-auto opacity-80 transition-opacity group-hover:opacity-100"
              height={12}
              src="/photon-wordmark.svg"
              width={56}
            />
          </a>
          <div className="hidden items-center gap-x-5 text-[12.5px] text-white/55 tracking-[-0.005em] sm:inline-flex sm:justify-self-center">
            <FooterLink href={TERMS_URL}>Terms</FooterLink>
            <FooterLink href={PRIVACY_URL}>Privacy</FooterLink>
            <FooterLink href={NOTICE_URL}>Notice</FooterLink>
          </div>
          <a
            aria-label="Join our Discord"
            className="inline-flex items-center justify-center text-white/55 transition-colors hover:text-white sm:justify-self-end"
            href={DISCORD_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <DiscordIcon />
          </a>
        </div>
      </footer>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="transition-colors hover:text-white"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function GithubIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="14"
      role="img"
      viewBox="0 0 16 16"
      width="14"
    >
      <path
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        fillRule="evenodd"
      />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="13"
      role="img"
      viewBox="0 0 25.837 20"
      width="16"
    >
      <path d="M 21.886 1.675 C 20.192 0.882 18.399 0.319 16.556 0 C 16.326 0.415 16.058 0.973 15.873 1.418 C 13.886 1.119 11.916 1.119 9.966 1.418 C 9.781 0.974 9.506 0.415 9.275 0 C 7.43 0.319 5.635 0.884 3.94 1.679 C 0.567 6.777 -0.347 11.748 0.11 16.648 C 2.347 18.319 4.515 19.334 6.647 19.998 C 7.177 19.269 7.645 18.498 8.047 17.692 C 7.272 17.395 6.532 17.029 5.832 16.602 C 6.018 16.464 6.199 16.319 6.374 16.17 C 10.624 18.165 15.241 18.165 19.44 16.17 C 19.617 16.319 19.798 16.464 19.982 16.602 C 19.281 17.031 18.538 17.397 17.764 17.694 C 18.166 18.498 18.632 19.271 19.164 20 C 21.298 19.336 23.468 18.321 25.705 16.648 C 26.242 10.969 24.79 6.044 21.886 1.675 Z M 8.615 13.633 C 7.358 13.633 6.326 12.46 6.326 11.031 C 6.326 9.602 7.336 8.426 8.615 8.426 C 9.894 8.426 10.927 9.6 10.905 11.031 C 10.907 12.46 9.894 13.633 8.615 13.633 Z M 17.197 13.633 C 15.94 13.633 14.908 12.46 14.908 11.031 C 14.908 9.602 15.918 8.426 17.197 8.426 C 18.476 8.426 19.509 9.6 19.487 11.031 C 19.487 12.46 18.476 13.633 17.197 13.633 Z" />
    </svg>
  );
}
