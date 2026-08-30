/**
 * The state module's front door.
 *
 * Everything here is imported as `@/components/state`, never by file: §3.3 makes
 * this the one place the four presentation states and the shipment vocabulary
 * live, and a call site that reaches past the barrel is the first step back
 * towards a page inventing its own.
 */
export {
  Spinner,
  LoadingRow,
  LoadingState,
  EmptyState,
  NotFoundState,
  ErrorState,
  SuccessState,
} from "./presentation";

export {
  type MilestoneState,
  type ServiceMode,
  milestoneState,
  milestoneStateLabel,
  isClosed,
  MilestoneStatePill,
  MilestoneMarker,
  ModeIcon,
} from "./shipment-state";
