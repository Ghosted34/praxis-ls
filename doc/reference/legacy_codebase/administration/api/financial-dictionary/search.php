<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','MANAGEMENT','SALES','FINANCE','OPERATIONS']);
header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$q = trim((string)($_GET['q'] ?? ''));
$limit = (int)($_GET['limit'] ?? 25);
if ($limit < 1 || $limit > 100) $limit = 25;

if ($q === '') {
  echo json_encode(['ok'=>true,'items'=>[]]);
  exit;
}

// CHANGE table/columns to your real financial dictionary schema.
$sql = "
  SELECT item_code AS code, item_name_en AS name_en
  FROM financial_dictionary
  WHERE item_code LIKE CONCAT('%', ?, '%')
     OR item_name_en LIKE CONCAT('%', ?, '%')
  ORDER BY item_name_en ASC
  LIMIT ?
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('ssi', $q, $q, $limit);
$stmt->execute();

$items = [];
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) $items[] = $row;

echo json_encode(['ok'=>true,'items'=>$items], JSON_UNESCAPED_UNICODE);
