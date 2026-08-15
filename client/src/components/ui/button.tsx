import * as React from "react";
import { cn } from "@/lib/cn";
import {
  PlusIcon,
  TrashIcon,
  DownloadIcon,
  PencilIcon,
  CheckIcon,
  SearchIcon,
  FilterIcon,
  RefreshIcon,
  SendIcon,
} from "@/components/ui/icons";

type Variant = "default" | "outline" | "ghost" | "destructive";
type Size = "default" | "sm" | "lg" | "icon";

// Auto-icon: infer a leading icon from a button's verb so action buttons read as
// finished without every call site passing one. Matches the first word only; an
// explicit `icon` prop always wins, and `icon={null}` opts out.
type IconCmp = React.ComponentType<React.SVGProps<SVGSVGElement>>;
const ACTION_ICONS: { re: RegExp; Icon: IconCmp }[] = [
  {
    re: /^(new|add|create|grant|register|invite|generate|issue|assign|record)\b/i,
    Icon: PlusIcon,
  },
  { re: /^(delete|remove|revoke|archive|purge)\b/i, Icon: TrashIcon },
  { re: /^(export|download)\b/i, Icon: DownloadIcon },
  { re: /^(edit|rename)\b/i, Icon: PencilIcon },
  { re: /^(save|apply|confirm|enable|approve|mark)\b/i, Icon: CheckIcon },
  { re: /^(search|find)\b/i, Icon: SearchIcon },
  { re: /^(filter)\b/i, Icon: FilterIcon },
  { re: /^(refresh|reload|retry|sync|renew)\b/i, Icon: RefreshIcon },
  { re: /^(send|submit)\b/i, Icon: SendIcon },
];
function inferIcon(children: React.ReactNode): IconCmp | null {
  if (typeof children !== "string") return null;
  const label = children.trim();
  for (const { re, Icon } of ACTION_ICONS) if (re.test(label)) return Icon;
  return null;
}

const variants: Record<Variant, string> = {
  default: "btn-primary",
  outline: "btn-surface",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
};
const sizes: Record<Size, string> = {
  default: "h-10 px-[17px] py-2 text-[13px]",
  sm: "h-9 px-3 text-[13px]",
  lg: "h-11 px-6 text-base",
  icon: "h-10 w-10",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Explicit leading icon. Omit to auto-infer from the label verb; pass `null` to opt out. */
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      loading,
      disabled,
      children,
      icon,
      ...props
    },
    ref,
  ) => {
    const Auto =
      icon === undefined && size !== "icon" ? inferIcon(children) : null;
    const leading = loading ? null : icon !== undefined ? (
      icon
    ) : Auto ? (
      <Auto width={16} height={16} />
    ) : null;
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-[11px] font-semibold transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        )}
        {leading}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
