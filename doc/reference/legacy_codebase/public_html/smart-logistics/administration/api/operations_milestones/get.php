<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/../../includes/MilestoneCalculator.php';

require_role(['ADMIN','OPERATIONS','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

$ref = trim((string)($_GET['ref'] ?? ''));
if ($ref === '') jexit(['ok'=>false,'error'=>'Missing ref'], 400);

$conn = db();

/**
 * We need the stage fields from DB.
 * Since they are columns, select them explicitly.
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
    client_bill_to,
    service_type,
    operations_status,
    created_at,
    expected_delivery_time,
    current_stage_index,
    current_stage_updated_at,
    current_stage_updated_by_user_id,
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

$calc = new MilestoneCalculator();
$timeline = null;

try {
  $timeline = $calc->calculateTimeline(
    (string)$row['service_type'],
    (string)$row['created_at'],
    (string)$row['expected_delivery_time'],
    (int)$row['current_stage_index']
  );
} catch (Throwable $e) {
  $timeline = ['meta'=>['overall_status'=>'ERROR'], 'schedule'=>[]];
}

$milestones = [];
for ($i=0; $i<=13; $i++) {
  $milestones[] = [
    'index'        => $i,
    'stage_name'   => $timeline['schedule'][$i]['stage_name'] ?? "Stage $i",
    'due_at'       => $timeline['schedule'][$i]['due_at'] ?? null,
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
      'client_bill_to'            => $row['client_bill_to'],
      'service_type'              => $row['service_type'],
      'operations_status'         => $row['operations_status'],
      'created_at'                => $row['created_at'],
      'expected_delivery_time'    => $row['expected_delivery_time'],
      'current_stage_index'       => (int)$row['current_stage_index'],
      'computed_status'           => $timeline['meta']['overall_status'] ?? 'OK',
    ],
    'timeline' => [
      'meta'       => $timeline['meta'] ?? [],
      'milestones' => $milestones
    ]
  ]
]);
