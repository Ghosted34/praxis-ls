<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT', 'OPERATIONS', 'SALES']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

try {
  // Tune statuses as you wish
  $sql = "
    SELECT
      ofm.operations_file_reference,
      ofm.client_id,
      cm.client_name,
      ofm.service_type,
      ofm.eta,
      ofm.operations_status,
      ofm.updated_at
    FROM operations_file_master ofm
    JOIN client_master cm ON cm.client_id = ofm.client_id
    WHERE ofm.operations_status IN ('OPEN','IN_PROGRESS','OPERATIONS_COMPLETED')
    ORDER BY ofm.updated_at DESC
    LIMIT 500
  ";

  $res = $conn->query($sql);
  if (!$res) jexit(['ok'=>false,'error'=>'DB query failed'], 500);

  $items = [];
  while ($row = $res->fetch_assoc()) {
    $items[] = [
      'operations_file_reference' => $row['operations_file_reference'],
      'client_id' => $row['client_id'],
      'client_name' => $row['client_name'],
      'service_type' => $row['service_type'],
      'eta' => $row['eta'],
      'operations_status' => $row['operations_status'],
    ];
  }

  jexit(['ok'=>true,'items'=>$items]);
} catch (Throwable $e) {
  jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
}
