"use client";

/**
 * Lightweight toast notification system — no external deps.
 *
 * Usage:
 *   import { toast } from "@/components/toast";
 *   toast.error("检索失败，请稍后重试");
 *   toast.success("已保存");
 *   toast.info("正在后台分析...");
 *
 * <Toaster /> is mounted once in the root layout.
 */
import { useEffect, useState } from "react";

export type ToastKind = "error" | "success" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (toasts: ToastItem[]) => void;

let nextId = 1;
let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

const DURATION: Record<ToastKind, number> = {
  error: 6000,
  success: 3000,
  info: 4000,
};

function emit() {
  for (const l of listeners) l(toasts);
}

function push(kind: ToastKind, message: string) {
  // Dedupe: identical message already visible — don't stack
  if (toasts.some((t) => t.message === message && t.kind === kind)) return;
  const item: ToastItem = { id: nextId++, kind, message };
  toasts = [...toasts.slice(-4), item]; // cap at 5 visible
  emit();
  setTimeout(() => dismiss(item.id), DURATION[kind]);
}

export function dismiss(id: number) {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

export const toast = {
  error: (message: string) => push("error", message),
  success: (message: string) => push("success", message),
  info: (message: string) => push("info", message),
};

const KIND_STYLES: Record<ToastKind, string> = {
  error: "border-red-300 bg-red-50 text-red-800",
  success: "border-green-300 bg-green-50 text-green-800",
  info: "border-blue-300 bg-blue-50 text-blue-800",
};

const KIND_ICONS: Record<ToastKind, string> = {
  error: "✕",
  success: "✓",
  info: "ℹ",
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (t) => setItems(t);
    listeners.add(listener);
    listener(toasts);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {items.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 shadow-lg text-sm animate-in slide-in-from-bottom-2 ${KIND_STYLES[t.kind]}`}
        >
          <span className="font-bold shrink-0">{KIND_ICONS[t.kind]}</span>
          <span className="flex-1 break-words">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-50 hover:opacity-100 ml-1"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
