import { Hero } from "@/components/Hero";

export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-1 flex-col bg-background text-foreground">
      <p className="absolute top-6 left-6 font-inter text-sm font-medium tracking-wide text-muted-foreground uppercase">
        Hacktoberfest 2026
      </p>
      <main className="flex flex-1 items-center justify-center px-6">
        <Hero />
      </main>
    </div>
  );
}
