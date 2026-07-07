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

$conn = db();

$sql = "
  SELECT
    operations_file_reference,
    service_type,
    operations_status,
    created_at,
    expected_delivery_time,
    current_stage_index
  FROM operations_file_master
  WHERE operations_status IN ('OPEN','IN_PROGRESS','OPERATIONALLY_COMPLETED','FINANCIALLY_PENDING','CLOSED')
    AND expected_delivery_time IS NOT NULL
    AND created_at IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 2000
";


$res = $conn->query($sql);
if (!$res) jexit(['ok'=>false,'error'=>'DB query failed'], 500);

$calc = new MilestoneCalculator();

$today = date('Y-m-d');

$totalActive = 0;
$completed = 0;
$dueToday = 0;
$atRisk = 0;

while ($r = $res->fetch_assoc()) {
  $service = (string)$r['service_type'];
  $created = (string)$r['created_at'];
  $due     = (string)$r['expected_delivery_time'];
  $idx     = (int)($r['current_stage_index'] ?? 0);
  $opsStatus = (string)$r['operations_status'];

  $isCompleted = ($idx >= 13) || in_array($opsStatus, ['OPERATIONAL_COMPLETE','CLOSED'], true);

  if ($isCompleted) {
    $completed++;
    continue;
  }

  if (in_array($opsStatus, ['OPEN','IN_PROGRESS'], true)) {
    $totalActive++;
  }

  try {
    $timeline = $calc->calculateTimeline($service, $created, $due, $idx);
    $computed = (string)($timeline['meta']['overall_status'] ?? 'OK');
    $stageDueAt = $timeline['schedule'][$idx]['due_at'] ?? null;

    if ($stageDueAt && substr((string)$stageDueAt, 0, 10) === $today) {
      $dueToday++;
    }

    if (in_array($computed, ['RISK','DELAYED'], true)) {
      $atRisk++;
    }

  } catch (Throwable $e) {
    // ignore errors; do not count
  }
}

jexit([
  'ok'=>true,
  'data'=>[
    'total_active' => $totalActive,
    'due_today'    => $dueToday,
    'at_risk'      => $atRisk,
    'completed'    => $completed
  ]
]);
