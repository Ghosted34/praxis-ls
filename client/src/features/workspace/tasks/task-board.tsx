/**
 * The task board — one column per status, cards you can drag between them.
 *
 * ── DRAG IS A SHORTCUT, NOT THE MECHANISM ──────────────────────────────────
 *
 * Every card also carries a status picker, so moving a task is available to a
 * keyboard, to a screen reader and to a touch screen where dragging a small
 * target is fiddly. A board whose only affordance is the pointer fails
 * FRONTEND_GUIDE §7.3 ("keyboard and pointer parity") however well it feels
 * with a mouse. The picker is therefore not a fallback that happens to be
 * there; it is the control, and dragging is the faster way to reach it.
 *
 * ── THREE INPUTS, THREE GESTURES, ONE DRAG ─────────────────────────────────
 *
 * A MOUSE picks a card up by pressing ANYWHERE on it and moving 8px
 * (`MousePointerSensor` — see the section below), and puts it down the moment
 * the button is RELEASED: the drag's whole life sits inside one pointer
 * gesture, from `pointerdown` to `pointerup`, with `pointercancel` as the
 * safety net that abandons it. A FINGER picks a card up by HOLDING IT ANYWHERE
 * (`TouchSensor`, `LONG_PRESS_MS`): the long press is the one gesture a phone
 * has left that the board's own scrolling has not already claimed, and it is
 * what makes "click and hold, then drag it into another stage" true on glass.
 * A KEYBOARD picks the grip up with Space and drops it with Space
 * (`KeyboardSensor`).
 *
 * WHY A POINTER SENSOR FOR THE MOUSE, AND WHY IT REFUSES TOUCH: the mouse's
 * old `MouseSensor` listened for `mouseup` alone, so any ending it did not hear
 * left the drag with no way home: the copy kept following the pointer and
 * only Escape ended it. The pointer sensor ends on `pointerup` AND
 * `pointercancel` — the release, and the browser taking the gesture back — so
 * every ending the platform reports closes the drag, and no ending strands
 * the copy on the pointer. And a finger fires `pointerdown` too — but on a
 * phone that gesture is a scroll until the hold says otherwise, so the
 * sensor's activator turns touch away and lets the `TouchSensor` own it. The
 * hold is still what separates a touch drag from a touch scroll;
 * touch never meets this sensor at all.
 *
 * ── WHY `activationConstraint.distance` IS SET ─────────────────────────────
 *
 * Without it, a mousedown IS a drag start, so the controls inside the card can
 * never be clicked and every card is "dragging" the moment the pointer goes
 * down. Eight pixels is below the threshold anyone notices and above the
 * jitter of a mouse button held down.
 *
 * ── WHY THE HOLD, AND WHY NOTHING ON THE CARD IS `touch-action: none` ──────
 *
 * A card cannot claim the gesture at touchstart: the board scrolls, and on a
 * phone it scrolls with the same thumb that would be dragging. `touch-action:
 * none` on the card — the usual way to make a drag "reliable" — takes that
 * scroll away from every reader whose thumb lands on a card, which is the whole
 * column. So the card WAITS instead: hold for `LONG_PRESS_MS` without drifting
 * past `tolerance` and the drag starts and owns the gesture from there; move
 * first and the gesture was a scroll, the pending drag is abandoned and the
 * board scrolls as it always would have. The delay is also why a TAP is never a
 * drag — a tap does not reach it — so a tap stays the click that opens the
 * card, on every input there is.
 *
 * No "held" state is drawn while the finger is still deciding: feedback on
 * touch is the card lifting under the thumb (the `DragOverlay`), and a ring
 * that lit up at touchstart would flash on every card a scrolling thumb lands
 * on, advertising a drag that is about to be abandoned.
 *
 * `select-none` is gated to `(pointer: coarse)`: on a phone a hold must not
 * begin selecting the title's text (iOS cancels the gesture once it does), and
 * on a desktop a reader keeps the ability to select what a card says.
 *
 * ── THE WHOLE CARD OPENS IT, AND THE DRAG HANDLE IS A SEPARATE BOX ─────────
 *
 * A card's job is to be read and then opened, so the target is the card and not
 * the 20px line of its title: the title, the pills, the date and the assignee
 * are all inside ONE `<button>`, which is what makes "click anywhere on the
 * card" true rather than approximately true.
 *
 * The grip is the title strip, laid OVER that button as a sibling — not as its
 * ancestor, and not as a `::after` on the title. A sibling keeps the pointerup
 * that ends a MOUSE drag off the button: the event lands on the grip, whose
 * only listener is dnd-kit's, so the click a mouse drag would otherwise leave
 * behind opens nothing. That is a structural fix rather than a timing one, and
 * it is why the grip survived the arrival of the long press rather than being
 * folded into it: it is still the keyboard's handle, and the mouse's hint.
 *
 * The grip's dots are HOVER-ONLY. They used to sit permanently over the title,
 * hiding the first thing a reader looks at; now the strip is transparent until
 * the card is hovered or focused, and the dots fade in. The strip itself still
 * answers a plain click by opening the card, so the overlay it forms over the
 * title costs nothing.
 *
 * The card's touch surface is the wrapper around the button AND the grip, so a
 * hold anywhere on the card picks it up; the Move menu is deliberately OUTSIDE
 * that wrapper, because holding its button is a request for the menu.
 *
 * ── WHERE A DROP LANDS: THE POINTER FIRST, THE CARD SECOND ─────────────────
 *
 * `boardCollision` reads the pointer first (`pointerWithin`): dropping "into"
 * a stage means the pointer is inside that column, which is the intent no
 * rectangle arithmetic should overrule. When the pointer is in no column — the
 * gutter between two of them, most often — it falls back to `rectIntersection`,
 * the card's own overlap. The fallback is also the whole of the keyboard path:
 * a keyboard drag has no pointer coordinates at all, so `pointerWithin` always
 * abstains and the rect decides, exactly as it did before.
 *
 * ── THE OVERLAY IS A PICTURE, NOT A SECOND DRAGGABLE ───────────────────────
 *
 * The copy that follows the pointer (`DragOverlay`) must never call
 * `useDraggable`, even disabled. The hook registers its id in dnd-kit's map on
 * mount — disabled only withholds the listeners — so a `useDraggable` in the
 * overlay OVERWRITES the live card's entry with one whose node is null, and on
 * unmount it deletes the id outright. The live card never re-registers (its
 * effect deps are unchanged), so after the first drop the card answers no
 * sensor: mousedown finds no draggable and the drag never starts. "Drag works
 * once, then never again" is exactly what that looks like from the outside.
 * `TaskCardOverlay` is therefore plain JSX sharing only the card's face.
 *
 * ── THE OPEN CARD IS MARKED, AND THE PANE IS ITS OTHER HALF ────────────────
 *
 * The card in the pane wears `<IndexRow>`'s pair — the `.index-row-open` ground
 * and the 3px `--primary` rail — and `aria-current`, so "which task is the pane
 * showing" is answered on the board as well as in the pane. Guide §3.14 is
 * explicit that a master-detail screen has to say what is open, and that the
 * meaning of "this is the open one" is shared even when the geometry is local:
 * a card is not an `<IndexRow>` (it carries a Move menu), so it borrows
 * `INDEX_ROW_OPEN` and positions the rail itself, exactly as the inbox thread
 * row does.
 *
 * `bg-card` is deliberately NOT applied to a selected card. It is a Tailwind
 * utility and `.index-row-open` lives in `@layer components`, so the utility
 * would win and the open card would look like every other card — the F13 defect
 * the ground exists to fix.
 *
 * ── WHY THE BOARD IS NOT THE PAGINATED LIST ────────────────────────────────
 *
 * Lists here are capped at 50 rows server-side (API F-26). A kanban over that
 * cap shows four columns of the wrong rows and gives no indication anything is
 * missing, which is exactly the bug the cap's `X-Total-Count` header was added
 * to end. The board endpoint returns up to 200 open tasks in one response and
 * is the honest shape for this view.
 */
import * as React from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  TouchSensor,
  PointerSensor as DndPointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type PointerSensorOptions,
} from "@dnd-kit/core";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/pill";
import { tr } from "@/lib/i18n";
import { stageSummary } from "../file-link";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { INDEX_ROW_OPEN } from "@/components/ui/index-row";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { BOARD_COLUMNS } from "../api";
import type { Audience, BoardColumn, BoardCompleteness, Task, TaskBoard, TaskStatus } from "../api";
import { useMoveTask } from "../hooks";
import { COLUMN_LABEL, PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL } from "../labels";
import { describeRule } from "../repeat";

/**
 * How long a finger must REST on a card before the card starts moving.
 *
 * It is a dwell, not a click: long enough that a thumb passing over a card on
 * its way down the board is scrolling (and short enough that a deliberate hold
 * does not feel like a delay). Exported because the gesture is a contract —
 * `task-board.test.tsx` holds a card for exactly this long and expects the move
 * to be the one the network sees.
 */
export const LONG_PRESS_MS = 250;

/**
 * How far a finger may DRIFT during the hold before the gesture is a scroll.
 *
 * Measured from where the finger landed rather than from the card's edges, so
 * it is the reader's own unsteadiness that abandons the drag, and eight pixels
 * is about a thumb's resting tremor — above it, the reader meant to move.
 */
const LONG_PRESS_TOLERANCE = 8;

/**
 * Where a dropped card lands — see the header. The pointer's column when the
 * pointer is inside one, otherwise whichever column the card itself overlaps
 * most. A module constant rather than an inline prop so the `DndContext` keeps
 * a stable reference across renders.
 */
const boardCollision: CollisionDetection = (args) => {
  const pointed = pointerWithin(args);
  if (pointed.length > 0) return pointed;
  return rectIntersection(args);
};

/**
 * The mouse's half of the drag: dnd-kit's `PointerSensor` with a bouncer.
 *
 * The base sensor is kept for its ENDINGS — `pointerup` drops the card and
 * `pointercancel` abandons the drag, so every ending the platform reports
 * closes the gesture and the copy can never keep following the pointer past
 * its release. What changes is the BEGINNING: the stock `PointerSensor`
 * activates on any `pointerdown`, and a finger fires one on its way into a
 * scroll. The activator below turns away every touch pointer, so a touch
 * gesture never even reaches the pending
 * state here and the `TouchSensor` next to it owns the hold, the scroll and
 * the tap exactly as it always has. Anything that is NOT touch — mouse, pen,
 * or a device that declines to say — is this sensor's.
 */
class MousePointerSensor extends DndPointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: (
        { nativeEvent: event }: React.PointerEvent,
        { onActivation }: PointerSensorOptions,
      ) => {
        if (!event.isPrimary || event.button !== 0) return false;
        if (event.pointerType === "touch") return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

export function TaskBoard({
  board,
  loading,
  selectedId,
  onOpen,
  onCreate,
  /** The reach the board was rendered at. Travels with every move so the
   *  server authorises the transition the same way it authorised the card. */
  audience,
  /** How much of the board this is, so truncation can be said rather than hidden. */
  completeness,
  /** Switch to the paged List view — the honest shape past the board's cap. */
  onShowList,
  /** The Tasks page's search, when one narrowed this board — so an empty
   *  board can say "nothing matches" rather than "nothing on the board". */
  query,
  onClearQuery,
}: {
  board: TaskBoard | undefined;
  loading: boolean;
  /** The task the detail pane is showing, so the board can say which one it is. */
  selectedId: string | null;
  onOpen: (taskId: string) => void;
  onCreate: () => void;
  audience?: Audience;
  completeness?: BoardCompleteness;
  onShowList?: () => void;
  query?: string;
  onClearQuery?: () => void;
}) {
  const move = useMoveTask();
  const toast = useToast();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    // The mouse, anywhere on the card: 8px of travel is a drag, a click is a
    // click, and the release always ends it — see `MousePointerSensor`.
    useSensor(MousePointerSensor, { activationConstraint: { distance: 8 } }),
    // The finger, anywhere on the card: hold to pick it up, move first to
    // scroll instead. See the header — the delay IS the scroll's grace period.
    useSensor(TouchSensor, {
      activationConstraint: { delay: LONG_PRESS_MS, tolerance: LONG_PRESS_TOLERANCE },
    }),
    // Space to pick up, arrows to choose a column, space to drop. This is what
    // makes the board reachable without a pointer at all.
    useSensor(KeyboardSensor),
  );

  const active = activeId ? findTask(board, activeId) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const over = e.over?.id ? String(e.over.id) : null;
    const task = findTask(board, String(e.active.id));
    if (!task || !over || over === task.status) return;
    try {
      await move.mutateAsync({ id: task.task_id, status: over as TaskStatus, audience });
    } catch (err) {
      // The move is optimistic — the card already jumped columns, and the
      // mutation rolled it back. What is left is telling the user why.
      toast.error(errMsg(err));
    }
  }

  if (loading && !board) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_COLUMNS.map((c) => (
          <div key={c} className="rounded-lg border p-3">
            <div className="micro mb-3">{COLUMN_LABEL[c]}</div>
            <LoadingRow label="Loading tasks…" />
            <LoadingRow />
          </div>
        ))}
      </div>
    );
  }

  const total = BOARD_COLUMNS.reduce((n, c) => n + (board?.[c]?.length ?? 0), 0);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_COLUMNS.map((column) => (
          <Column
            key={column}
            column={column}
            tasks={board?.[column] ?? []}
            selectedId={selectedId}
            onOpen={onOpen}
            onMove={async (id, status) => {
              try {
                await move.mutateAsync({ id, status, audience });
              } catch (err) {
                toast.error(errMsg(err));
              }
            }}
            onCreate={onCreate}
          />
        ))}
      </div>

      {/*
        THE BOARD SAYS HOW MUCH OF ITSELF IT IS.

        The endpoint has always been capped, and 200 cards look exactly like
        all of them — a manager scrolls four full columns and concludes they
        have seen their team's work. The count comes from the same query as the
        rows, and the List view beside it is the shape that is actually
        complete for the declared filters.
      */}
      {completeness?.truncated && (
        <Callout tone="warn" className="mt-4">
          <span className="num">{completeness.shown}</span> of{" "}
          <span className="num">{completeness.total}</span> open tasks fit on the
          board.{" "}
          {onShowList ? (
            <button type="button" className="underline" onClick={onShowList}>
              Open the List view
            </button>
          ) : (
            "Use the List view"
          )}{" "}
          to page through all of them.
        </Callout>
      )}

      {/* The moving copy. The source card stays where it is and dims, so the
          user never loses track of where the task came from. */}
      <DragOverlay>
        {active ? <TaskCard task={active} overlay /> : null}
      </DragOverlay>

      {total === 0 && (
        <div className="mt-6">
          {query?.trim() ? (
            <EmptyState
              title={tr("No tasks match “{q}”").replace("{q}", query.trim())}
              hint={tr("Try another word — the search covers titles, notes, the linked file's reference, its client and step titles.")}
              action={
                onClearQuery ? (
                  <button type="button" className="btn-primary" onClick={onClearQuery}>
                    {tr("Show all tasks")}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              title="Nothing on the board"
              hint="Tasks you write, or that are assigned to you, land here in the column that matches how far along they are."
              action={
                <button type="button" className="btn-primary" onClick={onCreate}>
                  Add the first task
                </button>
              }
            />
          )}
        </div>
      )}
    </DndContext>
  );
}

function Column({
  column,
  tasks,
  selectedId,
  onOpen,
  onMove,
  onCreate,
}: {
  column: BoardColumn;
  tasks: Task[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onMove: (id: string, status: TaskStatus) => Promise<void>;
  onCreate: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${COLUMN_LABEL[column]} — ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
      className={cn(
        "flex min-h-[12rem] flex-col rounded-lg border bg-card/40 p-3 transition-colors",
        isOver && "border-primary bg-accent ring-1 ring-primary",
      )}
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        {/* `h2`, not `h3`: the board sits directly under the page's `<h1>`
            (`PageHeader`), so a column heading one level down skipped a level
            and axe fails the screen on `heading-order`. The four columns and
            the open task's `<Panel>` are siblings in the outline — all of them
            are what the page is made of. */}
        <h2 className="text-sm font-medium">{COLUMN_LABEL[column]}</h2>
        <span className="micro num" aria-hidden>
          {tasks.length}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.task_id}
            task={task}
            selected={task.task_id === selectedId}
            dimmed={task.status !== column}
            onOpen={() => onOpen(task.task_id)}
            onMove={onMove}
          />
        ))}

        {tasks.length === 0 && (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-md border border-dashed px-3 py-4 text-center micro transition-colors hover:border-primary hover:text-primary-ink"
          >
            Drop here, or add a task
          </button>
        )}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  selected = false,
  onOpen,
  onMove,
  overlay = false,
  dimmed = false,
}: {
  task: Task;
  /** Is the detail pane showing THIS task? */
  selected?: boolean;
  onOpen?: () => void;
  onMove?: (id: string, status: TaskStatus) => Promise<void>;
  /** The copy that follows the pointer. A picture, never a draggable. */
  overlay?: boolean;
  dimmed?: boolean;
}) {
  // Two components rather than one with branches, because the difference is a
  // HOOK: the live card calls `useDraggable` and the overlay must not (see the
  // header — a `useDraggable` in the overlay unregisters the live card). A
  // conditional hook call is not an option, so the branch is here, before any.
  if (overlay) return <TaskCardOverlay task={task} />;
  return <TaskCardLive task={task} selected={selected} onOpen={onOpen} onMove={onMove} dimmed={dimmed} />;
}

/**
 * The card on the board: opens on click, drags on press-and-move, moves on
 * menu. The only `useDraggable` on this task's id — the overlay shares the
 * face below and nothing else.
 */
function TaskCardLive({
  task,
  selected = false,
  onOpen,
  onMove,
  dimmed = false,
}: {
  task: Task;
  selected?: boolean;
  onOpen?: () => void;
  onMove?: (id: string, status: TaskStatus) => Promise<void>;
  dimmed?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.task_id,
    disabled: !onMove,
  });

  // ONE draggable, three surfaces, split by input. The MOUSE half lives on the
  // whole card — the 13840-era board kept it on an invisible 20px strip and
  // a mouse that held anywhere did nothing, which is the "desktop is a mess"
  // report. Touch keeps its hold-anywhere gesture and the keyboard keeps the
  // grip as its focusable handle. The pointer listener is the mouse's only:
  // `MousePointerSensor` turns touch away at the activator, so a finger's
  // `pointerdown` never reaches a pending drag and can never hijack a touch
  // scroll. `undefined` when the card is not draggable, so a read-only board
  // answers nothing.
  const pointerDown = listeners?.onPointerDown as React.PointerEventHandler<HTMLDivElement> | undefined;
  const touchStart = listeners?.onTouchStart as React.TouchEventHandler<HTMLDivElement> | undefined;
  const gripKeyDown = listeners?.onKeyDown as React.KeyboardEventHandler<HTMLDivElement> | undefined;

  return (
    <article
      ref={setNodeRef}
      className={cn(
        "group relative rounded-md border shadow-sm transition-opacity",
        selected
          ? cn(
              INDEX_ROW_OPEN,
              // The rail, positioned here rather than borrowed from
              // `<IndexRow>`: a flush list row and a bordered card want
              // different insets, while the MEANING of the open one is shared.
              "before:absolute before:inset-y-2 before:left-1 before:w-[3px] before:rounded-full before:content-['']",
            )
          : "bg-card",
        isDragging && "opacity-40",
        dimmed && "opacity-60",
      )}
    >
      {/*
        THE WRAPPER IS THE CARD'S POINTER SURFACE: `onPointerDown` AND
        `onTouchStart`, AND NOTHING ELSE. No `touch-action`, no
        `preventDefault`, nothing that would take the board's scrolling away
        from the thumb that is scrolling it — the pointer half turns touch away
        at the sensor (see `MousePointerSensor`), so a finger's `pointerdown`
        passes straight through to the hold below it. Two things live inside —
        the card's button and the grip — because a hold on either is a hold on
        the card. The Move menu is below, deliberately outside: pressing and
        holding ITS button is a request for the menu, not a request to move the
        card.

        `-webkit-touch-callout` off, and selection off for coarse pointers only:
        on a phone a hold must not begin selecting the title's text, because iOS
        cancels the gesture the moment it does; on a desktop a reader keeps the
        ability to select what a card says.
      */}
      {/* The pointer half of the drag. Not itself a focusable control: the
          keyboard gets the same move through the grip's `role="button"` below
          and through the card's own button + Move menu, so pointer and keyboard
          stay at parity (FRONTEND_GUIDE §7.3). */}
      <div
        onPointerDown={pointerDown}
        onTouchStart={touchStart}
        className={cn(
          "relative [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none",
          // While a mouse drag is live, the gesture belongs to dnd-kit: stop
          // the title text selecting under the pointer. Gated to the live
          // drag so the resting card keeps selecting as it always did — and
          // deliberately NOT `touch-none`: touch owns its own gesture through
          // the hold, and nothing here takes the board's scrolling away.
          isDragging && "select-none",
        )}
      >
        {/*
          ONE BUTTON IS THE WHOLE CARD. Everything a reader might click — the
          title, the priority pill, the date, the owner's name — is inside it,
          so the hit area IS the card rather than the title line. `<span>`s
          rather than `<div>`s because a button may only contain phrasing
          content, and the pills are spans for the same reason.
        */}
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          // The board's half of the master-detail bond, and the half a screen
          // reader can hear: the ground and rail say it to the eye.
          aria-current={selected ? "true" : undefined}
          title={task.title}
          className={cn(
            "block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // The Move menu sits below the button in the flow; the button gives
            // back the bottom padding the row would otherwise double.
            onMove ? "px-3 pt-3 pb-2" : "p-3",
            onOpen && "cursor-pointer",
          )}
        >
          <TaskCardFace task={task} hoverTitle={!!onOpen} />        </button>

        {/*
          The grip, over the title strip: the KEYBOARD handle, the mouse's
          hint, and the element that carries dnd-kit's `attributes` — the role,
          the name of the drag, the instructions a screen reader reads, the
          `tabIndex` Space works from. A sibling of the button and never an
          ancestor of it: the pointerup that ends a mouse drag lands on the grip, whose
          only listener is dnd-kit's, so the click a mouse drag would otherwise
          leave behind opens nothing.

          It is no longer `touch-none`. A touch drag is started by the HOLD, on
          the wrapper, and a title strip that refused to scroll would be a dead
          band across every card on the board.
        */}
        {onOpen && onMove && (
          <>
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions --
                role="button" arrives via {...attributes} (dnd-kit), which the rule
                cannot see statically; the grip is the keyboard's drag handle and
                a plain click opens the card, so it is reachable and operable. */}
            <div
              onKeyDown={gripKeyDown}
              {...attributes}
              onClick={onOpen}
              aria-label={`Drag “${task.title}”`}
              className="absolute left-3 right-3 top-3 flex h-5 cursor-grab items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            >
              {/* Hover-only dots: the strip is transparent until the card is
                  hovered or focused, so the dots never sit on the title a
                  reader is trying to read. `focus-within` keeps them visible
                  for the keyboard reader holding the grip. */}
              <span
                className="pointer-events-none select-none text-xs leading-none text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                aria-hidden
              >
                ⠿
              </span>
            </div>
          </>
        )}
      </div>

      {/* The keyboard route. A real menu rather than a hover affordance,
          because a control that only appears on pointer-hover does not exist
          for a keyboard user (FRONTEND_GUIDE §7.3). */}
      {onMove && (
        <div className="flex justify-end px-3 pb-3">
          <DropdownMenu
            align="end"
            trigger={
              <Button size="sm" variant="outline" aria-label={`Move “${task.title}” to another column`}>
                Move
              </Button>
            }
          >
            {BOARD_COLUMNS.filter((c) => c !== task.status).map((c) => (
              <DropdownItem key={c} onSelect={() => void onMove(task.task_id, c)}>
                {STATUS_LABEL[c]}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </div>
      )}
    </article>
  );
}

/**
 * The copy that follows the pointer. Deliberately NOT a `TaskCardLive` and
 * deliberately hook-free: no `useDraggable` (see the header), no listeners, no
 * menu — paint only, sharing the face so the copy and the card cannot drift.
 */
function TaskCardOverlay({ task }: { task: Task }) {
  return (
    <article className="group relative rounded-md border bg-card shadow-sm transition-opacity rotate-1 shadow-lg ring-1 ring-primary">
      <div className="block w-full p-3 text-left">
        <TaskCardFace task={task} hoverTitle={false} />
      </div>
    </article>
  );
}

/**
 * The card's face: title plus the meta row. One component so the board card
 * and the drag copy render the same words in the same order.
 */
function TaskCardFace({ task, hoverTitle }: { task: Task; hoverTitle: boolean }) {
  const overdue =
    task.due_at && task.status !== "DONE" && task.status !== "CANCELLED" && new Date(task.due_at) < new Date();
  return (
    <>
      <span className={cn("block truncate text-sm font-medium", hoverTitle && "group-hover:text-primary-ink")}>
        {task.title}
      </span>

      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <Pill tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Pill>
        {task.recurrence_rule && <Pill tone="blue">{describeRule(task.recurrence_rule)}</Pill>}
        {task.due_at && (
          <span className={cn("num text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
            {overdue ? "Overdue · " : ""}
            {dateFmt(task.due_at)}
          </span>
        )}
        {task.subtask_count > 0 && (
          <span className="num text-xs text-muted-foreground">
            {task.subtask_done_count}/{task.subtask_count}
          </span>
        )}
        {/* A child roll-up and a checklist count are different units of work,
            so they are two badges rather than one number — see the service's
            `childRollup` for why the two are never averaged together. */}
        {(task.child_count ?? 0) > 0 && (
          <span className="num text-xs text-muted-foreground">
            {task.child_done_count ?? 0}/{task.child_count} child tasks
          </span>
        )}
        {/* Blocked is a STATE, so it wears a label and not only a colour. The
            count includes prerequisites this reader may not be allowed to see:
            work blocked by something hidden is still blocked, and a card that
            said "Blocked by 1" where the truth was 2 would be worse than one
            that said nothing. */}
        {task.is_blocked && (
          <Pill tone="warn">
            {(task.blocking_count ?? 0) > 0 ? `Blocked by ${task.blocking_count}` : "Blocked"}
          </Pill>
        )}
        {/* 13975: the hold's own sentence on the card, truncated — the one line
            a reader needs before opening the panel ("held at customs…"). It is
            a snippet, not the box: the box (note, ETA, resolve, history) lives
            in the panel, where there is room for all of it. */}
        {task.blockage && (
          <span className="min-w-0 max-w-full truncate text-xs text-muted-foreground" title={task.blockage.note}>
            ⛔ {task.blockage.note}
          </span>
        )}
        {task.assigned_to_name && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{task.assigned_to_name}</span>
        )}
        {task.entity_label && <Pill tone="blue">{task.entity_label}</Pill>}
        {/* Which shipment this card is work on (13920). The REFERENCE, not the
            client: a board is read in columns at a glance and the reference is
            the shorter, unambiguous token — the client name is on the row in
            the List view and on the panel, where there is width for it. The
            stage rides the same chip because it is only ever a narrowing of
            the file and a second pill would double the card's badge count.

            THE CHIP IS CAPPED, because the pill is the one thing on this card
            that cannot shrink on its own: `.status` is `white-space: nowrap`,
            so a long stage ("Pré-alerte et ordre de travail") made the chip
            wider than its column and it overhung the neighbouring one — worst
            with the detail pane open, which is exactly when the columns are
            narrowest. `max-w-full` lets the row's `flex-wrap` move the chip
            onto its own line the moment it stops fitting beside the priority
            pill, and the inner `truncate` keeps it inside the card when a
            whole line is not enough either; the full stage stays on hover
            (`title`) and reads in full in the panel's operations-file block,
            which is where a stage is acted on. */}
        {task.dossier_ref && (
          <Pill tone="mute" className="max-w-full">
            <span
              className="min-w-0 truncate"
              // The full set on hover — every stage by name — where the chip
              // itself names the first and counts the rest.
              title={
                task.milestones?.length
                  ? `${task.dossier_ref} · ${task.milestones.map((m) => m.label).filter(Boolean).join(" · ")}`
                  : task.milestone_label
                    ? `${task.dossier_ref} · ${task.milestone_label}`
                    : task.dossier_ref
              }
            >
              {task.dossier_ref}
              {stageSummary(task) ? ` · ${stageSummary(task)}` : ""}
            </span>
          </Pill>
        )}
      </span>
    </>
  );
}

function findTask(board: TaskBoard | undefined, id: string): Task | null {
  if (!board) return null;
  for (const column of BOARD_COLUMNS) {
    const hit = board[column]?.find((t) => t.task_id === id);
    if (hit) return hit;
  }
  return null;
}
