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
}: {
  docType: string;
  id: string;
  title?: string;
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}) {
  const navigate = useNavigate();
  if (!id) return null;
  return (
    <Button
      size={size}
      variant={variant}
      onClick={(e) => { e.stopPropagation(); navigate(`/documents/${docType}/${id}${title ? `?title=${encodeURIComponent(title)}` : ""}`); }}
    >
      {label}
    </Button>
  );
}

export default DocButton;
