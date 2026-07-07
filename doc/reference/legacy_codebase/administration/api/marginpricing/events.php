<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','MANAGEMENT','SALES','FINANCE','OPERATIONS']);
header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$simId = (int)($_GET['id'] ?? 0);
if ($simId <= 0) {
  http_response_code(400);
  echo json_encode(['ok'=>false,'error'=>'id required']);
  exit;
}

$sql = "
  SELECT *
  FROM marginpricing_simulation_events
  WHERE marginpricing_simulation_id = ?
  ORDER BY created_at DESC
  LIMIT 200
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $simId);
$stmt->execute();

$items = [];
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) $items[] = $row;

echo json_encode(['ok'=>true,'items'=>$items], JSON_UNESCAPED_UNICODE);
