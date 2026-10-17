"use client";

import { MotionConfig } from "motion/react";
import * as motion from "motion/react-client";

export function Hero() {
  return (
    <MotionConfig reducedMotion="user">
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex max-w-xl flex-col items-center gap-6 text-center sm:items-start sm:text-left"
      >
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Hikari · Hacktoberfest 2026
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl dark:text-zinc-50">
          Accessibility fixes that prove themselves
        </h1>
        <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Next.js, Tailwind CSS e Motion sono pronti. Parti da qui per
          costruire il sito.
        </p>
      </motion.section>
    </MotionConfig>
  );
}
