/**
 * AttachmentPicker — the console's one file-upload surface (support tickets,
 * 0105). The whole reason this file exists is the repo's no-raw-upload rule:
 * a raw `<input type="file">` is only legal inside a file named
 * `components/ui/file-upload.tsx` (the rule's path exemption), and the console
 * has no image engine to import from `client/` — it installs its own
 * dependencies. So the engine's three non-negotiables are honoured here, in
 * miniature: a preview the moment the picker closes, an explicit
 * uploading/done/error state per file, and a cap enforced at the door.
 *
 * Compression is the one thing this file deliberately does NOT do: the
 * console's user is an admin on a corporate connection attaching a screenshot
 * to a reply, not a field operator on a corridor phone — and the TENANT side
 * (which IS on the phone) compresses through `client/`'s full engine.
 */
import * as React from "react";
import { Button } from "../ui";

export type ConsoleUploadItem<T> = {
  key: string;
  file: File;
  preview: string | null;
  state: "uploading" | "done" | "error";
  error: string | null;
  result: T | null;
};

let seq = 0;

export function AttachmentPicker<T>({
  send,
  accept = "image/png,image/jpeg,image/webp,image/gif",
  maxBytes,
  max = 5,
  label = "Attach an image",
  onItems,
  disabled = false,
}: {
  send: (file: File) => Promise<T>;
  accept?: string;
  maxBytes?: number;
  max?: number;
  label?: string;
  onItems: (items: ConsoleUploadItem<T>[]) => void;
  disabled?: boolean;
}) {
  const [items, setItems] = React.useState<ConsoleUploadItem<T>[]>([]);
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const urls = React.useRef(new Set<string>());

  const publish = React.useCallback(
    (next: ConsoleUploadItem<T>[]) => {
      itemsRef.current = next;
      setItems(next);
      onItems(next);
    },
    [onItems],
  );

  const revoke = React.useCallback((url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  }, []);

  // Every object URL dies with the component — a preview that is never
  // revoked pins the whole File for the life of the tab.
  React.useEffect(() => {
    const urlSet = urls.current;
    return () => {
      urlSet.forEach((u) => URL.revokeObjectURL(u));
      urlSet.clear();
    };
  }, []);

  const patch = (key: string, next: Partial<ConsoleUploadItem<T>>) =>
    publish(
      itemsRef.current.map((it) => (it.key === key ? { ...it, ...next } : it)),
    );

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files || []);
    const room = max - itemsRef.current.length;
    if (room <= 0) return;
    const created: ConsoleUploadItem<T>[] = list.slice(0, room).map((file) => {
      const tooBig = maxBytes != null && file.size > maxBytes;
      const preview =
        file.type.startsWith("image/") && !tooBig
          ? URL.createObjectURL(file)
          : null;
      if (preview) urls.current.add(preview);
      return {
        key: `cu_${Date.now().toString(36)}_${(seq += 1)}`,
        file,
        preview,
        state: tooBig ? "error" : "uploading",
        error: tooBig
          ? `That image is larger than ${Math.round((maxBytes as number) / 1024 / 1024)} MB.`
          : null,
        result: null,
      };
    });
    if (!created.length) return;
    publish([...itemsRef.current, ...created]);
    await Promise.all(
      created
        .filter((c) => c.state !== "error")
        .map(async (c) => {
          try {
            const result = await send(c.file);
            patch(c.key, { state: "done", result });
          } catch (e) {
            patch(c.key, {
              state: "error",
              error: (e as Error)?.message || "That upload did not go through.",
            });
          }
        }),
    );
  }

  const remove = (key: string) => {
    const hit = itemsRef.current.find((it) => it.key === key);
    if (hit) revoke(hit.preview);
    publish(itemsRef.current.filter((it) => it.key !== key));
  };

  return (
    <div>
      {!disabled && (
        <Button
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={items.length >= max}
          aria-label={label}
        >
          🖼 {items.length >= max ? `Up to ${max} images` : label}
        </Button>
      )}
      {/* The one raw input this file is allowed to own — the rule exempts
          components/ui/file-upload.tsx by path, and this is its whole
          justification. */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        style={{ display: "none" }}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
        aria-hidden
        tabIndex={-1}
      />
      {items.length > 0 && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {items.map((it) => (
            <li key={it.key} style={{ position: "relative" }}>
              {it.preview ? (
                <img
                  src={it.preview}
                  alt={it.file.name}
                  style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }}
                />
              ) : (
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 20,
                  }}
                >
                  🖼
                </div>
              )}
              <span
                className="pill"
                style={{
                  position: "absolute",
                  left: 4,
                  bottom: 4,
                  fontSize: 10,
                  padding: "1px 6px",
                  background: it.state === "error" ? "rgba(229,84,75,.2)" : it.state === "done" ? "rgba(40,192,122,.2)" : "var(--panel-2)",
                }}
                title={it.error || undefined}
              >
                {it.state === "uploading" ? "…" : it.state === "done" ? "✓" : "✕"}
              </span>
              <button
                type="button"
                onClick={() => remove(it.key)}
                aria-label={`Remove ${it.file.name}`}
                style={{
                  position: "absolute",
                  right: 2,
                  top: 2,
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  background: "var(--panel-2)",
                  color: "var(--ink-2)",
                  width: 18,
                  height: 18,
                  lineHeight: "14px",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
              {it.error && (
                <div style={{ fontSize: 10.5, color: "#ff9a92", maxWidth: 110, marginTop: 3 }}>{it.error}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
