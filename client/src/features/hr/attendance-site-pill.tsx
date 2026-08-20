import { Pill } from "@/components/ui/pill";
import i18n from "@/lib/i18n";
import type { AttendanceRow } from "@/lib/hr-api";

export function SitePill({
  within,
  status,
}: {
  within?: boolean | null;
  status?: AttendanceRow["location_status"];
}) {
  const s = status || (within === true ? "on_site" : within === false ? "off_site" : "no_gps");
  if (s === "on_site") return <Pill tone="ok">{i18n.t("hr.onSite")}</Pill>;
  if (s === "off_site") return <Pill tone="bad">{i18n.t("hr.offSite")}</Pill>;
  if (s === "unfenced") return <Pill tone="mute">{i18n.t("hr.noWorksite")}</Pill>;
  return <Pill tone="bad">{i18n.t("hr.noGps")}</Pill>;
}
