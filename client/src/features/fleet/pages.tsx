/** Fleet (Phase 3) screens — every screen is now a purpose-built workstation
 *  (360 / board / lifecycle / expiry board), re-exported here so the hub imports
 *  are unchanged. Per-screen implementations live in their own files. */
export { VehiclesPage } from "./vehicle"; // Vehicle 360 master/detail
export { VehicleCompliancePage } from "./compliance"; // insurance/VT expiry board
export { WorkOrdersPage } from "./work-orders"; // maintenance workstation
export { DispatchPage } from "./dispatch"; // assign → check-out/in board
export { FuelLogPage } from "./fuel"; // fuel capture + efficiency
export { DriversPage } from "./drivers"; // driver licence expiry board
export { IncidentsPage } from "./incidents"; // report → review → closed
