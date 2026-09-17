import * as React from "react";

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".bmp",
  ".avif",
  ".heic",
  ".heif",
]);

const MIME_EXTENSIONS: Readonly<Record<string, string[]>> = {
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/zip": [".zip"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/svg+xml": [".svg"],
};

type PasteFileResult =
  | { kind: "accepted"; file: File }
  | { kind: "rejected" }
  | { kind: "empty" };

function acceptTokens(accept?: string): string[] {
  return (accept || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function fileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

export function fileMatchesAccept(file: File, accept?: string): boolean {
  const tokens = acceptTokens(accept);
  if (!tokens.length) return true;
  const mime = (file.type || "").toLowerCase();
  const ext = fileExtension(file.name);

  return tokens.some((token) => {
    if (token === "*/*") return true;
    if (token.startsWith(".")) return ext === token;
    if (token.endsWith("/*")) {
      const prefix = token.slice(0, -1);
      return mime.startsWith(prefix);
    }
    return mime === token || MIME_EXTENSIONS[token]?.includes(ext) === true;
  });
}

function clipboardFileCandidates(dt: DataTransfer): File[] {
  const preferred: File[] = [];
  const rest: File[] = [];

  for (const item of Array.from(dt.items || [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (item.type === "image/png") preferred.push(file);
    else rest.push(file);
  }

  return [...preferred, ...rest, ...Array.from(dt.files || [])].filter(
    (file): file is File => Boolean(file),
  );
}

export function pasteFileFromEvent(
  event:
    | Pick<ClipboardEvent, "clipboardData">
    | Pick<React.ClipboardEvent<HTMLElement>, "clipboardData">
    | DataTransfer
    | null
    | undefined,
  accept?: string,
): PasteFileResult {
  const dt =
    event && "clipboardData" in event ? event.clipboardData : (event ?? null);
  if (!dt) return { kind: "empty" };

  const candidates = clipboardFileCandidates(dt);
  if (!candidates.length) return { kind: "empty" };

  for (const file of candidates) {
    if (fileMatchesAccept(file, accept)) return { kind: "accepted", file };
  }

  return { kind: "rejected" };
}

export function acceptsOnlyImages(accept?: string): boolean {
  const tokens = acceptTokens(accept);
  if (!tokens.length) return false;
  return tokens.every(
    (token) => token.startsWith("image/") || IMAGE_EXTENSIONS.has(token),
  );
}

export function pastedFileList(file: File): FileList {
  const files = [file];
  return Object.assign(files, {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList;
}
