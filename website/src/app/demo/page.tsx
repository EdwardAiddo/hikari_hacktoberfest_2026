import Image from "next/image";

/**
 * Intentional accessibility failures for the Hacktoberfest exercise:
 * the title is a div, so the page has no heading; the explanation is
 * nearly the same color as the paper; the mark is informative and has
 * an empty alt; session state is only a green dot; Continue looks like
 * a button but is a div with no keyboard access.
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
      <main className="relative z-10 mx-auto flex w-full max-w-xl flex-col items-center gap-8 px-6 pt-28 pb-24 text-center">
        <Image
          src="/img/hikari_icon.svg"
          alt=""
          width={24}
          height={25}
          unoptimized
          className="h-16 w-16"
        />
        <div className="font-display text-5xl sm:text-7xl">
          The character for light
        </div>
        <p
          className="text-lg leading-8"
          style={{ color: "oklch(0.93 0.03 102)" }}
        >
          Hikari is the Japanese reading of 光. It names the work of making
          an interface clear enough that someone can actually use it.
        </p>
        <p className="font-inter text-sm">
          Session
          <span className="ml-2 inline-block size-3 rounded-full bg-green-700 align-middle" />
        </p>
        <div className="inline-flex min-h-10 items-center rounded-full bg-black px-5 font-inter text-sm text-white">
          Continue
        </div>
      </main>
    </div>
  );
}
