<?php
declare(strict_types=1);

class MilestoneCalculator {

  // --- CONFIGURATION ---
  private const SERVICE_CONFIGS = [
    'SEA_FREIGHT_IMPORT' => [
      'anchor_index' => 3, // Cargo Discharge
      'stages' => ["Pre-Alert / Work Order", "Docs Review", "Import Declaration Lodged", "Cargo Discharge", "Customs Clearance", "Duties Paid", "Carrier Release", "Port Release", "Loading on Truck", "Inland Transport", "Offloading", "Empty Return", "Final Invoice", "Closed"],
      'weights' => [0, 5, 5, 0, 20, 5, 5, 5, 5, 20, 10, 5, 0, 0]
    ],
    'SEA_FREIGHT_EXPORT' => [
      'anchor_index' => 3, // Booking Confirmed
      'stages' => ["Booking Request", "Docs Check", "Export Formalities", "Booking Confirmed", "Stuffing", "Customs Inspection", "Transfer to Port", "Boarding Auth", "Port Release", "Loading on Vessel", "Freight Paid", "OBL Release", "Final Invoice", "Closed"],
      'weights' => [5, 5, 10, 0, 20, 15, 10, 5, 5, 15, 0, 0, 0, 0]
    ],
    'HINTERLAND_TRANSIT' => [
      'anchor_index' => 9, // Arrival Dest
      'stages' => ["Transport Order", "Transit Docs", "Transit Declaration (CM)", "Carrier Release", "Loading on Truck", "Sealing", "Inland Leg 1", "Border Crossing", "Inland Leg 2", "Arrival Dest", "Clearance Dest", "Delivery", "Final Invoice", "Closed"],
      'weights' => [5, 5, 5, 5, 5, 5, 20, 15, 20, 0, 5, 5, 0, 0]
    ],
    'AIR_FREIGHT_IMPORT' => [
      'anchor_index' => 3, // Arrival Dest
      'stages' => ["Pre-Alert", "Docs Review", "Arrival Notice", "Arrival Dest", "Discharge", "Import Decl.", "Customs Insp.", "Duties Paid", "Customs Release", "Cargo Release", "Dispatch", "Delivery", "Final Invoice", "Closed"],
      'weights' => [5, 5, 5, 0, 5, 10, 15, 5, 10, 10, 10, 10, 0, 0]
    ],
    'AIR_FREIGHT_EXPORT' => [
      'anchor_index' => 5, // Airline Acceptance
      'stages' => ["Booking", "Docs Check", "Export Formalities", "Cargo Handover", "Security Screening", "Airline Acceptance", "Departure", "Arrival", "Customs", "Cargo Release", "Dispatch", "Delivery", "Final Invoice", "Closed"],
      'weights' => [5, 10, 15, 10, 10, 0, 10, 5, 5, 10, 5, 5, 0, 0]
    ],
    'DEFAULT' => [
      'anchor_index' => 0,
      'stages' => ["Initiated", "Processing", "Completed"],
      'weights' => [0, 100, 0]
    ]
  ];

  public function calculateTimeline(string $serviceType, ?string $createdDate, ?string $expectedDeliveryDate, $progressData = []): array {
    $raw = strtoupper(trim($serviceType));
    $serviceKey = str_replace(' ', '_', $raw);

    if (!isset(self::SERVICE_CONFIGS[$serviceKey])) {
        if (str_contains($raw, 'HINTERLAND')) $serviceKey = 'HINTERLAND_TRANSIT';
        elseif (str_contains($raw, 'SEA') && str_contains($raw, 'IMPORT')) $serviceKey = 'SEA_FREIGHT_IMPORT';
        elseif (str_contains($raw, 'SEA') && str_contains($raw, 'EXPORT')) $serviceKey = 'SEA_FREIGHT_EXPORT';
        elseif (str_contains($raw, 'AIR') && str_contains($raw, 'IMPORT')) $serviceKey = 'AIR_FREIGHT_IMPORT';
        elseif (str_contains($raw, 'AIR') && str_contains($raw, 'EXPORT')) $serviceKey = 'AIR_FREIGHT_EXPORT';
        else $serviceKey = 'DEFAULT';
    }

    $config = self::SERVICE_CONFIGS[$serviceKey];
    $stages = $config['stages'];
    $weights = $config['weights'];
    $anchorIdx = $config['anchor_index'];

    $completedDates = [];
    if (is_array($progressData)) {
        $completedDates = $progressData; 
    } elseif (is_numeric($progressData)) {
        $maxIdx = (int)$progressData;
        for ($i=0; $i<=$maxIdx; $i++) {
            $completedDates[$i] = $createdDate ?: date('Y-m-d H:i:s');
        }
    }

    $dueTs = 0;
    if ($expectedDeliveryDate) {
        $safeDate = str_replace('/', '-', $expectedDeliveryDate);
        $dueTs = strtotime($safeDate);
    }
    if (!$dueTs) $dueTs = time() + (86400 * 365); 

    $anchorDateStr = $completedDates[$anchorIdx] ?? null;
    if ($anchorIdx === 0 && !$anchorDateStr) $anchorDateStr = $createdDate;
    
    $anchorTs = $anchorDateStr ? strtotime($anchorDateStr) : null;

    $schedule = [];
    $meta = [
      'overall_status' => 'OK', 
      'is_risk' => false,
      'is_delayed' => false,
      'current_stage_name' => '',
      'anchor_met' => false
    ];

    if (!$expectedDeliveryDate) {
       $meta['overall_status'] = 'AWAITING Est. Del. Date';
    } elseif (!$anchorTs) {
       $meta['overall_status'] = 'PENDING ARRIVAL';
    } else {
       $meta['anchor_met'] = true;
    }

    $totalRemainingWeight = 0;
    for ($i = $anchorIdx + 1; $i < count($weights); $i++) {
        $totalRemainingWeight += $weights[$i];
    }

    $availableSeconds = ($anchorTs && $dueTs > $anchorTs) ? ($dueTs - $anchorTs) : 0;
    $accumulatedSeconds = 0;

    foreach ($stages as $i => $name) {
       $isComplete = isset($completedDates[$i]);
       $calcDue = null;

       if ($i <= $anchorIdx) {
          $calcDue = $completedDates[$i] ?? ($anchorTs ? date('Y-m-d H:i:s', $anchorTs) : null);
       } else {
          if ($anchorTs && $totalRemainingWeight > 0) {
             $share = $weights[$i] / $totalRemainingWeight;
             $stageSeconds = $availableSeconds * $share;
             $accumulatedSeconds += $stageSeconds;
             $baseTs = $this->adjustForWeekend($anchorTs + (int)$accumulatedSeconds);
             $calcDue = date('Y-m-d H:i:s', $baseTs);
          } else {
             $calcDue = null;
          }
       }

       $schedule[$i] = [
         'stage_name' => $name,
         'due_at' => $calcDue,
         'status' => $isComplete ? 'completed' : 'pending'
       ];
    }

    if ($meta['overall_status'] === 'OK' || $meta['overall_status'] === 'PENDING ARRIVAL') {
        foreach ($schedule as $i => $step) {
           if ($step['status'] === 'pending' && $step['due_at']) {
              $dueTime = strtotime($step['due_at']);
              $meta['current_stage_name'] = $step['stage_name'];
              
              if (time() > $dueTime) {
                 $meta['overall_status'] = 'DELAYED';
                 $meta['is_delayed'] = true;
                 $meta['is_risk'] = true;
              } elseif (($dueTime - time()) < 86400) { 
                 $meta['overall_status'] = 'RISK';
                 $meta['is_risk'] = true;
              }
              break; 
           }
        }
    }
    
    return ['meta' => $meta, 'schedule' => $schedule];
  }

  private function adjustForWeekend(int $ts): int {
     $w = (int)date('w', $ts); 
     if ($w === 0) return strtotime("next Monday 08:00", $ts);
     return $ts;
  }
}