/** Numbers as people type them into the portal. */

/**
 * What a person types into an amount box, read the way they meant it:
 * "3,270,500" and "3 270 500" and "3.270.500" are all three million; "1850,50"
 * and "1850.50" are both a decimal. A lone separator followed by exactly three
 * digits is a thousands separator — an amount paid is never 3.270 francs.
 */
export function parseAmount(raw: string): number {
  let v = String(raw || "").replace(/[\s\u00a0\u202f]/g, "");
  if (!v) return NaN;
  const hasComma = v.includes(",");
  const hasDot = v.includes(".");
  if (hasComma && hasDot) {
    const dec = v.lastIndexOf(",") > v.lastIndexOf(".") ? "," : ".";
    v = v.split(dec === "," ? "." : ",").join("").replace(dec, ".");
  } else if (hasComma || hasDot) {
    const sep = hasComma ? "," : ".";
    const parts = v.split(sep);
    v = parts.length > 2 || parts[parts.length - 1].length === 3 ? parts.join("") : parts.join(".");
  }
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
}

