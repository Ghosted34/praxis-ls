<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function require_str($v, string $field): string {
  $s = trim((string)($v ?? ''));
  if ($s === '') {
    http_response_code(422);
    echo "Missing {$field}";
    exit;
  }
  return $s;
}

$docUid = require_str($_GET['doc_uid'] ?? null, 'doc_uid');

$conn = db();
@$conn->set_charset('utf8mb4');

$sql = "
  SELECT stored_path, stored_filename, original_filename, mime_type
  FROM document_vault
  WHERE doc_uid = ?
  LIMIT 1
";
$st = $conn->prepare($sql);
$st->bind_param('s', $docUid);
$st->execute();
$res = $st->get_result();
$row = $res->fetch_assoc();
$st->close();

if (!$row) {
  http_response_code(404);
  echo "Not found";
  exit;
}

// stored_path is relative like: uploads/document_vault/OPS/REF/file.ext
$baseDir = realpath(__DIR__ . '/../../') ?: (__DIR__ . '/../../');
$abs = $baseDir . '/' . ltrim((string)$row['stored_path'], '/');

if (!is_file($abs)) {
  http_response_code(404);
  echo "File missing on disk";
  exit;
}

$mime = (string)($row['mime_type'] ?? 'application/octet-stream');
$downloadName = (string)($row['original_filename'] ?: $row['stored_filename'] ?: 'document');

header('Content-Type: ' . $mime);
header('Content-Length: ' . (string)filesize($abs));

// Inline view (opens in browser/tab when possible)
header('Content-Disposition: inline; filename="' . str_replace('"', '', $downloadName) . '"');

readfile($abs);
exit;
