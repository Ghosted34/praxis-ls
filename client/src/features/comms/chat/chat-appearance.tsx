/**
 * Chat appearance — the control beside "New": a brand accent picker and a
 * per-device wallpaper upload. State + derivation live in
 * `./chat-appearance-store`; this file is only the UI.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import { Dialog } from "@/components/ui/dialog";
import { FilePicker } from "@/components/ui/image-upload";
import { useToast } from "@/components/ui/toast";
import { PaletteIcon } from "@/components/ui/icons";
import { compressImage, fileToDataUrl } from "@/lib/image-compress";
import type { ChatAppearance } from "./chat-appearance-store";

function SwatchChip({
  label,
  color,
  selected,
  onClick,
}: {
  label: string;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={label}
      className={cn(
        "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[12px] font-medium transition-colors",
        selected
          ? "border-primary/50 bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      <span
        aria-hidden
        className="h-6 w-6 rounded-full border border-border"
        style={{ background: color }}
      />
      {label}
    </button>
  );
}

export function ChatAppearanceButton({ appearance }: { appearance: ChatAppearance }) {
  const { accent, hasCustomWallpaper, swatches, setAccent, setWallpaper, clearWallpaper } = appearance;
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();

  async function onPick(files: FileList | null) {
    const file = files && files[0];
    if (!file) return;
    setBusy(true);
    try {
      // The engine's own compressor (never a hand-rolled canvas), tuned to a
      // photo so a phone shot lands as a small webp rather than several MB.
      const { file: compressed } = await compressImage(file, "photo");
      const dataUrl = await fileToDataUrl(compressed);
      if (setWallpaper(dataUrl)) toast.success(tr("Chat background updated."));
      else toast.error(tr("That image is too large to save on this device. Try a smaller one."));
    } catch {
      toast.error(tr("Couldn't use that image."));
    } finally {
      setBusy(false);
    }
  }

  const isSelected = (value: string) =>
    !!accent && accent.toLowerCase() === value.toLowerCase();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tr("Chat appearance")}
        title={tr("Chat appearance")}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PaletteIcon width={18} height={18} />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title={tr("Chat appearance")}>
        <div className="space-y-6">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Accent colour")}
            </h3>
            <p className="mb-3 mt-1 text-[12px] text-muted-foreground">
              {tr("Only your brand's colours — nothing new is created.")}
            </p>
            <div className="flex flex-wrap gap-2">
              <SwatchChip
                label={tr("Default")}
                color="var(--primary)"
                selected={!accent}
                onClick={() => setAccent(null)}
              />
              {swatches.map((s) => (
                <SwatchChip
                  key={s.value}
                  label={s.name}
                  color={s.value}
                  selected={isSelected(s.value)}
                  onClick={() => setAccent(s.value)}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Chat background")}
            </h3>
            <p className="mb-3 mt-1 text-[12px] text-muted-foreground">
              {tr("Saved on this device only, and shown very faintly behind messages.")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <FilePicker
                variant="inline"
                accept="image/*"
                onPick={onPick}
                trigger={busy ? tr("Processing…") : tr("Upload photo")}
                triggerClassName="chat-pill chat-pill--accent cursor-pointer"
              />
              {hasCustomWallpaper && (
                <button
                  type="button"
                  onClick={clearWallpaper}
                  className="chat-pill chat-pill--ghost"
                >
                  {tr("Remove")}
                </button>
              )}
            </div>
          </section>
        </div>
      </Dialog>
    </>
  );
}
