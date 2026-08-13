/** Minimal inline icons (no dependency) — stroke inherits currentColor. */
import * as React from "react";

type P = React.SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

/** Disclosure chevron (points down; rotate with a class for open state).
 *  Promoted here from `app/layout/app-shell.tsx:194`, one of the 26 icons that
 *  file defines inline against this shared set's 20 (F6). */
export const ChevronIcon = (p: P) => (
  <svg {...base(p)} width={p.width ?? 14} height={p.height ?? 14}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const MailIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);
export const LockIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
export const EyeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const EyeOffIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.16 3.19M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a9.1 9.1 0 0 0 3.4-.6" />
    <path d="m3 3 18 18" />
  </svg>
);
export const ArrowRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);
export const SunIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const MoonIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
export const MonitorIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);
export const XIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const KeyIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.7 12.3 8.3-8.3M16 5l3 3M14 7l2 2" />
  </svg>
);
export const HashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const ShieldIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
export const FilterIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" />
  </svg>
);
export const DownloadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
  </svg>
);
export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7" />
  </svg>
);
export const PencilIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3Z" />
  </svg>
);
export const RefreshIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8m0-5v5h-5" />
  </svg>
);
export const SendIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
  </svg>
);
export const CalendarIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 3v4M16 3v4" />
  </svg>
);
export const UploadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15V3m0 0 4 4m-4-4-4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </svg>
);
/** The tenant brand glyph — a soft "X" mark echoing the hub logo. Uses currentColor. */
export const BrandGlyph = (p: P) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden width={22} height={22} {...p}>
    <path
      d="M5 4c3 1.8 5 4.4 7 8 2-3.6 4-6.2 7-8-1.8 3-2.8 5.7-3 8 .2 2.3 1.2 5 3 8-3-1.8-5-4.4-7-8-2 3.6-4 6.2-7 8 1.8-3 2.8-5.7 3-8-.2-2.3-1.2-5-3-8Z"
      fill="currentColor"
    />
  </svg>
);
