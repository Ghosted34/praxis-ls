/** Composer slot `composer.footer.left` — PR-2. Does not edit composer.tsx. */
import { useTranslation } from "react-i18next";

export function SignatureSlot() {
  const { t } = useTranslation();
  return (
    <span className="text-xs text-muted-foreground">{t("mail.signatureOnSend")}</span>
  );
}
