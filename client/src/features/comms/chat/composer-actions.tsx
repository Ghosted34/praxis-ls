import * as React from "react";
import { Popover } from "@/components/ui/popover";
import { PickerPanel } from "@/components/ui/emoji-picker";
import {
  PlusIcon,
  UploadIcon,
  CalendarIcon,
  PencilIcon,
  HashIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import type { ErpCard } from "@/lib/smartcomm-api";
import { ErpPicker } from "./erp-picker";
import { QuickPhrases } from "./quick-phrases";

export function ComposerActions({
  disabled,
  onEmoji,
  onFile,
  onRecord,
  onPhrase,
  onSchedule,
}: {
  disabled?: boolean;
  onEmoji: (glyph: string) => void;
  onFile: () => void;
  onRecord: (card: ErpCard) => void;
  onPhrase: (body: string) => void;
  onSchedule: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [panel, setPanel] = React.useState("menu");
  const close = () => setOpen(false);
  const itemClass =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setPanel("menu");
      }}
      label={tr("Message tools")}
      side="top"
      align="start"
      className="max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={tr("Add to message")}
          title={tr("Add to message")}
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
            className={itemClass}
            onClick={() => setPanel("emoji")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M8 14s1 3 4 3 4-3 4-3M8 9h1m6 0h1" />
            </svg>
            {tr("Insert Emoji")}
          </button>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onFile();
              close();
            }}
          >
            <UploadIcon />
            {tr("Attach File")}
          </button>
          <button
            type="button"
            className={itemClass}
            onClick={() => setPanel("record")}
          >
            <HashIcon />
            {tr("Attach Record / Context")}
          </button>
          <button
            type="button"
            className={itemClass}
            onClick={() => setPanel("phrases")}
          >
            <PencilIcon />
            {tr("Templates / Quick Phrases")}
          </button>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              close();
              onSchedule();
            }}
          >
            <CalendarIcon />
            {tr("Schedule Message")}
          </button>
        </div>
      )}
      {panel === "emoji" && <PickerPanel onPick={onEmoji} />}
      {panel === "record" && (
        <div className="p-3">
          <ErpPicker embedded open onClose={close} onPick={onRecord} />
        </div>
      )}
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
