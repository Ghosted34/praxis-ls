import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The shared eyebrow, heading, accent and lead recipe for public-web sections.
 * Keeping the accent inside the heading preserves one accessible name.
 */
type Icon = React.ComponentType<{ size?: number; className?: string }>;

type HeadingTag = "h1" | "h2" | "h3";

export function SectionHead({
  eyebrow,
  icon: Icon,
  title,
  accent,
  lead,
  align = "left",
  titleAs = "h2",
  className,
}: {
  eyebrow?: React.ReactNode;
  icon?: Icon;
  title: React.ReactNode;
  accent?: React.ReactNode;
  lead?: React.ReactNode;
  align?: "left" | "center";
  titleAs?: HeadingTag;
  className?: string;
}) {
  const Tag = titleAs;
  const centered = align === "center";

  return (
    <div
      className={cn(
        "flex flex-col",
        centered ? "items-center text-center" : "items-start",
        className,
      )}
    >
      {eyebrow && (
        <p className="eyebrow inline-flex items-center gap-2">
          {Icon && <Icon size={14} />}
          {eyebrow}
        </p>
      )}
      <Tag
        className={cn(
          titleAs === "h1" ? "hero-title" : "section-title",
          "mt-2",
        )}
      >
        {title}
        {accent && (
          <>
            {" "}
            <span className="text-[rgb(var(--brand-orange))]">{accent}</span>
          </>
        )}
      </Tag>
      {lead && (
        <p
          className={cn(
            "mt-3 max-w-measure text-muted-foreground",
            centered && "text-center",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}
