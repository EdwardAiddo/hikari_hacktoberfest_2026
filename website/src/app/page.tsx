import { Hero } from "@/components/Hero";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-24 text-foreground">
      <main className="flex w-full max-w-3xl flex-col items-center sm:items-start">
        <Hero />
      </main>
    </div>
  );
}
