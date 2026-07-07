<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','FINANCE']);
require_method('POST');

header('Content-Type: application/json; charset=utf-8');
$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$ocrId = trim((string)($body['ocr_id'] ?? ''));
$reason = trim((string)($body['reason'] ?? ''));

if ($ocrId === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => 'ocr_id is required']);
  exit;
}

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);

$conn->begin_transaction();
try {
  $st = $conn->prepare("SELECT status FROM ocr_master WHERE ocr_id=? LIMIT 1");
  $st->bind_param('s', $ocrId);
  $st->execute();
  $row = $st->get_result()->fetch_assoc();
  if (!$row) throw new Exception('OCR not found');

  if (strtoupper((string)$row['status']) !== 'SUBMITTED') throw new Exception('Only SUBMITTED OCR can be rejected');

  $up = $conn->prepare("
    UPDATE ocr_master
    SET status='REJECTED', rejected_by_user_id=?, rejected_at=NOW(), reject_reason=?, updated_at=NOW()
    WHERE ocr_id=? LIMIT 1
  ");
  $up->bind_param('iss', $userId, $reason, $ocrId);
  $up->execute();

  $conn->commit();
  echo json_encode(['ok' => true]);

} catch (Throwable $e) {
  $conn->rollback();
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => $e->getMessage()]);
}
