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
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Hacktoberfest 2026
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Accessibility fixes that prove themselves
        </h1>
        <p className="text-lg leading-8 text-foreground">

        </p>
      </motion.section>
    </MotionConfig>
  );
}
