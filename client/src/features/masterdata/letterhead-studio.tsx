/**
 * THE LETTERHEAD STUDIO — a drag-and-drop editor for the one shell every
 * document prints.
 *
 * WHAT IT EDITS. `entity_letterhead` plus `entity_letterhead_line`, composed by
 * `services/documents/templates/letterhead-blocks` on the server. Since 12760
 * that composition is what the RENDERER prints from, so a change here changes
 * every invoice, transit order, payslip and delivery note the tenant issues.
 * Before it, this tab wrote a row nothing read: a tenant could switch the share
 * capital off, watch the old preview obey, and keep printing it.
 *
 * ── Why the canvas draws COMPOSED BLOCKS and never re-derives content ───────
 * The blocks arriving on `bundle.blocks[lang]` are the renderer's own output —
 * the same objects `kit.standardHead` turns into print HTML, with their lines
 * already resolved from the entity's addresses, registrations, treasury
 * accounts and tokens. This component positions and styles them; it does not
 * decide what they SAY.
 *
 * That distinction is the whole reason the previous preview was wrong. It
 * hand-drew its own <header>/<footer> from a flat JSON shape, and its docstring
 * claimed it was "rendered by the same code the invoice generator uses" — true
 * of the data, false of the pixels, and it drifted: it showed a payment block
 * on documents that never print one. A canvas that re-derives is a canvas that
 * eventually lies.
 *
 * ── Millimetres, not pixels ────────────────────────────────────────────────
 * The page is drawn at true A4/Letter proportions and every measurement is in
 * millimetres scaled by one factor (`--mm`). Type sizes come from the same
 * points-to-millimetres constants the server measures with, so a block that
 * looks like it fits here fits there. `height.header_mm` is reported back from
 * the server's own `measure()` and shown on the rail — because on an instrument
 * sheet those millimetres are the difference between one page and two.
 *
 * ── Deep links ─────────────────────────────────────────────────────────────
 * Every block carries `source: { tab, field }` from the server catalogue, so
 * "the NIU is wrong" is one click to the input that sets it — `?tab=…&field=…`,
 * read by `use-url-tab`'s `useFieldHighlight`. The route is never hardcoded
 * here; a block that moves to another tab moves its own link with it.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { Field } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/use-confirm";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/masterdata-api";
import { errMsg } from "@/lib/use-resource";

type Lang = "fr" | "en";
type Zone = "header" | "footer";

/** Points to millimetres, and the leading — the server measures with these. */
const MM_PER_PT = 0.3528;
const LEADING = 1.45;
const COLS = 12;

/** The base type size for a block, in points. Mirrors the kit's `blockHtml`. */
function basePt(b: api.LetterheadBlock): number {
  if (b.zone === "header") {
    if (b.kind === "wordmark") return 15;
    return b.id === "company_name" ? 11.5 : 7.4;
  }
  return 7;
}

const PAPER = { A4: { w: 210, h: 297 }, LETTER: { w: 215.9, h: 279.4 } };

/**
 * The `entity_letterhead.show_*` columns the visibility control may write.
 *
 * A block arrives carrying `toggle` — the column(s) that govern it — resolved
 * by the server catalogue, and `place()` writes them alongside the layout so one
 * checkbox does not contradict a column the tenant already set.
 *
 * WHY AN ALLOW-LIST AND NOT JUST `body[col] = value`. Two reasons, and the
 * second is the one that bites.
 *
 * 1. It is a column name from a response being used as a key in a write
 *    payload. The server validates the body against `letterheadUpdate` and the
 *    repo keeps its own allow-list, so an unexpected name is rejected rather
 *    than stored — but narrowing it here means the request is never malformed
 *    in the first place.
 *
 * 2. `check-schemas.mjs` rule 6 requires every saveable letterhead column to be
 *    NAMED where a person can reach it, because six columns once existed that
 *    the API happily saved and the designer never mentioned. Listing them here
 *    is how that rule stays true now the toggles are driven by block selection
 *    rather than by a checkbox list — and it keeps them greppable for the next
 *    person, which a `toggle` array resolved at runtime does not.
 */
const TOGGLE_COLUMNS = [
  "show_legal_form",
  "show_share_capital",
  "show_registered_address",
  "show_registrations",
  "show_contact",
  "show_bank_block",
  "show_establishment",
] as const;

/**
 * THE PRINT PALETTE — and the one place in this product that deliberately does
 * not follow the tenant's theme.
 *
 * Everything else in the app takes its colour from semantic tokens so that dark
 * mode and white-labelling work. This canvas must not: it is a picture of a
 * PIECE OF PAPER, and paper is white in both themes. Painted with `bg-card` the
 * sheet came out dark-on-light in dark mode while the PDF it depicts is
 * black-on-white — a WYSIWYG editor showing the opposite of what prints, which
 * is the exact failure the old hand-drawn preview was replaced for.
 *
 * So these are the SERVER's own values, mirrored: `kit.defaults()` sets
 * ink #101E34, muted #6B7A90 and rule #B7C4D6, and renders on white. A drift
 * between the two makes the canvas lie, so `tests/unit/letterhead-blocks.test.js`
 * reads both files and fails if they disagree.
 *
 * The chrome AROUND the sheet stays themed — it is app, not document.
 */
const PRINT = {
  paper: "#FFFFFF",
  ink: "#101E34",
  muted: "#6B7A90",
  rule: "#B7C4D6",
};

/* ────────────────────────────────────────────────────────────────────────────
 * One block on the canvas.
 *
 * Draggable, selectable, and drawn from its composed lines. An empty block is
 * shown as a dashed ghost with its own name rather than as nothing: a block
 * switched on with nothing behind it looks identical to one switched off, and
 * that is the failure a picture alone hides.
 * ──────────────────────────────────────────────────────────────────────────── */
function CanvasBlock({
  block,
  lang,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
  accent,
}: {
  block: api.LetterheadBlock;
  lang: Lang;
  selected: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  accent: string;
}) {
  const label = block.label[lang] || block.label.en || block.id;

  const body = (() => {
    if (block.kind === "rule") {
      return (
        <div
          style={{ borderBottomWidth: "0.7mm", borderBottomStyle: "solid", borderBottomColor: accent }}
        />
      );
    }
    if (block.empty) {
      return (
        <span className="micro italic" style={{ color: PRINT.muted }}>
          {label} — {tr("nothing to print")}
        </span>
      );
    }
    if (block.kind === "image") {
      const src = block.lines[0]?.src;
      return src ? (
        <img
          src={src}
          alt=""
          style={{ height: `calc(${block.height_mm || 15} * var(--mm))`, width: "auto", objectFit: "contain" }}
          className={
            block.align === "center" ? "mx-auto" : block.align === "right" ? "ml-auto" : ""
          }
        />
      ) : null;
    }
    const pt = basePt(block) * (block.size || 1);
    return (
      <div
        style={{
          fontSize: `calc(${(pt * MM_PER_PT).toFixed(3)} * var(--mm))`,
          lineHeight: LEADING,
          fontWeight: block.weight === "bold" ? 800 : 400,
          textTransform: block.transform === "upper" ? "uppercase" : "none",
          letterSpacing: block.transform === "upper" ? "0.03em" : undefined,
          color:
            block.tone === "accent" ? accent : block.tone === "muted" ? PRINT.muted : PRINT.ink,
        }}
      >
        {block.lines.map((l, i) => (
          <div key={i} className="break-words">
            {l.text}
          </div>
        ))}
      </div>
    );
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${label}${block.empty ? ` — ${tr("nothing to print")}` : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag without data on the transfer.
        e.dataTransfer.setData("text/plain", block.id);
        onDragStart();
      }}
      // On the draggable element itself: a wrapper <div> carrying a drag
      // handler is a non-native interactive element, and the drag it is ending
      // is this block's.
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      data-lh-block={block.id}
      className={[
        "cursor-grab rounded-sm outline-offset-2 transition-[background-color,outline-color]",
        "hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring",
        selected ? "outline outline-2 outline-ring bg-primary/10" : "outline-none",
        block.empty ? "border border-dashed px-1" : "",
      ].join(" ")}
      style={{
        borderColor: block.empty ? PRINT.rule : undefined,
        textAlign: block.align,
        gridColumn: `${(block.col || 0) + 1} / span ${block.span || COLS}`,
      }}
    >
      {body}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * A zone (header or footer) as a twelve-column grid of drop targets.
 *
 * Rows are the drop granularity, plus one trailing row so a block can be pulled
 * out onto a line of its own. Dropping reports (row, col) and the caller
 * rewrites the placement — the grid never mutates the composition itself,
 * because the composition is the server's.
 * ──────────────────────────────────────────────────────────────────────────── */
function CanvasZone({
  zone,
  blocks,
  lang,
  selectedId,
  onSelect,
  onDragStart,
  onDragEnd,
  onDrop,
  accent,
  dragging,
}: {
  zone: Zone;
  blocks: api.LetterheadBlock[];
  lang: Lang;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (row: number, col: number) => void;
  accent: string;
  dragging: string | null;
}) {
  const [over, setOver] = React.useState<string | null>(null);
  const live = blocks.filter((b) => b.visible);
  const rows = [...new Set(live.map((b) => b.row))].sort((a, b) => a - b);
  // The trailing row is the "put it on its own line" target. Without it a block
  // can only ever be moved between rows that already exist.
  const rowKeys = [...rows, (rows[rows.length - 1] ?? -1) + 1];

  return (
    <div data-lh-zone={zone}>
      {rowKeys.map((row) => {
        const inRow = live.filter((b) => b.row === row);
        const cols = [...new Set(inRow.map((b) => b.col))].sort((a, b) => a - b);
        return (
          <div
            key={row}
            className="relative grid"
            style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, alignItems: "end", columnGap: "calc(3 * var(--mm))" }}
          >
            {/* The drop lanes sit UNDER the blocks: a full-row strip of twelve
                targets, so a drop lands on a column even where no block is. */}
            {/*
              * The drop lanes: twelve targets across the row, under the blocks.
              *
              * THEY ARE BUTTONS, not styled divs, and that is not only to
              * satisfy the a11y rule. A drop lane that is a button is focusable
              * and activatable, so the same twelve targets a mouse drags onto
              * are the twelve a keyboard can Tab to and press — which is the
              * only reason a drag-and-drop canvas is operable without a mouse
              * at all. The inspector's row/column inputs remain as the precise
              * path; this is the direct one.
              */}
            {dragging &&
              Array.from({ length: COLS }, (_, col) => {
                const key = `${row}:${col}`;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`${tr("Move here")} — ${tr("row")} ${row + 1}, ${tr("column")} ${col + 1}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setOver(key);
                    }}
                    onDragLeave={() => setOver((o) => (o === key ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setOver(null);
                      onDrop(row, col);
                    }}
                    onClick={() => {
                      setOver(null);
                      onDrop(row, col);
                    }}
                    className={[
                      "absolute inset-y-0 z-10 border-l",
                      over === key
                        ? "border-ring bg-primary/10"
                        : "border-transparent focus-visible:border-ring focus-visible:bg-primary/10",
                    ].join(" ")}
                    style={{ left: `${(col / COLS) * 100}%`, width: `${100 / COLS}%` }}
                  />
                );
              })}
            {cols.map((col) => (
              <div
                key={col}
                className="min-w-0"
                style={{
                  gridColumn: `${col + 1} / span ${Math.min(
                    COLS - col,
                    Math.max(...inRow.filter((b) => b.col === col).map((b) => b.span || COLS)),
                  )}`,
                  textAlign: inRow.find((b) => b.col === col)?.align,
                }}
              >
                {inRow
                  .filter((b) => b.col === col)
                  .map((b) => (
                    <CanvasBlock
                      key={b.id}
                      block={b}
                      lang={lang}
                      accent={accent}
                      selected={selectedId === b.id}
                      onSelect={() => onSelect(b.id)}
                      onDragStart={() => onDragStart(b.id)}
                      onDragEnd={onDragEnd}
                    />
                  ))}
              </div>
            ))}
            {/* An empty trailing row still needs height to be a target. */}
            {!inRow.length && <div style={{ height: "calc(6 * var(--mm))" }} />}
          </div>
        );
      })}
    </div>
  );
}


/* ────────────────────────────────────────────────────────────────────────────
 * The inspector — one selected block's properties.
 *
 * Everything here is also the keyboard path to what the canvas does by drag.
 * That is not a consolation prize: dragging is the fast way to arrange a page
 * and a terrible way to say "span seven columns", and a drag-only editor is one
 * nobody can operate without a mouse.
 * ──────────────────────────────────────────────────────────────────────────── */
function Inspector({
  block,
  lang,
  line,
  tokens,
  busy,
  logoHeightMm,
  onPlace,
  onLine,
  onRemoveLine,
  onJump,
  onLogoHeight,
}: {
  block: api.LetterheadBlock;
  lang: Lang;
  line: api.LetterheadLine | null;
  tokens: { token: string; label: string }[];
  busy: boolean;
  logoHeightMm: number | null;
  onPlace: (patch: Partial<api.LetterheadPlacement>) => void;
  onLine: (patch: Record<string, unknown>) => void;
  onRemoveLine: () => void;
  onJump: () => void;
  onLogoHeight: (mm: number | null) => void;
}) {
  const label = block.label[lang] || block.label.en || block.id;
  const hint = block.hint[lang] || block.hint.en;
  const textKey = lang === "fr" ? "text_fr" : "text_en";
  const [draft, setDraft] = React.useState("");
  const textRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setDraft((line && (line[textKey] as string)) || "");
  }, [line, textKey]);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="micro text-muted-foreground">{hint}</p>}
      </div>

      {block.empty && (
        <Callout tone="warn" title={tr("Switched on, but empty")}>
          <p className="text-muted-foreground">
            {tr("This block would print nothing. Fill it in on the entity's own tab, or hide it.")}
          </p>
        </Callout>
      )}

      {/* The deep link. A block knows which tab and field feed it, so "the NIU
          is wrong" is one click rather than eleven tabs to guess from. */}
      {!block.custom && (
        <Button size="sm" variant="outline" onClick={onJump}>
          {block.source.tab === "Letterhead"
            ? tr("Go to this setting")
            : `${tr("Edit in")} ${block.source.tab}`}{" "}
          →
        </Button>
      )}

      {/*
       * The mark's height lives HERE and not in a panel below, because it is
       * the one letterhead property you judge by looking at the page. It is
       * also the number that reaches the one-page fit model as FIXED height —
       * a mark that does not shrink with the rest of the sheet — so a change
       * here can be the difference between one page and two on an instrument
       * document.
       */}
      {block.kind === "image" && (
        // Wrapped rather than adding a `field` prop to the shared `Field`
        // primitive: the anchor is this one screen's deep-link target, not a
        // new capability every form in the product needs.
        <div data-field="logo">
          <Field
            label={tr("Mark height (mm)")}
            hint={tr("4-60. It does not shrink with the page. The image itself is set on the entity's own form.")}
          >
            <Input
              type="number"
              min={4}
              max={60}
              step={0.5}
              value={logoHeightMm ?? ""}
              disabled={busy}
              onChange={(e) => onLogoHeight(e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      {block.custom && (
        <>
          <Field
            label={lang === "fr" ? tr("Text (French)") : tr("Text (English)")}
            hint={tr("Type {{ to insert a fact from the entity's record.")}
          >
            <Input
              ref={textRef}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft !== ((line && (line[textKey] as string)) || "")) {
                  onLine({ [textKey]: draft.trim() || null });
                }
              }}
            />
          </Field>
          <div>
            <p className="micro mb-1 text-muted-foreground">{tr("Insert a fact")}</p>
            <div className="flex flex-wrap gap-1">
              {tokens.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  disabled={busy}
                  title={t.token}
                  onClick={() => {
                    /*
                     * Inserted at the caret, not appended. A token picker that
                     * always appends makes "Agréé n° {{entity.rccm}} — Douala"
                     * impossible to type without hand-editing afterwards.
                     */
                    const el = textRef.current;
                    const at = el && el.selectionStart !== null ? el.selectionStart : draft.length;
                    setDraft(draft.slice(0, at) + t.token + draft.slice(at));
                    window.requestAnimationFrame(() => el?.focus());
                  }}
                  className="rounded border border-border px-1.5 py-0.5 micro text-muted-foreground hover:bg-muted"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label={tr("Align")}>
          <Select
            value={block.align}
            disabled={busy}
            onChange={(e) => onPlace({ align: e.target.value as api.LetterheadPlacement["align"] })}
          >
            <option value="left">{tr("Left")}</option>
            <option value="center">{tr("Centre")}</option>
            <option value="right">{tr("Right")}</option>
          </Select>
        </Field>
        <Field label={tr("Width (columns)")} hint={tr("Of twelve.")}>
          <Input
            type="number"
            min={1}
            max={COLS}
            value={block.span}
            disabled={busy}
            onChange={(e) => onPlace({ span: Number(e.target.value) })}
          />
        </Field>
        <Field label={tr("Column")} hint={tr("0 is the left edge.")}>
          <Input
            type="number"
            min={0}
            max={COLS - 1}
            value={block.col}
            disabled={busy}
            onChange={(e) => onPlace({ col: Number(e.target.value) })}
          />
        </Field>
        <Field label={tr("Row")}>
          <Input
            type="number"
            min={0}
            max={40}
            value={block.row}
            disabled={busy}
            onChange={(e) => onPlace({ row: Number(e.target.value) })}
          />
        </Field>
      </div>

      {block.kind !== "rule" && block.kind !== "image" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={tr("Size")} hint={tr("1 is the default.")}>
            <Input
              type="number"
              min={0.5}
              max={2.5}
              step={0.05}
              value={block.size}
              disabled={busy}
              onChange={(e) => onPlace({ size: Number(e.target.value) })}
            />
          </Field>
          <Field label={tr("Emphasis")}>
            <Select
              value={block.weight}
              disabled={busy}
              onChange={(e) => onPlace({ weight: e.target.value as "normal" | "bold" })}
            >
              <option value="normal">{tr("Regular")}</option>
              <option value="bold">{tr("Bold")}</option>
            </Select>
          </Field>
          <Field label={tr("Tone")}>
            <Select
              value={block.tone}
              disabled={busy}
              onChange={(e) => onPlace({ tone: e.target.value as "ink" | "muted" | "accent" })}
            >
              <option value="ink">{tr("Full strength")}</option>
              <option value="muted">{tr("Quiet")}</option>
              <option value="accent">{tr("Brand colour")}</option>
            </Select>
          </Field>
          <Field label={tr("Letter case")}>
            <Select
              value={block.transform}
              disabled={busy}
              onChange={(e) => onPlace({ transform: e.target.value as "none" | "upper" })}
            >
              <option value="none">{tr("As written")}</option>
              <option value="upper">{tr("UPPERCASE")}</option>
            </Select>
          </Field>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Checkbox
          checked={block.visible}
          disabled={busy}
          onCheckedChange={(v) => onPlace({ visible: v === true })}
          label={tr("Show on documents")}
        />
        {block.custom && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={onRemoveLine}>
            {tr("Remove line")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The studio.
 * ──────────────────────────────────────────────────────────────────────────── */
export function LetterheadStudio({
  entityId,
  bundle,
  lang,
  onLang,
  onReload,
  onSaved,
}: {
  entityId: string;
  bundle: api.LetterheadBundle;
  lang: Lang;
  onLang: (l: Lang) => void;
  onReload: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cfg = bundle.config;
  const comp = bundle.blocks[lang];
  const all = React.useMemo(() => [...comp.header, ...comp.footer], [comp]);
  const block = all.find((b) => b.id === selected) || null;
  const line =
    block && block.custom
      ? bundle.custom_lines.find((l) => `custom:${l.line_id}` === block.id) || null
      : null;

  const paper = PAPER[cfg.paper_size === "LETTER" ? "LETTER" : "A4"];
  const accent = cfg.brand_color || "#F5821F";

  /**
   * Persist a layout change.
   *
   * The saved layout is written as the FULL current arrangement, not as a patch
   * of the one block that moved. `mergeLayout` on the server merges whatever
   * arrives over the defaults, so a partial write would be lossless only by
   * accident — and a block whose row changed relative to another block is not
   * describable as a single-block patch anyway.
   */
  async function place(id: string, patch: Partial<api.LetterheadPlacement>) {
    setBusy(true);
    setError(null);
    try {
      const layout: api.LetterheadLayout = { version: 1, header: [], footer: [] };
      for (const zone of ["header", "footer"] as Zone[]) {
        layout[zone] = comp[zone].map((b) => ({
          id: b.id,
          row: b.row,
          col: b.col,
          span: b.span,
          align: b.align,
          size: b.size,
          weight: b.weight,
          tone: b.tone,
          transform: b.transform,
          visible: b.visible,
          ...(b.id === id ? patch : {}),
        }));
      }
      /*
       * ONE CONTROL, ONE TRUTH.
       *
       * Visibility has two stores: `entity_letterhead.show_*`, which tenants
       * have already set and which several blocks share, and the layout's own
       * `visible`. Writing only the layout would leave a block switched off by
       * a column that the canvas shows as on — so the toggle columns are
       * written alongside, in the same request, and the editor never shows a
       * second contradictory switch.
       */
      const body: Record<string, unknown> = { layout };
      const target = comp.header.concat(comp.footer).find((b) => b.id === id);
      if (patch.visible !== undefined && target && target.toggle) {
        for (const col of target.toggle) {
          if ((TOGGLE_COLUMNS as readonly string[]).includes(col)) {
            body[col] = patch.visible;
          }
        }
      }
      await api.saveEntityLetterhead(entityId, body);
      onReload();
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Add, edit or remove a line.
   *
   * Toasted, where a drag is not: adding and removing a line are discrete acts
   * with a consequence the canvas does not fully show — the line starts or
   * stops printing on every document the entity issues. A toast per drag would
   * be noise; a toast per line is the confirmation the act deserves.
   */
  /** A plain letterhead-column write (the mark's height, today). */
  async function saveConfig(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api.saveEntityLetterhead(entityId, patch);
      onReload();
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveLine(lineId: string | null, body: Record<string, unknown> | null) {
    setBusy(true);
    setError(null);
    try {
      await api.saveEntityLetterheadLine(entityId, lineId, body);
      onReload();
      onSaved();
      if (body === null) toast.success(tr("Line removed from the letterhead."));
      else if (!lineId) toast.success(tr("Line added. It prints on every document."));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The deep link out to whatever feeds this block.
   *
   * TWO CASES, because a link to where you already are is not a link.
   *
   * A block fed from ANOTHER tab (the NIU, an address, a treasury account)
   * navigates: `?tab=&field=` is what `use-url-tab` reads on mount, and
   * `assign` rather than a router push because this is the same route with
   * different params — a push updates the URL without the tab's own effect
   * seeing the new field.
   *
   * A block fed from THIS tab (the wording, the brand colour) is a few hundred
   * pixels below the canvas, so it scrolls and rings in place. Reloading the
   * page to land on the panel underneath would throw away the selection and the
   * scroll position to move the reader down one screen.
   */
  function jump(b: api.LetterheadBlock) {
    if (b.source.tab === "Letterhead") {
      const el = document.querySelector<HTMLElement>(
        `[data-field="${CSS.escape(b.source.field)}"]`,
      );
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        const focusable = el.matches("input, select, textarea, button")
          ? el
          : el.querySelector<HTMLElement>("input, select, textarea, button");
        focusable?.focus({ preventScroll: true });
        el.classList.add("praxis-field-highlight");
        window.setTimeout(() => el.classList.remove("praxis-field-highlight"), 2400);
        return;
      }
    }
    const q = new URLSearchParams({ tab: b.source.tab, field: b.source.field });
    window.location.assign(`/master/entities/${entityId}?${q}`);
  }

  /** Blocks not currently on the page, offered for adding back. */
  const hidden = all.filter((b) => !b.visible);

  const zoneCard = (zone: Zone, blocks: api.LetterheadBlock[]) => (
    <CanvasZone
      zone={zone}
      blocks={blocks}
      lang={lang}
      accent={accent}
      dragging={dragging}
      selectedId={selected}
      onSelect={setSelected}
      onDragStart={(id) => {
        setDragging(id);
        setSelected(id);
      }}
      onDragEnd={() => setDragging(null)}
      onDrop={(row, col) => {
        const id = dragging;
        setDragging(null);
        if (id) place(id, { row, col });
      }}
    />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {confirmDialog}

      {/* ── The page ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label={tr("Document language")}
            value={lang}
            onChange={(l) => onLang(l as Lang)}
            options={[
              { value: "fr", label: tr("Français") },
              { value: "en", label: tr("English") },
            ]}
          />
          {/* The millimetres are on screen because on an instrument sheet they
              are the difference between one page and two. */}
          <p className="micro text-muted-foreground">
            {tr("Header")} {comp.height.header_mm}
            {tr("mm")} · {tr("Footer")} {comp.height.footer_mm}
            {tr("mm")} · {cfg.paper_size}
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border bg-background">
          {/*
           * The sheet, at true paper proportions. `--mm` is one millimetre in
           * container-query units, so every measurement below — type sizes
           * included — is the millimetre the server measured, scaled once.
           */}
          <div
            className="mx-auto p-[calc(16*var(--mm))]"
            style={
              {
                background: PRINT.paper,
                color: PRINT.ink,
                "--mm": `${100 / paper.w}cqw`,
                containerType: "inline-size",
                aspectRatio: `${paper.w} / ${paper.h}`,
                display: "flex",
                flexDirection: "column",
              } as React.CSSProperties
            }
          >
            {zoneCard("header", comp.header)}
            <div
              className="my-[calc(4*var(--mm))] flex flex-1 items-center justify-center rounded border border-dashed"
              style={{ borderColor: PRINT.rule }}
            >
              <span className="micro" style={{ color: PRINT.muted }}>
                {tr("Document body")}
              </span>
            </div>
            <div
              className="border-t pt-[calc(1.4*var(--mm))]"
              style={{ borderTopColor: cfg.accent_color || PRINT.rule }}
            >
              {zoneCard("footer", comp.footer)}
            </div>
          </div>
        </div>

        <p className="micro text-muted-foreground">
          {tr(
            "Drag a block to move it. Click one to edit it. The content comes from the entity's own record — this arranges it.",
          )}
        </p>
      </div>

      {/* ── The rail ───────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {error && (
          <Callout tone="bad" title={tr("That change was not saved")}>
            <p className="text-muted-foreground">{error}</p>
          </Callout>
        )}

        <div className="lux-card space-y-3 p-4">
          {block ? (
            <Inspector
              block={block}
              lang={lang}
              line={line}
              tokens={bundle.tokens}
              busy={busy}
              logoHeightMm={cfg.logo_height_mm ?? null}
              onPlace={(patch) => place(block.id, patch)}
              onLine={(patch) => line && saveLine(line.line_id, patch)}
              onRemoveLine={async () => {
                if (!line) return;
                if (
                  !(await confirm({
                    title: tr("Remove this letterhead line?"),
                    body: tr("It stops printing on every document this entity issues."),
                    confirmLabel: tr("Remove line"),
                    destructive: true,
                  }))
                ) {
                  return;
                }
                setSelected(null);
                saveLine(line.line_id, null);
              }}
              onJump={() => jump(block)}
              onLogoHeight={(mm) => saveConfig({ logo_height_mm: mm })}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {tr("Select a block on the page to edit it.")}
            </p>
          )}
        </div>

        {/* ── Add ─────────────────────────────────────────────────────── */}
        <div className="lux-card space-y-2 p-4">
          <p className="text-sm font-medium text-foreground">{tr("Add to the letterhead")}</p>
          {hidden.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {hidden.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(b.id);
                    place(b.id, { visible: true });
                  }}
                  className="rounded border border-border px-1.5 py-0.5 micro text-muted-foreground hover:bg-muted"
                >
                  + {b.label[lang] || b.label.en || b.id}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {(["header", "footer"] as Zone[]).map((zone) => (
              <Button
                key={zone}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  saveLine(null, {
                    zone,
                    [lang === "fr" ? "text_fr" : "text_en"]:
                      lang === "fr" ? "Nouvelle ligne" : "New line",
                  })
                }
              >
                {zone === "header" ? tr("Own line in header") : tr("Own line in footer")}
              </Button>
            ))}
          </div>
          <p className="micro text-muted-foreground">
            {tr(
              "Your own line — a strapline, a licence number. It can quote a fact from the record, so it never goes stale.",
            )}
          </p>
        </div>

        {comp.empty_blocks.length > 0 && (
          <Callout tone="warn" title={tr("Switched on, but empty")}>
            <p className="text-muted-foreground">
              {tr("These blocks are on the page and would print nothing.")}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {comp.empty_blocks.map((id) => {
                const b = all.find((x) => x.id === id);
                return (
                  <li key={id}>
                    <button type="button" onClick={() => setSelected(id)}>
                      <Pill tone="warn">{(b && (b.label[lang] || b.label.en)) || id}</Pill>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Callout>
        )}
      </div>
    </div>
  );
}
