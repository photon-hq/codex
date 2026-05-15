const PHOTON_URL = "https://photon.codes";
const DISCORD_URL = "https://discord.gg/3bUP7yWS";

export function Footer() {
  return (
    <footer className="relative z-10 mt-auto border-t border-white/10 bg-[#1a1a19] px-6 py-2.5 text-white sm:px-10">
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
