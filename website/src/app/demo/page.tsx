import Image from "next/image";

/**
 * Intentional accessibility failures for the Hacktoberfest exercise:
 * the fields are named only by placeholder text; the checkbox is not
 * tied to its sentence; the email error is only a red border; the
 * submit control is an icon with no accessible name.
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
        <h1 className="font-display text-5xl sm:text-7xl">Carry the lantern</h1>
        <p className="font-inter text-lg leading-8">
          Leave a name and Hikari will send the field notes for the next
          reading.
        </p>
        <form className="flex w-full max-w-sm flex-col items-stretch gap-3 text-left">
          <input
            placeholder="Name"
            className="h-11 rounded-full border border-foreground/20 bg-background px-4 font-inter text-sm"
          />
          <input
            placeholder="Email"
            className="h-11 rounded-full border border-red-600 bg-background px-4 font-inter text-sm"
          />
          <div className="flex items-center gap-2 px-2">
            <input type="checkbox" className="size-4" />
            <span className="font-inter text-sm">Send me the notes</span>
          </div>
          <button
            type="submit"
            className="mt-2 inline-flex size-11 items-center justify-center self-center rounded-full bg-black text-white"
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      </main>
    </div>
  );
}
