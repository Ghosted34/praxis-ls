<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

$id = trim((string)($_GET['id'] ?? ''));
if ($id === '') {
  http_response_code(400);
  echo json_encode(['ok'=>false,'error'=>'Missing id']);
  exit;
}

$stmt = $conn->prepare("SELECT * FROM quote_requests WHERE quote_request_id = ? LIMIT 1");
if (!$stmt) {
  http_response_code(500);
  echo json_encode(['ok'=>false,'error'=>'Prepare failed: '.$conn->error]);
  exit;
}

$stmt->bind_param('s', $id);
$stmt->execute();
$rec = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$rec) {
  http_response_code(404);
  echo json_encode(['ok'=>false,'error'=>'Not found']);
  exit;
}

/**
 * Single-table attachments payload (supports 0 or 1 attachment)
 * NOTE: requires these columns on quote_requests:
 * - attachment_original_name
 * - attachment_stored_name
 * - attachment_stored_path
 * - attachment_mime_type
 * - attachment_file_size
 * - attachment_uploaded_at
 */
$attachments = [];
if (!empty($rec['attachment_stored_name'])) {
  $attachments[] = [
    'id'            => null, // kept for frontend compatibility
    'original_name' => $rec['attachment_original_name'] ?? '',
    'stored_name'   => $rec['attachment_stored_name'] ?? '',
    'stored_path'   => $rec['attachment_stored_path'] ?? '',
    'mime_type'     => $rec['attachment_mime_type'] ?? '',
    'file_size'     => isset($rec['attachment_file_size']) ? (int)$rec['attachment_file_size'] : null,
    'uploaded_at'   => $rec['attachment_uploaded_at'] ?? null,
  ];
    // Build a public URL (do NOT trust stored_path for public linking)
  $publicBase = '/administration/upload/quotes_request/';
  $attachments[0]['url'] = $publicBase . rawurlencode((string)$attachments[0]['stored_name']);

}

echo json_encode(['ok'=>true,'record'=>$rec,'attachments'=>$attachments], JSON_UNESCAPED_SLASHES);
exit;
