"use client";

import { useRef } from "react";
import { useInView, useMotionValue, useTransform, animate, motion } from "framer-motion";
import { useEffect } from "react";

export function AnimatedCounter({
  value,
  suffix = "",
  duration = 1.5,
}: {
  value: number;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.floor(v).toLocaleString());

  useEffect(() => {
    if (isInView) {
      animate(motionValue, value, {
        duration,
        ease: [0.21, 0.47, 0.32, 0.98],
      });
    }
  }, [isInView, value, duration, motionValue]);

  return (
    <motion.span ref={ref}>
      {rounded}
      {suffix}
    </motion.span>
  );
}
