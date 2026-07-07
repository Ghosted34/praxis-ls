<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']);

$conn = db();

$q = trim((string)($_GET['q'] ?? ''));
$limit = min(50, max(5, (int)($_GET['limit'] ?? 25)));

$where = "1=1";
$types = "";
$params = [];

if ($q !== '') {
  $where .= " AND (ofm.operations_file_reference LIKE CONCAT('%', ?, '%')
               OR cm.client_name LIKE CONCAT('%', ?, '%'))";
  $types .= "ss";
  $params[] = $q;
  $params[] = $q;
}

$sql = "
  SELECT
    ofm.operations_file_reference,
    ofm.client_id,
    cm.client_name,
    ofm.service_type,
    ofm.operations_status,
    ofm.created_at
  FROM operations_file_master ofm
  JOIN client_master cm ON cm.client_id = ofm.client_id
  WHERE {$where}
  ORDER BY ofm.created_at DESC
  LIMIT {$limit}
";

$stmt = $conn->prepare($sql);
if ($types !== '') {
  $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$items = array_map(function($r){
  return [
    'operations_file_reference' => $r['operations_file_reference'],
    'client_id' => $r['client_id'],
    'client_name' => $r['client_name'],
    'service_type' => $r['service_type'],
    'service_label' => service_label((string)$r['service_type']),
    'operations_status' => $r['operations_status'],
  ];
}, $rows);

json_out(['ok' => true, 'items' => $items]);
