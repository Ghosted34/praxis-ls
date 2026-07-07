<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','SALES','MANAGEMENT','FINANCE']);

header('Content-Type: application/json; charset=utf-8');

// Enforce GET without require_method()
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
  http_response_code(405);
  echo json_encode(['ok' => false, 'message' => 'Method Not Allowed']);
  exit;
}

$conn = db();

$limit = (int)($_GET['limit'] ?? 200);
if ($limit < 1) $limit = 200;
if ($limit > 500) $limit = 500;

$q = trim((string)($_GET['q'] ?? ''));

$sql = "
  SELECT
    cm.costing_id,
    cm.costing_ref,
    cm.operations_file_reference,
    cm.client_id,
    cm.client_name_cached,
    cm.service_type,
    cm.costing_date,
    cm.currency,
    cm.exchange_rate_to_xaf,
    cm.total_ttc
  FROM costing_master cm
  WHERE cm.status = 'APPROVED_LOCKED'
";

$params = [];
$types  = "";

if ($q !== '') {
  $sql .= " AND (
    cm.costing_ref LIKE CONCAT('%', ?, '%')
    OR cm.operations_file_reference LIKE CONCAT('%', ?, '%')
    OR cm.client_name_cached LIKE CONCAT('%', ?, '%')
  )";
  $params = [$q, $q, $q];
  $types  = "sss";
}

$sql .= " ORDER BY cm.costing_date DESC, cm.created_at DESC LIMIT {$limit}";

$stmt = $conn->prepare($sql);
if ($types !== "") {
  $stmt->bind_param($types, ...$params);
}
$stmt->execute();

$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

echo json_encode(['ok' => true, 'items' => $rows]);
