/**
 * Global AI gate + the shared "AI actions on this screen" panel.
 *
 * Every AI affordance in the app routes through <AiActions/> or the
 * useAiEnabled() hook. AI is toggled per tenant from the developer dashboard
 * (the `ai.assistant.backend` feature flag); when it is OFF, no AI UI appears
 * in ANY module. The FE learns the state from `user.ai_enabled` on the auth
 * session (see app/auth/auth-context). It defaults to OFF when the field is
 * absent, so nothing leaks before the backend populates it — AI is opt-in.
 *
 * BE contract (handoff): add `ai_enabled: boolean`, resolved from the tenant's
 * `ai.assistant.backend` feature flag, to the user object returned by
 * /auth/login, /auth/2fa/verify and /auth/pin/login so it is cached + restored
 * like the rest of the user. See doc/AI_GATE_BE_HANDOFF.md.
 */
import * as React from "react";
import { useAuth } from "@/app/auth/auth-context";
import type { AiAction, AiKind } from "@/features/scaffold/screen-specs";

/** True only when the tenant has AI enabled. Defaults false until BE populates. */
export function useAiEnabled(): boolean {
  const { user } = useAuth();
  return user?.ai_enabled === true;
}

/** Renders its children only when AI is enabled for the tenant. */
export function AiGate({ children }: { children: React.ReactNode }) {
  return useAiEnabled() ? <>{children}</> : null;
}

const AI_LABEL: Record<AiKind, string> = { read: "read", write: "action", assist: "AI-assist" };
const AI_CLASS: Record<AiKind, string> = {
  read: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  write: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  assist: "bg-primary/10 text-primary",
};

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

/**
 * The shared, self-gating "AI actions on this screen" panel. Renders nothing
 * when AI is disabled for the tenant OR when there are no actions — so every
 * screen can drop it in unconditionally and it disappears with the global flag.
 */
export function AiActions({ actions }: { actions?: AiAction[] }) {
  const enabled = useAiEnabled();
  if (!enabled || !actions || actions.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-primary">
          <SparkIcon />
        </span>
        <h2 className="text-sm font-semibold text-foreground">AI actions on this screen</h2>
        <span className="text-xs text-muted-foreground">— callable via the assistant (⌘K → Ask) with human confirm on writes</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {actions.map((a) => (
          <div key={a.label} className="lux-card flex items-start gap-3 p-3">
            <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${AI_CLASS[a.kind]}`}>{AI_LABEL[a.kind]}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{a.label}</p>
              <p className="text-xs text-muted-foreground">{a.describe}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
