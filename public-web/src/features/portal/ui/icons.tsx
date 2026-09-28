import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The portal's icons — inline SVG, stroke-only, `currentColor`, 24px grid.
 *
 * In the portal an icon carries MEANING, so a row can say "invoice, overdue"
 * without a sentence: that is the owner's brief ("too much text at first
 * glance"). They live in the portal's chunk, so a marketing page never
 * downloads them, and they are drawn here rather than imported for the reason
 * `components/ui/icons.tsx` gives: an icon package is forty kilobytes of
 * geometry to use a handful of glyphs. 1.75px strokes read at 20-24px on a
 * phone in daylight.
 */
type Props = React.SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, className, children, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </Svg>
);
export const ShipIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 17c1.5 1.2 3 1.8 4.5 1.8S10.5 18 12 17c1.5 1 3 1.8 4.5 1.8S19.5 18.2 21 17" />
    <path d="M5 15.5 4 11h16l-1.5 4.5" />
    <path d="M7 11V7h10v4" />
    <path d="M12 4v3" />
  </Svg>
);
export const PlaneIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M17.8 19.2 16 11l3.5-3.5c1.2-1.2 1.6-3 .9-3.9-.9-.7-2.7-.3-3.9.9L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
  </Svg>
);
export const TruckIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 6h11v10H3z" />
    <path d="M14 9h4l3 3.5V16h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17.5" cy="17.5" r="1.8" />
  </Svg>
);
export const TrainIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="13" rx="3" />
    <path d="M5 10h14" />
    <path d="M9 16l-2.5 4M15 16l2.5 4" />
    <circle cx="9" cy="13" r=".6" fill="currentColor" />
    <circle cx="15" cy="13" r=".6" fill="currentColor" />
  </Svg>
);
export const WarehouseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 9.5 12 4l9 5.5V20H3z" />
    <path d="M7 20v-7h10v7M7 16h10" />
  </Svg>
);
export const CustomsIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const BoxIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </Svg>
);
export const DocIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
);
export const FolderIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);
export const ReceiptIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);
export const WalletIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7a2 2 0 0 1 2-2h11v4" />
    <path d="M4 7v11a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2" />
    <circle cx="16" cy="14.5" r="1.2" fill="currentColor" />
  </Svg>
);
export const BankIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m3 9 9-5 9 5" />
    <path d="M5 10v7M9.7 10v7M14.3 10v7M19 10v7M3 20h18" />
  </Svg>
);
export const PhoneIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Svg>
);
export const CashIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9.5v.01M18 14.5v.01" />
  </Svg>
);
export const ChequeIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6 14h5M6 10.5h3M14 14c1-1.6 2-2.4 3-2.4" />
  </Svg>
);
export const ChatIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 11.5a7.5 7.5 0 0 1-11.2 6.5L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5z" />
    <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeWidth={2.4} />
  </Svg>
);
export const SendIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m21 3-9.5 9.5M21 3l-6.5 18-3-8.5L3 9.5z" />
  </Svg>
);
export const CameraIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 8a2 2 0 0 1 2-2h1.5L9 4h6l1.5 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </Svg>
);
export const UploadIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);
export const DownloadIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);
export const CheckIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const CheckCircleIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.3 2.8 2.7L16 9.5" />
  </Svg>
);
export const CloseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const ChevronRightIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);
export const ChevronLeftIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m15 5-7 7 7 7" />
  </Svg>
);
export const ChevronDownIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m5 9 7 7 7-7" />
  </Svg>
);
export const PlusIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const SearchIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const UserIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </Svg>
);
export const UsersIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 15.3c1.7.6 3 2.2 3.5 4.7" />
  </Svg>
);
export const UserPlusIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="10" cy="8" r="4" />
    <path d="M3 20.5c1.1-3.6 3.8-5.5 7-5.5 1.4 0 2.7.3 3.8 1M18.5 14v6M15.5 17h6" />
  </Svg>
);
export const LogOutIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" />
  </Svg>
);
export const GlobeIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" />
  </Svg>
);
export const SunIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Svg>
);
export const MoonIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Svg>
);
export const DeviceIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="14" height="10" rx="1.5" />
    <path d="M7 18h6M10 14v4" />
    <rect x="17" y="9" width="4.5" height="11" rx="1.2" />
  </Svg>
);
export const FingerprintIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M7.5 20.5c.8-1.8 1.3-3.8 1.3-5.9a3.2 3.2 0 0 1 6.4 0c0 1.2-.1 2.3-.3 3.4" />
    <path d="M12 14.6c0 2.7-.6 5.2-1.7 7.4M16.8 19.5c.4-1.6.6-3.2.6-4.9a5.4 5.4 0 0 0-10.8 0c0 .9-.1 1.7-.3 2.5" />
    <path d="M4.4 12.6A7.6 7.6 0 0 1 17.9 8M19.4 11.2c.1.4.1.9.1 1.4" />
  </Svg>
);
export const FaceIdIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5c1.5 1.1 3.5 1.1 5 0" />
  </Svg>
);
export const MailIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </Svg>
);
export const KeyIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M16.5 6.5 19 9M14 9l2 2" />
  </Svg>
);
export const LockIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const ShieldIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3 4.5 6v5.2c0 4.7 3.2 8.4 7.5 9.8 4.3-1.4 7.5-5.1 7.5-9.8V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Svg>
);
export const InfoIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.8v.01" strokeWidth={2.1} />
  </Svg>
);
export const AlertIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4.5M12 17v.01" strokeWidth={2} />
  </Svg>
);
export const ClockIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 2" />
  </Svg>
);
export const CalendarIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const PinIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 21c-4-4.5-7-8-7-11.5a7 7 0 0 1 14 0C19 13 16 16.5 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
);
export const CopyIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Svg>
);
export const EyeIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const EyeOffIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 3l18 18M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.6 4.6-1.4" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
);
export const TrashIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" />
  </Svg>
);
export const SparkIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8-5.7-1.9L10.2 9z" />
  </Svg>
);
export const QuoteIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </Svg>
);
export const ArrowRightIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </Svg>
);
export const RouteIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8.5 18H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7.5" />
  </Svg>
);
export const ContainerIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
    <path d="M6.5 9v6M10 9v6M13.5 9v6M17 9v6" />
  </Svg>
);
export const MoreIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" strokeWidth={2.6} />
  </Svg>
);
export const RefreshIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" />
  </Svg>
);
export const PaperclipIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M20.5 11.5 12 20a5.3 5.3 0 0 1-7.5-7.5l9-9a3.5 3.5 0 0 1 5 5l-9 9a1.8 1.8 0 0 1-2.5-2.5l8.3-8.3" />
  </Svg>
);
/** A box with its lid and an arrow down — "everything, in one download". */
export const ArchiveIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 4h18v4H3z" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M12 11v6M9.5 14.5 12 17l2.5-2.5" />
  </Svg>
);
/** A microphone — "record a voice note". */
export const MicIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </Svg>
);
/** Two ticks — the team has read it. */
export const DoubleCheckIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m2.5 12.5 4.5 4.5 9.5-9.5M11.5 16.5l.5.5 9.5-9.5" />
  </Svg>
);
export const PlayIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const PauseIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
  </Svg>
);
/** A picture — "photos". */
export const ImageIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 16-5-5-8.5 9" />
  </Svg>
);
/** A bell — "tell me". */
export const BellIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
    <path d="M10 21a2.2 2.2 0 0 0 4 0" />
  </Svg>
);
/** A box with an arrow out — iOS's Share button, which is where "Add to Home Screen" lives. */
export const ShareIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M8 9H6.5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 9H16" />
    <path d="M12 3v11M8.5 6.5 12 3l3.5 3.5" />
  </Svg>
);
/** A phone with a star on it — "add the portal to this device". */
export const InstallIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M12 8v6M9.5 11.5 12 14l2.5-2.5M10.5 18.5h3" />
  </Svg>
);
/** Three blocks of different heights — a town, as a place on a route. */
export const CityIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 20.5h17" />
    <path d="M5 20.5V9l5-2.5v14" />
    <path d="M10 20.5V11l5-2v11.5" />
    <path d="M15 20.5V12l4 1.5v7" />
  </Svg>
);
/** A flag on a pole — a border post. */
export const FlagIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M5.5 21V3.5" />
    <path d="M5.5 4.5h12l-2.8 4 2.8 4h-12" />
  </Svg>
);
/** A pencil — "use what I wrote". */
export const PencilIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" />
    <path d="M13.5 7l3 3" />
  </Svg>
);
