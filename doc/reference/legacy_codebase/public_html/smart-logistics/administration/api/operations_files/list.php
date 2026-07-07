<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

$q = trim((string)($_GET['q'] ?? ''));
$limit = (int)($_GET['limit'] ?? 200);
if ($limit <= 0 || $limit > 500) $limit = 200;

$sql = "
  SELECT
    m.operations_file_reference AS ref,
    m.client_id,
    c.client_name,
    m.service_type,
    m.service_territory,
    m.operations_status,
    m.created_at,
    m.updated_at
  FROM operations_file_master m
  LEFT JOIN client_master c ON c.client_id = m.client_id
  WHERE 1=1
";
$types = '';
$params = [];

if ($q !== '') {
  $sql .= " AND (
    m.operations_file_reference LIKE ?
    OR m.client_id LIKE ?
    OR c.client_name LIKE ?
  )";
  $like = "%{$q}%";
  $types = 'sss';
  $params = [$like, $like, $like];
}

$sql .= " ORDER BY m.created_at DESC LIMIT {$limit}";

$stmt = $conn->prepare($sql);
if ($types !== '') $stmt->bind_param($types, ...$params);
$stmt->execute();
$res = $stmt->get_result();

$rows = [];
while ($r = $res->fetch_assoc()) {
  $rows[] = [
    'ref' => $r['ref'],
    'client_id' => $r['client_id'],
    'client_name' => $r['client_name'] ?? $r['client_id'],
    'service_type' => $r['service_type'],
    'service_territory' => $r['service_territory'],
    'operations_status' => $r['operations_status'],
  ];
}

echo json_encode(['ok' => true, 'rows' => $rows]);
