<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','FINANCE', 'OPERATIONS', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  http_response_code(405);
  echo json_encode(['ok'=>false,'message'=>'Method not allowed']);
  exit;
}

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);


$body = json_decode(file_get_contents('php://input'), true) ?: [];
$ocrId = trim((string)($body['ocr_id'] ?? ''));

if ($ocrId === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => 'ocr_id is required']);
  exit;
}

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);

$conn->begin_transaction();
try {
  // 1. Fetch current status AND the total actual amount to sync it
  $st = $conn->prepare("
    SELECT status, operations_file_reference, total_actual_ttc
    FROM ocr_master
    WHERE ocr_id=? LIMIT 1
  ");
  $st->bind_param('s', $ocrId);
  $st->execute();
  $row = $st->get_result()->fetch_assoc();
  if (!$row) throw new Exception('OCR not found');

  if (strtoupper((string)$row['status']) !== 'SUBMITTED') {
      throw new Exception('Only SUBMITTED OCR can be validated');
  }

  $opsRef = (string)$row['operations_file_reference'];
  $totalActual = (float)($row['total_actual_ttc'] ?? 0);

  // 2. Mark OCR as Validated in OCR Master
  $up = $conn->prepare("
    UPDATE ocr_master
    SET status='VALIDATED', validated_by_user_id=?, validated_at=NOW(), updated_at=NOW()
    WHERE ocr_id=? LIMIT 1
  ");
  $up->bind_param('is', $userId, $ocrId);
  $up->execute();

  // ---------------------------------------------------------------------------
  // <--- CRITICAL UPDATE: SYNC TO OPERATIONS FILE MASTER --->
  // Finalize the link. This sets the status to VALIDATED and confirms the final Amount.
  // ---------------------------------------------------------------------------
  $stmtOps = $conn->prepare("
    UPDATE operations_file_master
    SET 
        ocr_id = ?, 
        ocr_amount = ?, 
        ocr_status = 'VALIDATED', 
        ocr_linked_at = NOW()
    WHERE operations_file_reference = ?
    LIMIT 1
  ");
  // Bind: s (ocr_id), d (amount), s (file_ref)
  $stmtOps->bind_param('sds', $ocrId, $totalActual, $opsRef);
  $stmtOps->execute();
  // ---------------------------------------------------------------------------

  $conn->commit();
  echo json_encode(['ok' => true]);

} catch (Throwable $e) {
  try { $conn->rollback(); } catch (Throwable $_) {}
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => $e->getMessage()]);
}