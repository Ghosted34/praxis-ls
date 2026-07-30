/**
 * External channel scaffolds (WhatsApp / Instagram) — the unified-inbox tabs for
 * customer conversations on external platforms. These are flag-gated (hidden
 * until the channel is switched on in AI Control → Features) and are scaffolds:
 * the two-pane inbox structure is here, wired to fill once the platform API is
 * connected in Setup (Chunk 4) and the conversation backend lands. Kit-styled.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";

type Platform = "whatsapp" | "instagram";
const META: Record<Platform, { label: string; blurb: string }> = {
  whatsapp: { label: "WhatsApp", blurb: "Customer conversations over WhatsApp Business — one inbox with your team." },
  instagram: { label: "Instagram", blurb: "Instagram DMs and story replies from customers, handled in one place." },
};

function ExternalChannel({ platform }: { platform: Platform }) {
  const m = META[platform];
  const [q, setQ] = React.useState("");
  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <PageHeader eyebrow={<HubCrumb area="Comms" to="/comms" />} title={m.label} description={m.blurb} />
      <HubTabs />

      <div className="mb-4 rounded-xl border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn)/0.08)] px-4 py-3 text-sm">
        <span className="font-medium">{m.label} is enabled but not yet connected.</span> Add the {m.label} API credentials in <span className="font-medium">Comms → Setup</span> to start syncing customer conversations here.
      </div>

      <div className="grid h-[60vh] grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid-cols-[320px_1fr]">
        <div className="flex flex-col border-border md:border-r">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Conversations</span>
            <Pill tone="mute">{m.label}</Pill>
          </div>
          <div className="border-b border-border px-3 py-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${m.label}…`} />
          </div>
          <div className="flex flex-1 items-center justify-center p-4 text-center micro">No conversations yet.</div>
        </div>
        <div className="flex items-center justify-center p-6 text-center micro">Connect {m.label} in Setup to load customer threads.</div>
      </div>
    </section>
  );
}

export function WhatsAppPage() {
  return <ExternalChannel platform="whatsapp" />;
}
export function InstagramPage() {
  return <ExternalChannel platform="instagram" />;
}
