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
        className="flex max-w-xl flex-col items-center gap-6 text-center"
      >
        <img
          src="/img/hikari_icon.svg"
          alt=""
          width={64}
          height={67}
          className="h-16 w-16"
        />
        <h1 className="font-display text-6xl text-foreground sm:text-8xl">
          Hikari
        </h1>
        <p className="text-lg leading-8 text-foreground">
          Accessibility fixes that prove themselves
        </p>
      </motion.section>
    </MotionConfig>
  );
}
