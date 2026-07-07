<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$ocrId = trim((string)($_GET['ocr_id'] ?? ''));
if ($ocrId === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => 'ocr_id is required']);
  exit;
}

$stmt = $conn->prepare("SELECT * FROM ocr_master WHERE ocr_id = ? LIMIT 1");
$stmt->bind_param('s', $ocrId);
$stmt->execute();
$hdr = $stmt->get_result()->fetch_assoc();
if (!$hdr) {
  http_response_code(404);
  echo json_encode(['ok' => false, 'message' => 'OCR not found']);
  exit;
}

$stmt2 = $conn->prepare("
  SELECT
    costing_line_id, line_no, item_code, item_description,
    budget_ttc, actual_ttc, doc_ref, doc_required
  FROM ocr_line
  WHERE ocr_id = ?
  ORDER BY line_no ASC
");
$stmt2->bind_param('s', $ocrId);
$stmt2->execute();
$r2 = $stmt2->get_result();

$lines = [];
while ($row = $r2->fetch_assoc()) {
  $lines[] = $row;
}

echo json_encode(['ok' => true, 'header' => $hdr, 'lines' => $lines]);
