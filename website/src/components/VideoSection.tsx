"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";

export function VideoSection() {
  const [isExpanded, setIsExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const id = useId();
  const playerId = `${id}-player`;
  const hiddenIcon = {
    opacity: 0,
    scale: reduceMotion ? 1 : 0.25,
    filter: reduceMotion ? "blur(0px)" : "blur(4px)",
  };

  return (
    <MotionConfig reducedMotion="user">
      <motion.section
        layout
        initial={false}
        aria-label="Video walkthrough"
        className="w-full"
        style={{ maxWidth: isExpanded ? "72rem" : "40rem" }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      >
        <motion.div
          layout="position"
          className="mb-3 flex min-h-10 items-center justify-between gap-4"
        >
          <button
            type="button"
            aria-label={isExpanded ? "Reduce video" : "Expand video"}
            aria-expanded={isExpanded}
            aria-controls={playerId}
            onClick={() => setIsExpanded((expanded) => !expanded)}
            className="hidden size-10 shrink-0 items-center justify-center rounded-full border border-foreground/15 bg-background transition-[background-color,scale] duration-150 ease-out hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-safe:active:scale-[0.96] md:inline-flex"
          >
            <span className="relative size-4 shrink-0" aria-hidden="true">
              <AnimatePresence initial={false}>
                <motion.svg
                  key={isExpanded ? "reduce" : "expand"}
                  initial={hiddenIcon}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={hiddenIcon}
                  transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                  className="absolute inset-0"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path
                    d={
                      isExpanded
                        ? "M4 9h5V4m11 11h-5v5M9 9 3 3m12 12 6 6"
                        : "M9 3H3v6m12 12h6v-6M3 3l6 6m6 6 6 6"
                    }
                  />
                </motion.svg>
              </AnimatePresence>
            </span>
          </button>
        </motion.div>
        <motion.div
          layout
          id={playerId}
          className="relative grid aspect-video w-full place-items-center overflow-hidden bg-foreground p-6 text-background shadow-[0_0_0_1px_rgba(0,0,0,0.1)]"
          style={{ borderRadius: 16 }}
        >
          {/* Replace the placeholder with the Bunny iframe when available. */}
          <motion.p layout="position" className="text-center text-sm text-background/70">
            Video coming soon
          </motion.p>
        </motion.div>
      </motion.section>
    </MotionConfig>
  );
}
