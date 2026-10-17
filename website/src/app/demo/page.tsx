import Image from "next/image";

/**
 * Intentional accessibility failures for the Hacktoberfest exercise:
 * the title is a paragraph and the next heading skips to h3; the only
 * link says "click here"; focus outlines are removed; tab order is
 * scrambled; the mark spins forever, with no pause, even when reduced
 * motion is requested.
 */
export default function DemoPage() {
  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-clip bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex justify-center"
        aria-hidden="true"
      >
        <Image
          src="/img/kanji_ascii.svg"
          alt=""
          width={1768}
          height={1750}
          unoptimized
          className="ascii-mark h-[110vh] w-auto max-w-none"
        />
      </div>
      <p className="absolute top-6 left-6 z-10 font-inter text-sm font-bold tracking-wide text-muted-foreground">
        Hacktoberfest 2026
      </p>
      <main className="relative z-10 mx-auto flex w-full max-w-xl flex-col items-center gap-8 px-6 pt-28 pb-24 text-center [&_a]:focus:outline-none [&_a]:focus-visible:outline-none">
        <Image
          src="/img/hikari_icon.svg"
          alt=""
          width={24}
          height={25}
          unoptimized
          className="h-16 w-16 animate-spin"
        />
        <p className="font-display text-5xl sm:text-7xl">Watch the light move</p>
        <p className="font-inter text-lg leading-8">
          The preview starts on its own. There is no control to stop it.
        </p>
        <h3
          id="chapters"
          className="font-inter text-sm font-bold tracking-wide uppercase"
        >
          Chapters
        </h3>
        <p className="font-inter text-base">
          The full reading lives on the home page. Open it{" "}
          <a tabIndex={2} href="/" className="underline">
            click here
          </a>
          .
        </p>
        <a tabIndex={1} href="#chapters" className="font-inter text-sm underline">
          Jump to chapters
        </a>
      </main>
    </div>
  );
}
