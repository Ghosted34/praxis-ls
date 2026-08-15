/** WMS (Phase 3) screens — every screen is now a purpose-built workstation
 *  (ledger / count sheet / pick-pack / receiving / allocation board / tree),
 *  re-exported here so the hub imports are unchanged. */
export { LocationsPage } from "./location-360"; // per-location 360 (stock/equipment/counts)
export { InventoryPage } from "./inventory"; // stock ledger + moves + journal
export { InboundPage } from "./inbound"; // receiving + QA gate
export { OutboundPage } from "./outbound"; // pick / pack / dispatch
export { EquipmentPage } from "./equipment"; // allocation board
export { CycleCountsPage } from "./cycle-count"; // count sheet + variance
