/**
 * The client chat's reply tools (client portal PR 3) — the Smart Comms team
 * chat's pattern: one round `+` beside the reply box that opens a menu, rather
 * than a row of text links under it.
 *
 *   Photo or document   the upload engine's picker (preview, percentage,
 *                       compression — CLAUDE.md), sent with the reply
 *   Share a location    where you are, confirmed and named before it goes
 *   Emoji               into the reply where the cursor is
 *   Quick replies       the team's saved phrases, shared with the team chat
 *                       (Smart Comms, MOD-64 — offered only to its holders)
 *
 * Voice notes are the microphone that stands in the Send button's place while
 * the reply is empty, as in the team chat.
 */
import * as React from "react";
import { Popover } from "@/components/ui/popover";
import { PickerPanel } from "@/components/ui/emoji-picker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { ImageIcon, MapPinIcon, PlusIcon, SendIcon, SmileIcon, ZapIcon } from "@/components/ui/icons";
import { QuickPhrases } from "@/features/comms/chat/quick-phrases";
import { tr } from "@/lib/i18n";

type Panel = "menu" | "emoji" | "phrases";

const ITEM =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ClientChatTools({
  disabled,
  onFile,
  onLocation,
  onEmoji,
  onPhrase,
  phrases = true,
}: {
  disabled?: boolean;
  /** Open the upload engine's picker. */
  onFile: () => void;
  onLocation: () => void;
  onEmoji: (glyph: string) => void;
  onPhrase: (body: string) => void;
  /** Quick replies live in Smart Comms; offer them only to people who hold it. */
  phrases?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [panel, setPanel] = React.useState<Panel>("menu");
  const close = () => setOpen(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setPanel("menu");
      }}
      label={tr("Add to the reply")}
      side="top"
      align="start"
      className="max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={tr("Add to the reply")}
          title={tr("Add to the reply")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <PlusIcon width={20} height={20} />
        </button>
      }
    >
      {panel !== "menu" && (
        <div className="border-b border-border px-2 py-1">
          <Button size="sm" variant="ghost" onClick={() => setPanel("menu")}>
            {tr("Back to tools")}
          </Button>
        </div>
      )}
      {panel === "menu" && (
        <div className="p-1.5">
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              // Opens the picker inside this click — a browser only shows a
              // file dialog from a user's own gesture.
              onFile();
              close();
            }}
          >
            <ImageIcon />
            {tr("Photo or document")}
          </button>
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              close();
              onLocation();
            }}
          >
            <MapPinIcon />
            {tr("Share a location")}
          </button>
          <button type="button" className={ITEM} onClick={() => setPanel("emoji")}>
            <SmileIcon />
            {tr("Emoji")}
          </button>
          {phrases ? (
            <button type="button" className={ITEM} onClick={() => setPanel("phrases")}>
              <ZapIcon />
              {tr("Quick replies")}
            </button>
          ) : null}
        </div>
      )}
      {panel === "emoji" && <PickerPanel onPick={onEmoji} />}
      {panel === "phrases" && (
        <QuickPhrases
          onInsert={(body) => {
            onPhrase(body);
            close();
          }}
        />
      )}
    </Popover>
  );
}

export type SharedPlace = { lat: number; lng: number; label: string };
type Fix = { lat: number; lng: number; accuracy: number | null };

/** "± 12 m" / "± 3.4 km". */
function roughly(metres: number): string {
  return metres >= 1000 ? `± ${(metres / 1000).toFixed(1)} km` : `± ${Math.round(metres)} m`;
}

/**
 * Where you are, shown before it is sent and named if you like ("Warehouse B,
 * gate 3") — a pin with no name is a riddle for the client. A computer's
 * position can be kilometres out, and this says so rather than sending it as
 * if it were exact.
 */
export function ShareLocationDialog({
  open,
  onClose,
  onSend,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (place: SharedPlace) => void;
  busy?: boolean;
}) {
  const [fix, setFix] = React.useState<Fix | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setFix(null);
    setError(null);
    setLabel("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError(tr("This browser cannot tell where you are."));
      return;
    }
    let live = true;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (live) setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null });
      },
      (e) => {
        if (!live) return;
        setError(
          e.code === 1
            ? tr("Location is blocked for this site. Allow it in the browser, then try again.")
            : tr("Your position could not be found. Try again in a moment."),
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
    return () => {
      live = false;
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Share a location")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button
            onClick={() => fix && onSend({ lat: fix.lat, lng: fix.lng, label: label.trim() })}
            disabled={!fix}
            loading={busy}
            icon={<SendIcon />}
          >
            {tr("Send location")}
          </Button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="text-sm text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : !fix ? (
        <p role="status" className="text-sm text-muted-foreground">
          {tr("Finding where you are…")}
        </p>
      ) : (
        <div className="grid gap-3">
          <p className="flex items-center gap-2 text-sm text-foreground">
            <MapPinIcon />
            <span className="tabular-nums">
              {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
            </span>
            {fix.accuracy !== null ? <span className="text-xs text-muted-foreground">{roughly(fix.accuracy)}</span> : null}
          </p>
          {fix.accuracy !== null && fix.accuracy > 1000 ? (
            <p className="text-xs text-muted-foreground">
              {tr("This position is approximate. On a computer it can be several kilometres out, so name the place below.")}
            </p>
          ) : null}
          <Field label={tr("Name of the place")} hint={tr("Optional — e.g. Warehouse B, gate 3")}>
            <Input value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
