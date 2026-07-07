<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','OPERATIONS']);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  http_response_code(405);
  echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
  exit;
}


header('Content-Type: application/json; charset=utf-8');
$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
$ocrId = trim((string)($body['ocr_id'] ?? ''));

if ($ocrId === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => 'ocr_id is required']);
  exit;
}

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);

$conn->begin_transaction();
try {
  // must exist & editable
  $st = $conn->prepare("SELECT status FROM ocr_master WHERE ocr_id=? LIMIT 1");
  $st->bind_param('s', $ocrId);
  $st->execute();
  $row = $st->get_result()->fetch_assoc();
  if (!$row) throw new Exception('OCR not found');

  $status = strtoupper((string)$row['status']);
  if (!in_array($status, ['DRAFT','REJECTED'], true)) throw new Exception('OCR not in a submittable state');

  // enforce doc-required if present
  $q = $conn->prepare("
    SELECT COUNT(*) AS missing
    FROM ocr_line
    WHERE ocr_id=?
      AND doc_required=1
      AND actual_ttc > 0
      AND (doc_ref IS NULL OR TRIM(doc_ref) = '')
  ");
  $q->bind_param('s', $ocrId);
  $q->execute();
  $missing = (int)($q->get_result()->fetch_assoc()['missing'] ?? 0);
  if ($missing > 0) throw new Exception('Submission blocked: some lines require a Document Reference');

  $up = $conn->prepare("
    UPDATE ocr_master
    SET status='SUBMITTED', submitted_by_user_id=?, submitted_at=NOW(), updated_at=NOW()
    WHERE ocr_id=? LIMIT 1
  ");
  $up->bind_param('is', $userId, $ocrId);
  $up->execute();

  $conn->commit();
  echo json_encode(['ok' => true]);

} catch (Throwable $e) {
  $conn->rollback();
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => $e->getMessage()]);
}
