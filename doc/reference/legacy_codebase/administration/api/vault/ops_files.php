<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit($p, int $code=200): void { http_response_code($code); echo json_encode($p); exit; }

$limit = (int)($_GET['limit'] ?? 200);
if ($limit <= 0 || $limit > 1000) $limit = 200;

$sql = "
  SELECT operations_file_reference, client_id, service_type, operations_status, created_at
  FROM operations_file_master
  ORDER BY created_at DESC
  LIMIT ?
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $limit);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

jexit(['ok'=>true, 'data'=>$rows]);
