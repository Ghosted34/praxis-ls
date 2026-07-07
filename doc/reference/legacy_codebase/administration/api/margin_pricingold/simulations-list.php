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

$q = trim((string)($_GET['q'] ?? ''));
$status = strtoupper(trim((string)($_GET['status'] ?? ''))); // optional
$limit = (int)($_GET['limit'] ?? 100);
if ($limit < 1) $limit = 100;
if ($limit > 300) $limit = 300;

$sql = "
  SELECT
    s.id,
    s.simulation_ref,
    s.costing_id,
    s.costing_ref,
    s.operations_file_reference,
    s.client_name_cached,
    s.total_cost,
    s.total_revenue,
    s.total_margin,
    s.margin_pct,
    s.status,
    s.created_at,
    s.submitted_at,
    s.approved_at,
    s.rejected_at
  FROM marginpricing_simulations s
  WHERE 1=1
";

$params = [];
$types  = "";

if ($status !== '' && $status !== 'ALL') {
  $sql .= " AND s.status = ?";
  $params[] = $status;
  $types   .= "s";
}

if ($q !== '') {
  $sql .= " AND (
    s.simulation_ref LIKE CONCAT('%', ?, '%')
    OR s.costing_ref LIKE CONCAT('%', ?, '%')
    OR s.operations_file_reference LIKE CONCAT('%', ?, '%')
    OR s.client_name_cached LIKE CONCAT('%', ?, '%')
  )";
  $params[] = $q; $params[] = $q; $params[] = $q; $params[] = $q;
  $types   .= "ssss";
}

$sql .= " ORDER BY s.created_at DESC LIMIT {$limit}";

$stmt = $conn->prepare($sql);
if ($types !== "") {
  $stmt->bind_param($types, ...$params);
}
$stmt->execute();

$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

echo json_encode(['ok' => true, 'items' => $rows]);
