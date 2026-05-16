import type { ReactNode } from "react";

const PHOTON_URL = "https://photon.codes";
const DISCORD_URL = "https://discord.gg/Y6ymaZYpsz";
const GITHUB_URL = "https://github.com/photon-hq/codex";
const TERMS_URL = "https://github.com/photon-hq/codex/blob/main/TERMS.md";
const PRIVACY_URL = "https://github.com/photon-hq/codex/blob/main/PRIVACY.md";
const NOTICE_URL = "https://github.com/photon-hq/codex/blob/main/NOTICE.md";

export function Footer() {
  return (
    <div className="relative z-10 mt-auto flex w-full flex-col">
      <div className="flex w-full items-center justify-center px-6 py-4 sm:px-10">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium tracking-[-0.005em] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
          aria-label="View on GitHub"
        >
          <GithubIcon />
          View on GitHub
        </a>
      </div>
      <footer className="border-t border-white/10 bg-[#1a1a19] px-6 py-2.5 text-white sm:px-10">
        <div className="mx-auto grid w-full max-w-screen-2xl grid-cols-[1fr_auto_1fr] items-center gap-4">
          <a
            href={PHOTON_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex w-fit items-center gap-2 justify-self-start text-[12.5px] tracking-[-0.005em] text-white/55 transition-colors hover:text-white"
            aria-label="Powered by photon"
          >
            <span className="select-none">powered by</span>
            <img
              src="/photon-wordmark.svg"
              alt="photon"
              width={56}
              height={12}
              className="h-[12px] w-auto opacity-80 transition-opacity group-hover:opacity-100"
            />
          </a>
          <div className="flex items-center justify-self-center gap-x-5 text-[12.5px] tracking-[-0.005em] text-white/55">
            <FooterLink href={TERMS_URL}>Terms</FooterLink>
            <FooterLink href={PRIVACY_URL}>Privacy</FooterLink>
            <FooterLink href={NOTICE_URL}>Notice</FooterLink>
          </div>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center justify-self-end text-white/55 transition-colors hover:text-white"
            aria-label="Join our Discord"
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
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="transition-colors hover:text-white"
    >
      {children}
    </a>
  );
}

function GithubIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      role="img"
    >
      <path
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg
      width="16"
      height="13"
      viewBox="0 0 25.837 20"
      fill="currentColor"
      aria-hidden="true"
      role="img"
    >
      <path d="M 21.886 1.675 C 20.192 0.882 18.399 0.319 16.556 0 C 16.326 0.415 16.058 0.973 15.873 1.418 C 13.886 1.119 11.916 1.119 9.966 1.418 C 9.781 0.974 9.506 0.415 9.275 0 C 7.43 0.319 5.635 0.884 3.94 1.679 C 0.567 6.777 -0.347 11.748 0.11 16.648 C 2.347 18.319 4.515 19.334 6.647 19.998 C 7.177 19.269 7.645 18.498 8.047 17.692 C 7.272 17.395 6.532 17.029 5.832 16.602 C 6.018 16.464 6.199 16.319 6.374 16.17 C 10.624 18.165 15.241 18.165 19.44 16.17 C 19.617 16.319 19.798 16.464 19.982 16.602 C 19.281 17.031 18.538 17.397 17.764 17.694 C 18.166 18.498 18.632 19.271 19.164 20 C 21.298 19.336 23.468 18.321 25.705 16.648 C 26.242 10.969 24.79 6.044 21.886 1.675 Z M 8.615 13.633 C 7.358 13.633 6.326 12.46 6.326 11.031 C 6.326 9.602 7.336 8.426 8.615 8.426 C 9.894 8.426 10.927 9.6 10.905 11.031 C 10.907 12.46 9.894 13.633 8.615 13.633 Z M 17.197 13.633 C 15.94 13.633 14.908 12.46 14.908 11.031 C 14.908 9.602 15.918 8.426 17.197 8.426 C 18.476 8.426 19.509 9.6 19.487 11.031 C 19.487 12.46 18.476 13.633 17.197 13.633 Z" />
    </svg>
  );
}
