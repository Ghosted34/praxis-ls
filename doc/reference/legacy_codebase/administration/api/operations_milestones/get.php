<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/../../includes/MilestoneCalculator.php';

require_role(['ADMIN','OPERATIONS','MANAGEMENT','SALES']);

header('Content-Type: application/json; charset=utf-8');

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

function label_or_dash(?string $v): string {
    $v = trim((string)$v);
    return $v !== '' ? $v : '—';
}

function build_origin_destination(array $r): array {
    $service = strtoupper(trim((string)($r['service_type'] ?? '')));
    
    $pol = trim((string)($r['port_of_loading'] ?? ''));
    $pod = trim((string)($r['port_of_delivery'] ?? ''));
    $pde = trim((string)($r['place_of_delivery'] ?? '')); // Ensure this column exists or use logic below
    
    $sea_pol = trim((string)($r['sea_pol'] ?? ''));
    $sea_pod = trim((string)($r['sea_pod'] ?? ''));
    $air_o   = trim((string)($r['air_origin'] ?? ''));
    $air_d   = trim((string)($r['air_dest'] ?? ''));

    // AIR
    if (str_contains($service, 'AIR')) {
        return [
            'origin_label'      => label_or_dash($air_o),
            'destination_label' => label_or_dash($air_d),
        ];
    }

    // SEA
    if (str_contains($service, 'SEA')) {
        $o = $pol !== '' ? $pol : $sea_pol;
        $d = $pod !== '' ? $pod : $sea_pod;
        return [
            'origin_label'      => label_or_dash($o),
            'destination_label' => label_or_dash($d),
        ];
    }

    // FALLBACK (Inland/Hinterland)
    return [
        'origin_label'      => label_or_dash($pol), // Default to POL/Origin
        'destination_label' => label_or_dash($pod), // Default to POD/Final Dest
    ];
}

// BACKUP STAGE NAMES (In case Calculator defaults)
$BACKUP_TEMPLATES = [
    'SEA_FREIGHT_IMPORT' => ["Pre-Alert / Work Order","Docs Review","Import Declaration Lodged","Cargo Discharge","Customs Clearance","Duties Paid","Carrier Release","Port Release","Loading on Truck","Inland Transport","Offloading","Empty Return","Final Invoice","Closed"],
    'SEA_FREIGHT_EXPORT' => ["Booking Request","Docs Check","Export Formalities","Booking Confirmed","Stuffing","Customs Inspection","Transfer to Port","Boarding Auth","Port Release","Loading on Vessel","Freight Paid","OBL Release","Final Invoice","Closed"],
    'HINTERLAND_TRANSIT' => ["Transport Order","Transit Docs","Transit Declaration (CM)","Carrier Release","Loading on Truck","Sealing","Inland Leg 1","Border Crossing","Inland Leg 2","Arrival Dest","Clearance Dest","Delivery","Final Invoice","Closed"],
    'AIR_FREIGHT_IMPORT' => ["Pre-Alert","Docs Review","Arrival Notice","Arrival Dest","Discharge","Import Decl.","Customs Insp.","Duties Paid","Customs Release","Cargo Release","Dispatch","Delivery","Final Invoice","Closed"],
    'AIR_FREIGHT_EXPORT' => ["Booking","Docs Check","Export Formalities","Cargo Handover","Security Screening","Airline Acceptance","Departure","Arrival","Customs","Release","Dispatch","Delivery","Final Invoice","Closed"]
];


$ref = trim((string)($_GET['ref'] ?? ''));
if ($ref === '') jexit(['ok'=>false,'error'=>'Missing ref'], 400);

$conn = db();

/**
 * SELECT ALL MILESTONE COLUMNS + ROUTE DATA
 */
$stageCols = [];
for ($i=0; $i<=13; $i++) {
  $stageCols[] = "m{$i}_completed_at";
  $stageCols[] = "m{$i}_location";
  $stageCols[] = "m{$i}_reference";
  $stageCols[] = "m{$i}_notes";
}
$stageSelect = implode(",\n    ", $stageCols);

$sql = "
  SELECT 
    operations_file_reference,
    client_id, 
    client_name,
    service_type,
    operations_status,
    created_at,
    expected_delivery_time,
    current_stage_index,
    current_stage_updated_at,
    current_stage_updated_by_user_id,
    
    -- Route Details (Added)
    port_of_loading,
    port_of_delivery,
    sea_pol,
    sea_pod,
    air_origin,
    air_dest,

    $stageSelect
  FROM operations_file_master
  WHERE operations_file_reference = ?
  LIMIT 1
";

$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $ref);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row) jexit(['ok'=>false,'error'=>'Not found'], 404);

// 1. Build Origin/Dest Labels
$od = build_origin_destination($row);

// 2. Build Map of Completed Dates for the Calculator
$completedDates = [];
for ($i = 0; $i <= 13; $i++) {
    $dateVal = $row["m{$i}_completed_at"] ?? null;
    if ($dateVal) {
        $completedDates[$i] = $dateVal;
    }
}

// 3. Run Calculation
$calc = new MilestoneCalculator();
$timeline = null;

try {
  $timeline = $calc->calculateTimeline(
    (string)$row['service_type'],
    (string)$row['created_at'],
    (string)$row['expected_delivery_time'],
    $completedDates
  );
} catch (Throwable $e) {
  $timeline = ['meta'=>['overall_status'=>'ERROR', 'message'=>$e->getMessage()], 'schedule'=>[]];
}

// 4. Merge Data (With Name Fallback)
$milestones = [];
// Resolve Service Type key for backup template
$svcKey = strtoupper(trim((string)$row['service_type']));
$svcKey = str_replace(' ', '_', $svcKey);
if(str_contains($svcKey, 'HINTERLAND')) $svcKey = 'HINTERLAND_TRANSIT'; // Fuzzy match

$backupList = $BACKUP_TEMPLATES[$svcKey] ?? [];

for ($i=0; $i<=13; $i++) {
  $sched = $timeline['schedule'][$i] ?? [];
  
  // LOGIC: Use Calculator Name. If missing, use Backup List. If missing, use "Stage X"
  $stageName = $sched['stage_name'] ?? null;
  if (!$stageName || $stageName === "Stage $i") {
      $stageName = $backupList[$i] ?? "Stage $i";
  }

  $milestones[] = [
    'index'        => $i,
    'stage_name'   => $stageName,
    'due_at'       => $sched['due_at'] ?? null,
    'status'       => $sched['status'] ?? 'pending',
    
    // DB Data (User Inputs)
    'completed_at' => $row["m{$i}_completed_at"] ?? null,
    'location'     => $row["m{$i}_location"] ?? null,
    'reference'    => $row["m{$i}_reference"] ?? null,
    'notes'        => $row["m{$i}_notes"] ?? null,
  ];
}

jexit([
  'ok'=>true,
  'data'=>[
    'file' => [
      'operations_file_reference' => $row['operations_file_reference'],
      'client_id'                 => $row['client_id'],
      'client_name'               => $row['client_name'],
      'service_type'              => $row['service_type'],
      'operations_status'         => $row['operations_status'],
      'created_at'                => $row['created_at'],
      'expected_delivery_time'    => $row['expected_delivery_time'],
      'current_stage_index'       => (int)$row['current_stage_index'],
      
      // Route Labels (Added for Frontend)
      'origin_label'              => $od['origin_label'],
      'destination_label'         => $od['destination_label'],
      // Combine for list view "Route" column
      'route_label'               => $od['origin_label'] . ' <i class="fa-solid fa-arrow-right mx-1 text-muted" style="font-size:0.7rem"></i> ' . $od['destination_label'],
      
      'computed_status'           => $timeline['meta']['overall_status'] ?? 'OK',
      'current_stage_name'        => $timeline['meta']['current_stage_name'] ?? '',
      'is_risk'                   => $timeline['meta']['is_risk'] ?? false,
      'is_delayed'                => $timeline['meta']['is_delayed'] ?? false,
      'anchor_met'                => $timeline['meta']['anchor_met'] ?? false,
    ],
    'timeline' => [
      'meta'       => $timeline['meta'] ?? [],
      'milestones' => $milestones
    ]
  ]
]);