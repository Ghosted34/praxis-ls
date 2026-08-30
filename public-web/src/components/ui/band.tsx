import * as React from "react";
import { Section } from "@/components/site/section";

type SectionProps = React.ComponentProps<typeof Section>;

/**
 * A named surface for a public-web section. It delegates layout and spacing to
 * Section so bands cannot drift into a second section recipe.
 */
export function Band({
  surface = "plain",
  ...props
}: Omit<SectionProps, "variant"> & {
  surface?: "plain" | "muted" | "hero";
}) {
  const variant =
    surface === "hero" ? "dark" : surface === "muted" ? "muted" : "default";
  return <Section {...props} variant={variant} />;
}
