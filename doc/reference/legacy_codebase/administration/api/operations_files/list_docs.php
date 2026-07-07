<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => $ok], $extra), JSON_UNESCAPED_SLASHES);
  exit;
}

function require_str($v, string $field): string {
  $s = trim((string)($v ?? ''));
  if ($s === '') out(false, ['error' => "Missing required field: {$field}"], 422);
  return $s;
}

try {
  $ref = require_str($_GET['ref'] ?? null, 'ref');

  $conn = db();
  @$conn->set_charset('utf8mb4');

  $sql = "
    SELECT 
      doc_id, 
      doc_uuid, 
      doc_type, 
      pr_linked_id, 
      version_no, 
      user_filename, 
      storage_path, 
      file_mime, 
      file_size, 
      uploaded_at, 
      status, 
      physical_location 
    FROM document_vault_master
    WHERE file_context = 'OPS'
      AND folder_ref = ?
      AND (status IS NULL OR status <> 'ARCHIVED')
    ORDER BY uploaded_at DESC, version_no DESC
  ";

  $st = $conn->prepare($sql);
  $st->bind_param('s', $ref);
  $st->execute();

  $st->bind_result(
    $doc_id, 
    $doc_uuid, 
    $doc_type, 
    $pr_linked_id, 
    $version_no, 
    $user_filename, 
    $storage_path, 
    $file_mime, 
    $file_size, 
    $uploaded_at, 
    $status, 
    $physical_location
  );

  $rows = [];
  while ($st->fetch()) {
    // Generate the view URL (keeping your secure serve logic)
    $viewUrl = "../../api/vault/serve.php?doc_uuid=" . urlencode((string)$doc_uuid);

    $rows[] = [
      'doc_id' => (int)$doc_id,
      'doc_uuid' => (string)$doc_uuid,
      
      // --- THE FIX: Map your DB column to what JS expects ---
      'name' => (string)$user_filename,              // For JS: d.name
      'original_filename' => (string)$user_filename, // For JS: d.original_filename
      'view_url' => $viewUrl,                        // For JS: d.view_url
      'url' => $viewUrl,                             // For JS: d.url
      // -----------------------------------------------------

      'doc_type' => $doc_type,
      'version_no' => (int)($version_no ?? 1),
      'file_mime' => (string)$file_mime,
      'uploaded_at' => (string)($uploaded_at ?? ''),
    ];
  }

  $st->close();

  out(true, ['rows' => $rows]);

} catch (Throwable $e) {
  error_log('list_docs error: ' . $e->getMessage());
  out(false, ['error' => 'Server error', 'detail' => $e->getMessage()], 500);
}