import { type HTMLAttributes } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";

export function GlassCard({
  className,
  elevated,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { elevated?: boolean }) {
  return <div className={cn(elevated ? "glass-elevated" : "glass", className)} {...rest} />;
}

export function MotionGlassCard({
  className,
  elevated,
  ...rest
}: HTMLMotionProps<"div"> & { elevated?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(elevated ? "glass-elevated" : "glass", className)}
      {...rest}
    />
  );
}
