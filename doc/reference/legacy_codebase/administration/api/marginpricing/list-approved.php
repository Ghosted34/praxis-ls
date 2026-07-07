<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','MANAGEMENT','SALES','FINANCE','OPERATIONS']);
header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$limit = (int)($_GET['limit'] ?? 200);
if ($limit < 1 || $limit > 500) $limit = 200;

$sql = "
  SELECT
    cm.costing_id,
    cm.costing_ref,
    cm.operations_file_reference,
    cm.client_id,
    cm.client_name_cached,
    cm.costing_date,
    cm.total_ttc
  FROM costing_master cm
  WHERE cm.status = 'APPROVED'
  ORDER BY cm.costing_date DESC, cm.created_at DESC
  LIMIT ?
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $limit);
$stmt->execute();

$items = [];
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
  $items[] = $row;
}

echo json_encode(['ok' => true, 'items' => $items], JSON_UNESCAPED_UNICODE);
