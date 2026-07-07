<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? null);

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$id = trim((string)($body['quote_request_id'] ?? ''));
if ($id === '') { http_response_code(400); echo json_encode(['ok'=>false,'error'=>'Missing id']); exit; }

// Generate an OPP id (adjust format to your enterprise standard)
$opp = 'OPP-' . date('Y') . '-' . str_pad((string)random_int(1, 999999), 6, '0', STR_PAD_LEFT);

// Only set if currently NULL
$stmt = $conn->prepare("
  UPDATE quote_requests
  SET converted_opportunity_id = COALESCE(converted_opportunity_id, ?),
      status = 'CONVERTED_TO_OPPORTUNITY',
      updated_by_employee_id = ?
  WHERE quote_request_id = ?
  LIMIT 1
");
$stmt->bind_param('sss', $opp, $employeeId, $id);
$stmt->execute();

echo json_encode(['ok'=>true,'converted_opportunity_id'=>$opp], JSON_UNESCAPED_SLASHES);
