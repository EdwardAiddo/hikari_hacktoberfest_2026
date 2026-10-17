import Image from "next/image";
import { Hero } from "@/components/Hero";
import { VideoSection } from "@/components/VideoSection";

export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-clip bg-background text-foreground [overflow-anchor:none]">
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
      <main className="relative z-10 flex flex-1 flex-col items-center gap-16 px-6 pt-28 pb-24">
        <Hero />
        <div className="video-reveal flex w-full justify-center">
          <VideoSection bunnyEmbedUrl={process.env.NEXT_PUBLIC_BUNNY_EMBED_URL} />
        </div>
      </main>
    </div>
  );
}
