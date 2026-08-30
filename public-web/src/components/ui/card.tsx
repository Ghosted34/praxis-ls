import * as React from "react";
import { cn } from "@/lib/cn";

/** The card surface, which is the `.lux-card` recipe and nothing more. Its own
 *  file so the portal screens and the marketing cards cannot diverge into two
 *  different hairlines and two different radii. */
export function Card({
  className,
  children,
  as: Tag = "div",
  padded = false,
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "article" | "section" | "li";
  padded?: boolean;
}) {
  return (
    <Tag className={cn("lux-card", padded && "p-5", className)}>{children}</Tag>
  );
}
