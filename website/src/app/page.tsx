import { Hero } from "@/components/Hero";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-24 dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col items-center sm:items-start">
        <Hero />
      </main>
    </div>
  );
}
