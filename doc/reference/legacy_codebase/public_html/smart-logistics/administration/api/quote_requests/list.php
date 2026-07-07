<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

$q = trim((string)($_GET['q'] ?? ''));
$status = trim((string)($_GET['status'] ?? ''));
$category = trim((string)($_GET['category'] ?? ''));
$page = max(1, (int)($_GET['page'] ?? 1));
$pageSize = min(50, max(5, (int)($_GET['pageSize'] ?? 10)));
$offset = ($page - 1) * $pageSize;

$where = "1=1";
$types = "";
$params = [];

if ($q !== '') {
  $where .= " AND (
    public_quote_ref LIKE CONCAT('%', ?, '%')
    OR requester_name LIKE CONCAT('%', ?, '%')
    OR requester_email LIKE CONCAT('%', ?, '%')
    OR requester_company LIKE CONCAT('%', ?, '%')
    OR origin_location LIKE CONCAT('%', ?, '%')
    OR destination_location LIKE CONCAT('%', ?, '%')
    OR cargo_description LIKE CONCAT('%', ?, '%')
  )";
  $types .= "sssssss";
  array_push($params, $q, $q, $q, $q, $q, $q, $q);
}

if ($status !== '') {
  $where .= " AND status = ?";
  $types .= "s";
  $params[] = $status;
}

if ($category !== '') {
  $where .= " AND service_category = ?";
  $types .= "s";
  $params[] = $category;
}

$countSql = "SELECT COUNT(*) AS c FROM quote_requests WHERE $where";
$countStmt = $conn->prepare($countSql);
if ($types) $countStmt->bind_param($types, ...$params);
$countStmt->execute();
$total = (int)($countStmt->get_result()->fetch_assoc()['c'] ?? 0);

$sql = "
  SELECT
    quote_request_id,
    public_quote_ref,
    intake_channel,
    requester_name,
    requester_email,
    requester_company,
    service_category,
    service_type,
    origin_location,
    destination_location,
    warehouse_location,
    estimated_weight,
    status,
    submission_datetime,
    converted_opportunity_id
  FROM quote_requests
  WHERE $where
  ORDER BY submission_datetime DESC
  LIMIT ? OFFSET ?
";
$stmt = $conn->prepare($sql);

$types2 = $types . "ii";
$params2 = $params;
$params2[] = $pageSize;
$params2[] = $offset;

$stmt->bind_param($types2, ...$params2);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

echo json_encode([
  'ok' => true,
  'page' => $page,
  'pageSize' => $pageSize,
  'total' => $total,
  'rows' => $rows
], JSON_UNESCAPED_SLASHES);
