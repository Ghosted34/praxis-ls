/**
 * DocButton — one-line affordance that opens a record's native document page
 * (/documents/:docType/:id). Drop into any list row or detail view.
 */
import { useNavigate } from "react-router-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

export function DocButton({
  docType,
  id,
  title,
  label = "View document",
  size = "sm",
  variant = "outline",
  beforeOpen,
}: {
  docType: string;
  id: string;
  title?: string;
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  /**
   * Runs before the page opens; resolve `false` to stay. The document is
   * rendered from the SAVED record, so a screen with an edit buffer uses this
   * to save first — otherwise the preview shows the record as it was before
   * the edits, and leaving the screen drops them.
   */
  beforeOpen?: () => boolean | Promise<boolean>;
}) {
  const navigate = useNavigate();
  if (!id) return null;
  return (
    <Button
      size={size}
      variant={variant}
      onClick={async (e) => {
        e.stopPropagation();
        if (beforeOpen && !(await beforeOpen())) return;
        navigate(
          `/documents/${docType}/${id}${title ? `?title=${encodeURIComponent(title)}` : ""}`,
        );
      }}
    >
      {label}
    </Button>
  );
}

export default DocButton;
