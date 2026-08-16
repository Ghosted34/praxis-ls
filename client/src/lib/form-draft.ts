/**
 * Form drafts — what you typed survives a network drop, a crash and a reload.
 *
 * WHY THIS EXISTS. "I was filling a form, it means I have lost it." That is the
 * actual report, and it was correct: nothing in this client persisted an
 * in-progress form anywhere. A dropped connection, a chunk-reload after a
 * deploy, an ErrorBoundary catch, a closed laptop — every one of them threw the
 * work away, and the only recovery offered was "Reload the page", which is the
 * instruction that guarantees the loss. `error-boundary.tsx` even names this
 * ("a manual reload — which in this app also means losing an unsaved form") and
 * then had nothing to hand it.
 *
 * WHAT THIS IS NOT. It is not offline data entry and it is not a sync engine.
 * A draft is a local copy of the fields as typed, restored on the same device,
 * for the same user, into the same form. It has never been near the server and
 * carries no id the server would recognise — sending it is the outbox's job
 * (`lib/outbox.ts`), and the two are deliberately separate: a draft is
 * "unfinished", an outbox entry is "finished and awaiting the network".
 *
 * SECRETS ARE NEVER WRITTEN. `localStorage` is readable by any script on the
 * origin and survives sign-out, so anything that looks like a credential is
 * dropped on the way in — see `REDACT`. A password field that autosaved would
 * turn a convenience into a vulnerability, and "the developer will remember to
 * pass `exclude`" is not a control.
 *
 * @example  // any form, controlled or RHF
 * const draft = useFormDraft({ key: `entity:${id ?? "new"}`, values, label: "Corporate entity" });
 * // …restore banner
 * {draft.pending && <DraftBanner draft={draft} onRestore={(v) => reset(v)} />}
 * // …after a successful save
 * draft.clear();
 */
import * as React from "react";
import { tokenStore } from "./token-store";

const PREFIX = "praxis.draft.";

/** Drafts older than this are noise, not a rescue. Pruned on read. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Per-draft cap. A form big enough to exceed this is a document editor, and
 * filling the origin's ~5 MB budget with one screen's autosave would break
 * every OTHER feature that needs storage (density, nav cache, the outbox) —
 * a rescue that costs the app its settings is not a rescue.
 */
const MAX_BYTES = 64 * 1024;

/** How long the user must stop typing before a write. */
const DEBOUNCE_MS = 700;

/**
 * Field names never written to disk, matched case-insensitively against the
 * whole key path. Deliberately broad: the cost of over-redacting is one field
 * the user retypes, the cost of under-redacting is a password sitting in
 * `localStorage` until the TTL expires.
 */
const REDACT =
  /pass(word|phrase)?|secret|token|otp|\bpin\b|cvv|cvc|card_?number|iban|api_?key|private_?key|answer/i;

export type Draft<T> = {
  values: T;
  /** Epoch ms of the last write. */
  savedAt: number;
  /** Human label for the restore prompt ("Corporate entity"). */
  label?: string;
  /** Where the user was, so a restore can offer to take them back. */
  path?: string;
};

const storage = (): Storage | null => {
  try {
    // Private-mode Safari throws on ACCESS, not just on write — the same guard
    // `lib/density.ts` needs, and for the same reason.
    return window.localStorage;
  } catch {
    /* @silent:storage — private-mode Safari throws on access; no storage available */
    return null;
  }
};

/**
 * Namespaced by environment, because LIVE and SANDBOX are different worlds.
 * Restoring a sandbox draft into a live invoice form is precisely the class of
 * mistake `tenantKey()` already guards the query cache against.
 */
const storageKey = (key: string) => `${PREFIX}${tokenStore.getEnv()}.${key}`;

/** Strip credential-shaped fields, at any depth, before anything is written. */
function redact(value: unknown, path = ""): unknown {
  // BEFORE the object branch, not after — a File IS an object, so the generic
  // walk below would happily "serialise" it to `{}`. Restoring that produces a
  // form claiming an attachment survived when it did not, which is the exact
  // failure this guard exists to prevent; sitting after the walk, it was
  // unreachable and prevented nothing.
  if (typeof value === "function") return undefined;
  if (typeof Blob !== "undefined" && value instanceof Blob) return undefined;
  if (Array.isArray(value))
    return value.map((v, i) => redact(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT.test(k)) continue;
      out[k] = redact(v, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return value;
}

/** True when the object has nothing worth restoring — all blank, all default. */
function isEmpty(values: unknown): boolean {
  if (values == null) return true;
  if (typeof values === "string") return values.trim() === "";
  if (Array.isArray(values))
    return values.length === 0 || values.every(isEmpty);
  if (typeof values === "object") {
    const entries = Object.values(values as Record<string, unknown>);
    return entries.length === 0 || entries.every(isEmpty);
  }
  return false;
}

export function saveDraft<T>(
  key: string,
  values: T,
  meta?: { label?: string; path?: string },
): void {
  const s = storage();
  if (!s) return;
  // An empty form is not a draft. Writing one would make every screen the user
  // merely OPENED offer to restore nothing, training them to dismiss the prompt
  // without reading it — at which point the prompt no longer works on the day
  // it matters.
  if (isEmpty(values)) {
    clearDraft(key);
    return;
  }
  const payload: Draft<unknown> = {
    values: redact(values),
    savedAt: Date.now(),
    label: meta?.label,
    path:
      meta?.path ??
      (typeof location !== "undefined"
        ? location.pathname + location.search
        : undefined),
  };
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    /* @silent:parse — a cyclic or otherwise unserialisable value; throwing
       here would take down the form the user is still typing into */
    return;
  }
  if (json.length > MAX_BYTES) return;
  try {
    s.setItem(storageKey(key), json);
  } catch {
    // Quota. Free what we can — old drafts first — and try once more, so the
    // form in front of the user wins over one abandoned last Tuesday.
    pruneDrafts();
    try {
      s.setItem(storageKey(key), json);
    } catch {
      /* @silent:storage — still full after pruning; the draft is lost but the form is not */
    }
  }
}

export function readDraft<T>(key: string): Draft<T> | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(storageKey(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Draft<T>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.savedAt !== "number"
    )
      throw new Error("shape");
    if (Date.now() - parsed.savedAt > TTL_MS) {
      clearDraft(key);
      return null;
    }
    return parsed;
  } catch {
    /* @silent:parse — a key written by an older build or hand-edited; drop
       it rather than letting a parse throw blank the screen that was trying
       to help */
    clearDraft(key);
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(storageKey(key));
  } catch {
    /* @silent:storage — removeItem can throw in private mode; nothing to recover */
  }
}

/** Every live draft, newest first. Powers "you have 2 unsaved forms". */
export function listDrafts(): Array<Draft<unknown> & { key: string }> {
  const s = storage();
  if (!s) return [];
  const out: Array<Draft<unknown> & { key: string }> = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try {
      const parsed = JSON.parse(s.getItem(k) || "") as Draft<unknown>;
      if (
        parsed &&
        typeof parsed.savedAt === "number" &&
        Date.now() - parsed.savedAt <= TTL_MS
      ) {
        out.push({ ...parsed, key: k.slice(PREFIX.length) });
      }
    } catch {
      /* @silent:parse — skip unreadable entries; they'll be pruned next pass */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** Drop expired and unreadable drafts. Called on quota pressure and at boot. */
export function pruneDrafts(): void {
  const s = storage();
  if (!s) return;
  const doomed: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try {
      const parsed = JSON.parse(s.getItem(k) || "") as Draft<unknown>;
      if (
        !parsed ||
        typeof parsed.savedAt !== "number" ||
        Date.now() - parsed.savedAt > TTL_MS
      )
        doomed.push(k);
    } catch {
      doomed.push(k);
    }
  }
  doomed.forEach((k) => {
    try {
      s.removeItem(k);
    } catch {
      /* @silent:storage|parse|teardown */
      /* nothing to do */
    }
  });
}

export type FormDraftApi<T> = {
  /**
   * A draft found on mount that has NOT yet been restored or dismissed. This
   * is the one the banner offers; it is snapshotted once so that autosaving the
   * live form cannot overwrite the thing the user is being offered.
   */
  pending: Draft<T> | null;
  /** Epoch ms of the most recent autosave, for the "Saved 12:04" line. */
  savedAt: number | null;
  /** Take the pending draft; dismisses the banner. */
  restore: () => T | null;
  /** Throw the pending draft away; dismisses the banner. */
  discard: () => void;
  /** Delete the stored draft. Call after a successful save. */
  clear: () => void;
};

/**
 * Autosave `values` under `key`, and surface anything found from last time.
 *
 * Takes the values rather than a form instance so it works with both the RHF
 * screens (`useFormDraft({ values: form.watch() })`) and the many screens still
 * holding a plain `useState` object — a hook that only spoke RHF would cover
 * about a third of the write surface in this app.
 */
export function useFormDraft<T>({
  key,
  values,
  label,
  enabled = true,
}: {
  key: string;
  values: T;
  label?: string;
  enabled?: boolean;
}): FormDraftApi<T> {
  // Snapshotted on mount: the autosave below starts writing within the second,
  // and reading lazily would race it and offer the user their own empty form.
  const [pending, setPending] = React.useState<Draft<T> | null>(() =>
    enabled ? readDraft<T>(key) : null,
  );
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const first = React.useRef(true);

  React.useEffect(() => {
    if (!enabled) return;
    // Skip the mount pass. Without this, opening a form and closing it again
    // writes a draft of the DEFAULT values — which then offers to restore
    // nothing, on every subsequent visit.
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      saveDraft(key, values, { label });
      setSavedAt(Date.now());
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key, values, label, enabled]);

  // A tab being closed or hidden is the last chance to write, and it can happen
  // inside the debounce window — which is exactly the crash case this exists
  // for. `visibilitychange` rather than `beforeunload`: the latter is ignored
  // on mobile Safari, where a backgrounded tab is simply discarded.
  React.useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const flush = () => {
      if (document.visibilityState === "hidden")
        saveDraft(key, values, { label });
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [key, values, label, enabled]);

  return {
    pending,
    savedAt,
    restore: () => {
      const v = pending?.values ?? null;
      setPending(null);
      return v;
    },
    discard: () => {
      clearDraft(key);
      setPending(null);
    },
    clear: () => {
      clearDraft(key);
      setPending(null);
      setSavedAt(null);
    },
  };
}
