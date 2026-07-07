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

function route_label(array $r): string {
  $service = strtoupper(trim((string)($r['service_type'] ?? '')));

  $pol = trim((string)($r['port_of_loading'] ?? ''));
  $pod = trim((string)($r['port_of_delivery'] ?? ''));
  $por = trim((string)($r['place_receipt'] ?? ''));
  $pde = trim((string)($r['place_delivery'] ?? ''));
  $sea_pol = trim((string)($r['sea_pol'] ?? ''));
  $sea_pod = trim((string)($r['sea_pod'] ?? ''));
  $air_o = trim((string)($r['air_origin'] ?? ''));
  $air_d = trim((string)($r['air_dest'] ?? ''));
  $wh = trim((string)($r['warehouse_loc'] ?? ''));

  if (str_contains($service, 'AIR')) {
    $a = $air_o !== '' ? $air_o : '';
    $b = $air_d !== '' ? $air_d : '';
    $label = trim($a . ($a && $b ? ' → ' : '') . $b);
    return $label !== '' ? $label : '—';
  }

  if (str_contains($service, 'SEA')) {
    $a = $pol !== '' ? $pol : $sea_pol;
    $b = $pod !== '' ? $pod : $sea_pod;
    $label = trim($a . ($a && $b ? ' → ' : '') . $b);
    return $label !== '' ? $label : '—';
  }

  if (str_contains($service, 'WARE')) {
    return $wh !== '' ? $wh : '—';
  }

  $label = trim($por . ($por && $pde ? ' → ' : '') . $pde);
  return $label !== '' ? $label : '—';
}

$conn = db();

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

    port_of_loading,
    port_of_delivery,
    place_receipt,
    place_delivery,
    sea_pol,
    sea_pod,
    air_origin,
    air_dest
  FROM operations_file_master
  WHERE operations_status IN ('OPEN','IN_PROGRESS','OPERATIONALLY_COMPLETED','FINANCIALLY_PENDING','CLOSED')
  ORDER BY created_at DESC
  LIMIT 500
";


$res = $conn->query($sql);
if (!$res) jexit(['ok'=>false,'error'=>'DB query failed'], 500);

$calc = new MilestoneCalculator();
$rows = [];

while ($r = $res->fetch_assoc()) {
  $service = (string)$r['service_type'];
  $created = (string)$r['created_at'];
  $due     = (string)$r['expected_delivery_time'];
  $idx     = (int)($r['current_stage_index'] ?? 0);

  $routeLabel = route_label($r);

  $status = 'ERROR';
  $isRisk = false;
  $isDelayed = false;
  $currentStageName = '';
  $currentStageDueAt = null;

  if ($due !== '' && $created !== '' && $service !== '') {
    try {
      $timeline = $calc->calculateTimeline($service, $created, $due, $idx);
      $status = $timeline['meta']['overall_status'] ?? 'OK';
      $isRisk = (bool)($timeline['meta']['is_risk'] ?? false);
      $isDelayed = (bool)($timeline['meta']['is_delayed'] ?? false);
      $currentStageName = (string)($timeline['meta']['current_stage'] ?? '');
      $currentStageDueAt = $timeline['schedule'][$idx]['due_at'] ?? null;
    } catch (Throwable $e) {
      $status = 'ERROR';
    }
  }
  

  $rows[] = [
    'operations_file_reference' => $r['operations_file_reference'],
    'client_bill_to'            => $r['client_bill_to'],
    'client_id'                 => $r['client_id'],
    'service_type'              => $service,
    'route_label'               => $routeLabel,

    'operations_status'         => $r['operations_status'],
    'created_at'                => $created,
    'expected_delivery_time'    => $due,
    'current_stage_index'       => $idx,
    'current_stage_name'        => $currentStageName,
    'current_stage_due_at'      => $currentStageDueAt,
    'computed_status'           => $status,
    'is_risk'                   => $isRisk,
    'is_delayed'                => $isDelayed
  ];
}

jexit(['ok'=>true,'data'=>$rows]);
