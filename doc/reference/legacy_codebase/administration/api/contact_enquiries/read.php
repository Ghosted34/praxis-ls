<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$id = trim((string)($_GET['id'] ?? ''));

if ($id === '') {
  http_response_code(400);
  echo json_encode(['ok'=>false, 'error'=>'Missing id']);
  exit;
}

$sql = "
  SELECT
    enquiry_id,
    full_name,
    company_name,
    email,
    phone,
    enquiry_type,
    message,
    status,
    internal_notes,
    submission_datetime
  FROM contact_enquiries
  WHERE enquiry_id = ?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row) {
  http_response_code(404);
  echo json_encode(['ok'=>false, 'error'=>'Not found']);
  exit;
}

echo json_encode(['ok'=>true, 'row'=>$row], JSON_UNESCAPED_SLASHES);
