import Image from "next/image";

export function Hero() {
  return (
    <section className="flex max-w-xl flex-col items-center gap-6 text-center">
      <Image
        src="/img/hikari_icon.svg"
        alt=""
        width={24}
        height={25}
        unoptimized
        className="animate-enter enter-delay-1 h-16 w-16"
      />
      <h1 className="animate-enter enter-delay-2 font-display text-6xl text-foreground sm:text-8xl">
        Hikari
      </h1>
      <p className="animate-enter enter-delay-3 text-lg leading-8 text-foreground">
        Accessibility fixes that prove themselves
      </p>
    </section>
  );
}
