const PHOTON_URL = "https://photon.codes";
const DISCORD_URL = "https://discord.gg/zX3NGecs";
const GITHUB_URL = "https://github.com/photon-hq/codex";

export function Footer() {
  return (
    <div className="relative z-10 mt-auto flex w-full flex-col">
      <div className="flex w-full items-center justify-center px-6 py-4 text-center sm:px-10">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium tracking-[-0.01em] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          <GithubIcon />
          View on GitHub
        </a>
      </div>
      <footer className="border-t border-white/10 bg-[#1a1a19] px-6 py-2.5 text-white sm:px-10">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-4">
          <a
            href={PHOTON_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 text-[12.5px] tracking-[-0.005em] text-white/55 transition-colors hover:text-white"
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
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center text-white/55 transition-colors hover:text-white"
            aria-label="Join our Discord"
          >
            <DiscordIcon />
          </a>
        </div>
      </footer>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      role="img"
    >
      <path d="M12 0.297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
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
