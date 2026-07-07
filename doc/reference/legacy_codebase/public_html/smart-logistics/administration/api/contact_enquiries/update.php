<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

$raw = file_get_contents('php://input');
$in  = json_decode($raw ?: '{}', true);

$id = trim((string)($in['enquiry_id'] ?? ''));
$status = strtoupper(trim((string)($in['status'] ?? '')));
$notes = (string)($in['internal_notes'] ?? '');

$allowed = ['NEW','READ','RESPONDED','CLOSED'];
if ($id === '' || !in_array($status, $allowed, true)) {
  http_response_code(400);
  echo json_encode(['ok'=>false, 'error'=>'Invalid payload']);
  exit;
}

// NOTES: allow empty, but cap size
if (mb_strlen($notes) > 5000) {
  http_response_code(400);
  echo json_encode(['ok'=>false, 'error'=>'Notes too long']);
  exit;
}

$sql = "
  UPDATE contact_enquiries
  SET status = ?, internal_notes = ?
  WHERE enquiry_id = ?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('sss', $status, $notes, $id);
$stmt->execute();

if ($stmt->affected_rows < 0) {
  http_response_code(500);
  echo json_encode(['ok'=>false, 'error'=>'Update failed']);
  exit;
}

echo json_encode(['ok'=>true], JSON_UNESCAPED_SLASHES);
