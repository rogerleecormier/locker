import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Memory } from "~/db/schema";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type StalenessLevel = "fresh" | "aging" | "stale" | "never-used";

export function getMemoryStaleness(memory: Memory): { level: StalenessLevel; label: string } {
  if (!memory.lastAccessedAt) return { level: "never-used", label: "Never recalled" };
  const daysSince = (Date.now() - memory.lastAccessedAt) / (1000 * 60 * 60 * 24);
  if (daysSince < 7) return { level: "fresh", label: `Last used ${Math.round(daysSince)}d ago` };
  if (daysSince < 30) return { level: "aging", label: `Last used ${Math.round(daysSince)}d ago` };
  return { level: "stale", label: `Last used ${Math.round(daysSince)}d ago` };
}
