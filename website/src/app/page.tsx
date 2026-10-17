import Image from "next/image";
import Link from "next/link";
import { Hero } from "@/components/Hero";

export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-background text-foreground">
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
          loading="eager"
          className="ascii-mark h-[110vh] w-auto max-w-none"
        />
      </div>
      <p className="animate-enter absolute top-6 left-6 z-10 font-inter text-sm font-bold tracking-wide text-muted-foreground">
        Hacktoberfest 2026
      </p>
      <Link
        href="/demo"
        className="animate-enter absolute top-6 right-6 z-20 inline-flex min-h-10 items-center rounded-full bg-black px-5 py-2 font-inter text-sm text-white transition-transform duration-150 ease-out motion-safe:active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
      >
        Demo
      </Link>
      <main className="relative z-10 flex flex-1 justify-center px-6 pt-28">
        <Hero />
      </main>
    </div>
  );
}
