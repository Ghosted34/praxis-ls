import { Navigate } from "react-router-dom";
import { TabbedHub } from "@/components/tabbed-hub";
import { useAiEnabled } from "@/components/ai-actions";
import { AiFeaturesPage, AiGrantsPage, AiBudgetPage, AiUsagePage } from "./pages";

export function AiControlHub() {
  // AI Control governs AI features; with AI off for the tenant there's nothing to
  // manage here, so a direct URL redirects home (the nav entry is hidden too).
  if (!useAiEnabled()) return <Navigate to="/" replace />;
  return (
    <TabbedHub
      eyebrow="AI Control"
      basePath="/ai-control"
      tabs={[
        { key: "features", label: "Features", Component: AiFeaturesPage },
        { key: "access", label: "Access", Component: AiGrantsPage },
        { key: "budget", label: "Budget", Component: AiBudgetPage },
        // Vendor keys moved to the platform console (one shared deploy-wide set).
        { key: "usage", label: "Usage", Component: AiUsagePage },
      ]}
    />
  );
}
