<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
// allow ADMIN + others if you need later; for now keep ADMIN to match your page
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

$q = trim((string)($_GET['q'] ?? ''));
$limit = (int)($_GET['limit'] ?? 200);
if ($limit <= 0 || $limit > 500) $limit = 200;

$sql = "
  SELECT client_id, client_name, status
  FROM client_master
  WHERE status = 'ACTIVE'
";
$types = '';
$params = [];

if ($q !== '') {
  $sql .= " AND (client_id LIKE ? OR client_name LIKE ?)";
  $like = "%{$q}%";
  $types = 'ss';
  $params = [$like, $like];
}

$sql .= " ORDER BY client_name ASC LIMIT {$limit}";

$stmt = $conn->prepare($sql);
if ($types !== '') {
  $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$res = $stmt->get_result();

$rows = [];
while ($r = $res->fetch_assoc()) {
  $rows[] = [
    'client_id' => $r['client_id'],
    'client_name' => $r['client_name'],
  ];
}

echo json_encode(['ok' => true, 'rows' => $rows]);
