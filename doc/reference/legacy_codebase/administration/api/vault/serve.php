<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

if (session_status() === PHP_SESSION_NONE) session_start();

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function die_http(int $code, string $msg): void {
  http_response_code($code);
  header('Content-Type: text/plain; charset=utf-8');
  echo $msg;
  exit;
}

function require_str($v, string $field): string {
  $s = trim((string)($v ?? ''));
  if ($s === '') die_http(422, "Missing required field: {$field}");
  return $s;
}

try {
  $docUuid = require_str($_GET['doc_uuid'] ?? null, 'doc_uuid');

  $conn = db();
  @$conn->set_charset('utf8mb4');

  $sql = "
    SELECT storage_path, file_mime, user_filename
    FROM document_vault_master
    WHERE doc_uuid = ?
      AND (status IS NULL OR status <> 'ARCHIVED')
    LIMIT 1
  ";
  $st = $conn->prepare($sql);
  $st->bind_param('s', $docUuid);
  $st->execute();
  $st->bind_result($storagePath, $fileMime, $userFilename);
  $ok = $st->fetch();
  $st->close();

  if (!$ok) die_http(404, 'Document not found');

  $storagePath = (string)$storagePath; // e.g. uploads/document_vault/OPS/SLxxxx/file.ext

  // =========================
  // Resolve absolute file path
  // =========================
  // __DIR__ is .../administration/api/document_vault
  $adminRoot   = realpath(__DIR__ . '/../../') ?: (__DIR__ . '/../../');   // .../administration
  $projectRoot = realpath(__DIR__ . '/../../../') ?: (__DIR__ . '/../../../'); // .../ (project root)

  // Primary: project root + storage_path
  $cand1 = realpath($projectRoot . '/' . ltrim($storagePath, '/\\'));

  // Fallback: admin root + storage_path (legacy uploads saved under /administration/uploads/...)
  $cand2 = realpath($adminRoot . '/' . ltrim($storagePath, '/\\'));

  $absPath = null;
  if ($cand1 && is_file($cand1)) {
    $absPath = $cand1;
  } elseif ($cand2 && is_file($cand2)) {
    $absPath = $cand2;
  }

  if (!$absPath) die_http(404, 'File missing on disk');

  // =========================
  // Safety: allow only under uploads roots
  // =========================
  $uploadsRoot1 = realpath($projectRoot . '/uploads');
  $uploadsRoot2 = realpath($adminRoot . '/uploads');

  $ok1 = ($uploadsRoot1 && strpos($absPath, $uploadsRoot1) === 0);
  $ok2 = ($uploadsRoot2 && strpos($absPath, $uploadsRoot2) === 0);

  if (!$ok1 && !$ok2) die_http(403, 'Forbidden');

  // =========================
  // Stream response
  // =========================
  $mime = $fileMime ?: 'application/octet-stream';
  $name = $userFilename ?: basename($absPath);

  header('Content-Type: ' . $mime);
  header('Content-Length: ' . (string)filesize($absPath));
  header('Content-Disposition: inline; filename="' . addslashes($name) . '"');
  header('X-Content-Type-Options: nosniff');

  readfile($absPath);
  exit;

} catch (Throwable $e) {
  error_log('serve.php error: ' . $e->getMessage());
  die_http(500, 'Server error');
}
