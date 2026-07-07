<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$sql = "
  SELECT
    ocr_id,
    operations_file_reference,
    client_name_cached,
    service_type,
    costing_ref,
    status,
    total_budget_ttc,
    total_actual_ttc,
    updated_at,
    created_at
  FROM ocr_master
  ORDER BY updated_at DESC
  LIMIT 500
";
$res = $conn->query($sql);

$items = [];
while ($row = $res->fetch_assoc()) {
  $items[] = $row;
}
echo json_encode(['ok' => true, 'items' => $items]);
