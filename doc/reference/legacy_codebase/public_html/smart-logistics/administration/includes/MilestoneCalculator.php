<?php
declare(strict_types=1);

class MilestoneCalculator {

  private const SERVICE_CONFIGS = [
    'SEA_FREIGHT_IMPORT' => [
      'stages' => [
        "Pre-Alert / Work Order", "Docs Review", "Import Declaration Lodged",
        "Cargo Discharge", "Customs Clearance", "Duties Paid",
        "Carrier Release", "Port Release", "Loading on Truck",
        "Inland Transport", "Offloading", "Empty Return",
        "Final Invoice", "Closed"
      ],
      'weights' => [5, 5, 10, 10, 20, 5, 5, 5, 5, 20, 10, 0, 0, 0]
    ],

    'SEA_FREIGHT_EXPORT' => [
      'stages' => [
        "Booking Request", "Docs Check", "Export Formalities",
        "Booking Confirmed", "Stuffing", "Customs Inspection",
        "Transfer to Port", "Boarding Auth", "Port Release",
        "Loading on Vessel", "Freight Paid", "OBL Release",
        "Final Invoice", "Closed"
      ],
      'weights' => [5, 5, 15, 5, 20, 15, 10, 5, 5, 15, 0, 0, 0, 0]
    ],

    // IMPORTANT: your DB may store HINTERLAND_TRANSIT (underscore).
    // Keep both keys to be safe.
    'HINTERLAND' => [
      'stages' => [
        "Transport Order", "Transit Docs", "Transit Declaration (CM)",
        "Carrier Release", "Loading on Truck", "Sealing",
        "Inland Leg 1", "Border Crossing", "Inland Leg 2",
        "Arrival Dest", "Clearance Dest", "Delivery",
        "Final Invoice", "Closed"
      ],
      'weights' => [5, 5, 5, 5, 5, 5, 20, 15, 20, 5, 5, 5, 0, 0]
    ],
    'HINTERLAND_TRANSIT' => [
      'stages' => [
        "Transport Order", "Transit Docs", "Transit Declaration (CM)",
        "Carrier Release", "Loading on Truck", "Sealing",
        "Inland Leg 1", "Border Crossing", "Inland Leg 2",
        "Arrival Dest", "Clearance Dest", "Delivery",
        "Final Invoice", "Closed"
      ],
      'weights' => [5, 5, 5, 5, 5, 5, 20, 15, 20, 5, 5, 5, 0, 0]
    ],

    'AIR_FREIGHT_IMPORT' => [
      'stages' => [
        "Pre-Alert", "Docs Review", "Arrival Notice", "Arrival Dest",
        "Discharge", "Import Decl.", "Customs Insp.", "Duties Paid",
        "Customs Release", "Cargo Release", "Dispatch", "Delivery",
        "Final Invoice", "Closed"
      ],
      'weights' => [5, 5, 5, 5, 5, 10, 15, 5, 10, 10, 10, 10, 0, 0]
    ],

    // ADD: Air export (you referenced it in your UI)
    'AIR_FREIGHT_EXPORT' => [
      'stages' => [
        "Booking", "Docs Check", "Export Formalities", "Cargo Handover",
        "Security Screening", "Airline Acceptance", "Departure", "Arrival",
        "Customs", "Cargo Release", "Dispatch", "Delivery",
        "Final Invoice", "Closed"
      ],
      'weights' => [5, 10, 15, 10, 10, 10, 10, 5, 5, 10, 5, 5, 0, 0]
    ],

    // ADD: Inland transportation (your failing case)
    'INLAND_TRANSPORTATION' => [
      'stages' => [
        "Transport Order Received",
        "Documentation Review",
        "Truck Positioning",
        "Loading",
        "In Transit",
        "Checkpoint / Update",
        "Arrival at Destination",
        "Offloading",
        "POD / Delivery Confirmation",
        "Empty Return / Truck Release",
        "Costing / Exposure Review",
        "Final Invoicing",
        "Collections / Closeout",
        "Closed"
      ],
      // heavier in the movement phases
      'weights' => [5, 5, 10, 10, 25, 10, 10, 10, 5, 5, 0, 0, 0, 0]
    ],

    // ADD: Warehousing
    'WAREHOUSING' => [
      'stages' => [
        "Work Order / Inbound Notice",
        "Inbound Scheduling",
        "Receiving / Gate-In",
        "Verification / Inspection",
        "Put-Away",
        "Inventory Control",
        "Cycle Count",
        "Pick",
        "Pack",
        "Dispatch Planning",
        "Gate-Out / Handover",
        "Final Invoicing",
        "Collections / Closeout",
        "Closed"
      ],
      'weights' => [5, 5, 10, 10, 15, 10, 5, 10, 10, 5, 5, 0, 0, 0]
    ],

    // OPTIONAL: If you store these enums in DB, define them too.
    'END_TO_END_AIR_FREIGHT' => [
      'stages' => [
        "Booking", "Docs Review", "Export Clearance", "Cargo Receipt",
        "Departure", "In Transit", "Arrival", "Import Declaration",
        "Customs Clearance", "Cargo Release", "Inland Delivery", "POD",
        "Final Invoice", "Closed"
      ],
      'weights' => [5, 5, 10, 10, 10, 15, 5, 10, 15, 10, 5, 0, 0, 0]
    ],
    'END_TO_END_SEA_FREIGHT' => [
      'stages' => [
        "Booking", "Docs Review", "Export Clearance", "Stuffing / Sealing",
        "Gate-In at Port", "Vessel Loaded", "Vessel Departure", "In Transit",
        "Arrival at POD", "Import Declaration", "Customs Clearance", "Delivery",
        "Final Invoice", "Closed"
      ],
      'weights' => [5, 5, 10, 10, 5, 5, 5, 25, 5, 10, 10, 5, 0, 0]
    ],
  ];

  public function calculateTimeline(string $serviceType, string $startDate, string $deliveryDate, int $currentStageIdx): array {
    $serviceType = strtoupper(trim($serviceType));

    if (!isset(self::SERVICE_CONFIGS[$serviceType])) {
      throw new Exception("Unknown Service Type: $serviceType");
    }

    $config = self::SERVICE_CONFIGS[$serviceType];
    $stages = $config['stages'];
    $weights = $config['weights'];

    $startTs = strtotime($startDate);
    $endTs   = strtotime($deliveryDate);
    $totalDuration = $endTs - $startTs;

    if ($totalDuration <= 0) {
      return ['meta' => ['overall_status' => 'ERROR', 'message' => 'Invalid Dates'], 'schedule' => []];
    }

    $totalWeight = array_sum($weights);
    $milestoneSchedule = [];
    $accumulatedTime = 0.0;
    $now = time();

    foreach ($stages as $index => $stageName) {
      $stageWeight = (float)($weights[$index] ?? 0);

      $allocatedSeconds = ($totalWeight > 0)
        ? ($stageWeight / (float)$totalWeight) * (float)$totalDuration
        : 0.0;

      $stageDueTimestamp = (int)round($startTs + $accumulatedTime + $allocatedSeconds);
      $accumulatedTime += $allocatedSeconds;

      // for zero-weight “administrative” stages, nudge slightly forward
      if ((int)$stageWeight === 0) {
        $stageDueTimestamp = (int)round($startTs + $accumulatedTime + (24 * 3600));
      }

      $milestoneSchedule[$index] = [
        'stage_name' => $stageName,
        'due_at' => date('Y-m-d H:i:s', $stageDueTimestamp),
        'timestamp' => $stageDueTimestamp
      ];
    }

    $currentStageIdx = max(0, min(13, $currentStageIdx));
    $currentStageData = $milestoneSchedule[$currentStageIdx] ?? null;
    $dueTime = $currentStageData ? (int)$currentStageData['timestamp'] : $endTs;

    $riskThreshold = 24 * 3600;
    $dueSoonThreshold = 48 * 3600;

    $status = 'OK';
    $isRisk = false;
    $isDelayed = false;

    if ($currentStageIdx >= 13) {
      $status = 'CLOSED';
    } else {
      if ($now > $dueTime) {
        $status = 'DELAYED';
        $isDelayed = true;
        $isRisk = true;
      } elseif (($dueTime - $now) < $riskThreshold) {
        $status = 'RISK';
        $isRisk = true;
      } elseif (($dueTime - $now) < $dueSoonThreshold) {
        $status = 'DUE';
      }
    }

    return [
      'meta' => [
        'service' => $serviceType,
        'total_duration_hours' => round($totalDuration / 3600, 1),
        'overall_status' => $status,
        'is_risk' => $isRisk,
        'is_delayed' => $isDelayed,
        'current_stage' => $stages[$currentStageIdx] ?? ''
      ],
      'schedule' => $milestoneSchedule
    ];
  }
}
