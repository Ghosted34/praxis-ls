import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Same helper as `client/src/lib/cn.ts`. Tailwind classes in this app are
 *  composed at call sites (a card's variant + a section's override), and plain
 *  string concatenation lets two conflicting utilities both survive. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
