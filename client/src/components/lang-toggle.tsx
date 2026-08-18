/**
 * LangToggle — the top-bar EN/FR switch (PRD §617 "bilingual toggle in the
 * top bar"). Persists to localStorage (lib/i18n.setLang) and flips the whole
 * app live via i18next. Same pill styling as EnvToggle so it reads as a
 * session preference, not a nav item.
 */
import { useTranslation } from "react-i18next";
import { setLang } from "@/lib/i18n";

export function LangToggle() {
  const { i18n } = useTranslation();
  const isFr = i18n.language?.startsWith("fr");
  return (
    <button
      type="button"
      onClick={() => setLang(isFr ? "en" : "fr")}
      aria-label={isFr ? "Switch to English" : "Passer en français"}
      title={isFr ? "Switch to English" : "Passer en français"}
      className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-[11px] font-semibold text-foreground transition-colors hover:bg-accent"
    >
      {isFr ? "EN" : "FR"}
    </button>
  );
}

export default LangToggle;
