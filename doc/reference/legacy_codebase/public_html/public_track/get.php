<?php
declare(strict_types=1);

require_once __DIR__ . '../../config/db.php';
require_once __DIR__ . '/MilestoneCalculator.php';

header('Content-Type: application/json; charset=utf-8');

function jexit(array $p, int $code = 200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

/**
 * Public tracking is read-only and must not expose sensitive internals.
 * We only return:
 * - file reference, client label, service type, computed status
 * - expected delivery time, created date
 * - current stage index/name
 * - milestones (stage_name/due_at/completed_at + optional location/reference/notes)
 */
$ref = trim((string)($_GET['ref'] ?? ''));
if ($ref === '') jexit(['ok' => false, 'error' => 'Missing ref'], 400);

// Optional: lightweight format guard (adjust to your real refs)
// If you do not want strict validation, remove this block.
if (!preg_match('/^[A-Z0-9\-]{5,50}$/i', $ref)) {
  jexit(['ok' => false, 'error' => 'Invalid reference format'], 400);
}

$conn = db();

// Build milestone columns m0..m13
$stageCols = [];
for ($i = 0; $i <= 13; $i++) {
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

    -- origin/destination candidates (use the ones you actually store)
    port_of_loading,
    port_of_delivery,
    place_receipt,   -- Added for Hinterland
    place_delivery,  -- Added for Hinterland
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

if (!$row) {
  jexit(['ok' => false, 'error' => 'Reference not found'], 404);
}
function label_or_dash(?string $v): string {
  $v = trim((string)$v);
  return $v !== '' ? $v : '—';
}

function build_origin_destination(array $r): array {
  $service = strtoupper(trim((string)($r['service_type'] ?? '')));

  $pol = trim((string)($r['port_of_loading'] ?? ''));
  $pod = trim((string)($r['port_of_delivery'] ?? ''));
  
  // LOGIC FIX: Map correctly to DB columns 'place_receipt' and 'place_delivery'
  $place_r = trim((string)($r['place_receipt'] ?? ''));
  $place_d = trim((string)($r['place_delivery'] ?? ''));
  
  $sea_pol = trim((string)($r['sea_pol'] ?? ''));
  $sea_pod = trim((string)($r['sea_pod'] ?? ''));
  $air_o = trim((string)($r['air_origin'] ?? ''));
  $air_d = trim((string)($r['air_dest'] ?? ''));

  // AIR
  if (str_contains($service, 'AIR')) {
    return [
      'origin_label' => label_or_dash($air_o),
      'destination_label' => label_or_dash($air_d),
    ];
  }

  // SEA
  if (str_contains($service, 'SEA')) {
    $o = $pol !== '' ? $pol : $sea_pol;
    $d = $pod !== '' ? $pod : $sea_pod;
    return [
      'origin_label' => label_or_dash($o),
      'destination_label' => label_or_dash($d),
    ];
  }

  // INLAND / HINTERLAND fallback
  // LOGIC FIX: Prioritize Place Receipt/Delivery, fallback to Port Loading/Delivery
  $o = $place_r !== '' ? $place_r : $pol;
  $d = $place_d !== '' ? $place_d : $pod;

  return [
    'origin_label' => label_or_dash($o),
    'destination_label' => label_or_dash($d),
  ];
}

$od = build_origin_destination($row);


// Compute timeline via same calculator used in Ops UI
$calc = new MilestoneCalculator();
try {
  $timeline = $calc->calculateTimeline(
    (string)$row['service_type'],
    (string)$row['created_at'],
    (string)$row['expected_delivery_time'],
    (int)$row['current_stage_index']
  );
} catch (Throwable $e) {
  $timeline = ['meta' => ['overall_status' => 'ERROR'], 'schedule' => []];
}

// Compute a reasonable "last update" for the public UI
$lastUpdate = (string)($row['current_stage_updated_at'] ?? '');
for ($i = 0; $i <= 13; $i++) {
  $c = (string)($row["m{$i}_completed_at"] ?? '');
  if ($c !== '' && ($lastUpdate === '' || $c > $lastUpdate)) $lastUpdate = $c;
}

// Build milestones payload
$milestones = [];
for ($i = 0; $i <= 13; $i++) {
  $milestones[] = [
    'index'        => $i,
    'stage_name'   => $timeline['schedule'][$i]['stage_name'] ?? "Stage " . ($i + 1),
    'due_at'       => $timeline['schedule'][$i]['due_at'] ?? null,
    'completed_at' => $row["m{$i}_completed_at"] ?? null,
    'location'     => $row["m{$i}_location"] ?? null,
    'reference'    => $row["m{$i}_reference"] ?? null,
    'notes'        => $row["m{$i}_notes"] ?? null,
  ];
}

// Public-safe “client display”
$clientLabel = (string)($row['client_name'] ?? '');
if ($clientLabel === '') $clientLabel = (string)($row['client_id'] ?? '');

// Output
jexit([
  'ok' => true,
  'data' => [
    'file' => [
  'operations_file_reference' => (string)$row['operations_file_reference'],
  'client_label'              => $clientLabel,
  'service_type'              => (string)$row['service_type'],
  'operations_status'         => (string)$row['operations_status'],
  'created_at'                => (string)$row['created_at'],
  'expected_delivery_time'    => (string)$row['expected_delivery_time'],
  'current_stage_index'       => (int)$row['current_stage_index'],
  'computed_status'           => (string)($timeline['meta']['overall_status'] ?? 'OK'),
  'current_stage_name'        => (string)($timeline['meta']['current_stage'] ?? ''),
  'last_update'               => $lastUpdate,

  // NEW: what frontend expects
  'origin_label'              => $od['origin_label'],
  'destination_label'         => $od['destination_label'],
],

    'timeline' => [
      'milestones' => $milestones
    ]
  ]
]);