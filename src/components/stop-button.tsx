"use client";

import { Button } from "@/components/ui/button";

/**
 * Stop/Pause button for cancelling LLM operations.
 * Only renders when `show` is true (during loading/streaming).
 */
export function StopButton({
  show,
  onClick,
  label,
  size = "sm",
}: {
  show: boolean;
  onClick: () => void;
  label?: string;
  size?: "sm" | "default" | "lg";
}) {
  if (!show) return null;

  return (
    <Button
      variant="outline"
      size={size}
      className="text-xs h-7 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={onClick}
    >
      <span className="mr-1">&#x25A0;</span>
      {label ?? "停止"}
    </Button>
  );
}
