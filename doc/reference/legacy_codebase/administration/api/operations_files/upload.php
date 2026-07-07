<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

if (session_status() === PHP_SESSION_NONE) session_start();

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => $ok], $extra), JSON_UNESCAPED_SLASHES);
  exit;
}

function safe_basename(string $name): string {
  $name = trim($name);
  $name = str_replace(["\0", "\r", "\n"], '', $name);
  $name = basename($name);
  $name = preg_replace('/[^A-Za-z0-9.\-_ ]+/', '_', $name);
  if ($name === '' || $name === '.' || $name === '..') $name = 'file';
  return $name;
}

function ensure_dir(string $path): void {
  if (is_dir($path)) return;
  if (!mkdir($path, 0775, true) && !is_dir($path)) {
    out(false, ['error' => 'Could not create upload directory'], 500);
  }
}

function norm_str($v): ?string {
  $s = trim((string)($v ?? ''));
  return $s === '' ? null : $s;
}

function require_str($v, string $field): string {
  $s = trim((string)($v ?? ''));
  if ($s === '') out(false, ['error' => "Missing required field: {$field}"], 422);
  return $s;
}

function enum_in(array $allowed, ?string $val, string $field, string $default): string {
  $v = strtoupper(trim((string)($val ?? '')));
  if ($v === '') return $default;
  if (!in_array($v, $allowed, true)) out(false, ['error' => "Invalid {$field}"], 422);
  return $v;
}

const MAX_BYTES = 5_000_000; // 5MB
$allowedExt  = ['pdf', 'png', 'jpg', 'jpeg'];
$allowedMime = ['application/pdf', 'image/png', 'image/jpeg'];

try {
  $sessionUserId = (int)($_SESSION['auth']['user_id'] ?? 0);
  $employeeId    = norm_str($_SESSION['auth']['employee_id'] ?? null);
  if ($sessionUserId <= 0) out(false, ['error' => 'Unauthenticated'], 401);

  $opsRef = require_str($_POST['ref'] ?? null, 'ref');

  $fileContext = 'OPS';
  $docType = enum_in(
    ['INVOICE','RECEIPT','BL','POD','CUSTOMS','OTHER'],
    $_POST['doc_type'] ?? null,
    'doc_type',
    'OTHER'
  );

  $docRef           = norm_str($_POST['doc_ref'] ?? null);            // used in version grouping
  $physLocation     = norm_str($_POST['phys_location'] ?? null);
  $linkedRequestRef = norm_str($_POST['linked_request_ref'] ?? null);
  $description      = norm_str($_POST['description'] ?? null);

  if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
    out(false, ['error' => 'Missing file'], 422);
  }

  $f = $_FILES['file'];
  if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    out(false, ['error' => 'Upload error code: ' . (string)($f['error'] ?? 'unknown')], 400);
  }

  $size = (int)($f['size'] ?? 0);
  if ($size <= 0) out(false, ['error' => 'Empty file'], 400);
  if ($size > MAX_BYTES) out(false, ['error' => 'File too large. Max 5MB'], 413);

  $tmpPath = (string)($f['tmp_name'] ?? '');
  if ($tmpPath === '' || !is_uploaded_file($tmpPath)) out(false, ['error' => 'Invalid upload'], 400);

  $origName = safe_basename((string)($f['name'] ?? 'file'));
  $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
  if ($ext === '' || !in_array($ext, $allowedExt, true)) {
    out(false, ['error' => 'Invalid file type. Allowed: PDF, PNG, JPG'], 422);
  }

  $finfo = new finfo(FILEINFO_MIME_TYPE);
  $mime = $finfo->file($tmpPath);
  if (!$mime) out(false, ['error' => 'Could not detect MIME type'], 422);
  $mime = (string)$mime;

  if (!in_array($mime, $allowedMime, true)) {
    out(false, ['error' => 'Invalid MIME type'], 422);
  }

  $conn = db();
  @$conn->set_charset('utf8mb4');

  // Ensure ops ref exists
  $chk = $conn->prepare("SELECT 1 FROM operations_file_master WHERE operations_file_reference = ? LIMIT 1");
  if (!$chk) throw new RuntimeException('Prepare failed (ops check): ' . $conn->error);
  $chk->bind_param('s', $opsRef);
  $chk->execute();
  $chk->store_result();
  if ($chk->num_rows === 0) {
    $chk->close();
    out(false, ['error' => 'operations_file_reference not found'], 404);
  }
  $chk->close();

  // Compute next version for grouping:
  // group by: file_context + folder_ref + doc_type + pr_linked_id (or docRef if you prefer)
  // Here we group by (OPS + opsRef + docType + docRef stored in pr_linked_id OR docRef itself).
  // Since your schema has pr_linked_id, we will use pr_linked_id to store docRef grouping when provided.
  $groupKey = $docRef; // nullable
  $sqlV = "
    SELECT COALESCE(MAX(version_no), 0) AS v
    FROM document_vault_master
    WHERE file_context = 'OPS'
      AND folder_ref = ?
      AND ( (doc_type IS NULL AND ? IS NULL) OR doc_type = ? )
      AND ( (pr_linked_id IS NULL AND ? IS NULL) OR pr_linked_id = ? )
  ";
  $stV = $conn->prepare($sqlV);
  if (!$stV) throw new RuntimeException('Prepare failed (version): ' . $conn->error);

  // note: doc_type can be NULL in table but we always set it; still keep safe logic
  $stV->bind_param('sssss', $opsRef, $docType, $docType, $groupKey, $groupKey);
  $stV->execute();
  $stV->bind_result($v);
  $stV->fetch();
  $stV->close();

  $nextVersion = ((int)($v ?? 0)) + 1;

  // Store file on disk
  $baseDir = realpath(__DIR__ . '/../../') ?: (__DIR__ . '/../../');
  $uploadRoot = $baseDir . '/uploads/document_vault';
  ensure_dir($uploadRoot);

  $ctxDir = $uploadRoot . '/OPS';
  ensure_dir($ctxDir);

  $safeRef = preg_replace('/[^A-Za-z0-9\-_]+/', '_', $opsRef);
  $refDir = $ctxDir . '/' . $safeRef;
  ensure_dir($refDir);

  // doc_uuid in your table is varchar(255)
  $docUuid = 'DV' . bin2hex(random_bytes(12));

  $storedFilename = $docUuid . '_v' . $nextVersion . '.' . $ext;
  $storedPath = $refDir . '/' . $storedFilename;

  // storage_path in table should store relative path
  $relativePath = 'uploads/document_vault/OPS/' . $safeRef . '/' . $storedFilename;

  if (!move_uploaded_file($tmpPath, $storedPath)) {
    out(false, ['error' => 'Could not store uploaded file'], 500);
  }

  // uploaded_by is varchar(20) NOT NULL
  // Prefer employee_id; else fallback to "USER:<id>" (keeps within 20 chars if short)
  $uploadedBy = $employeeId ?? ('USER' . (string)$sessionUserId);
  if (strlen($uploadedBy) > 20) $uploadedBy = substr($uploadedBy, 0, 20);

  $status = 'PENDING';

  $sqlIns = "
    INSERT INTO document_vault_master
      (doc_uuid, file_context, folder_ref,
       pr_linked_id, doc_type, user_filename, description,
       storage_path, file_mime, file_size, version_no,
       uploaded_by, uploaded_by_name, status, physical_location)
    VALUES
      (?, 'OPS', ?,
       ?, ?, ?, ?,
       ?, ?, ?, ?,
       ?, ?, ?, ?)
  ";

  $stmt = $conn->prepare($sqlIns);
  if (!$stmt) {
    @unlink($storedPath);
    throw new RuntimeException('Prepare failed (insert): ' . $conn->error);
  }

  $uploadedByName = null; // optional
  $stmt->bind_param(
  'ssssssssiissss',
  $docUuid,
  $opsRef,
  $groupKey,
  $docType,
  $origName,
  $description,
  $relativePath,
  $mime,
  $size,
  $nextVersion,
  $uploadedBy,
  $uploadedByName,
  $status,
  $physLocation
);


  $stmt->execute();
  $stmt->close();

  out(true, [
    'file' => [
      'doc_uuid'    => $docUuid,
      'file_context'=> 'OPS',
      'folder_ref'  => $opsRef,
      'doc_type'    => $docType,
      'stored_name' => $storedFilename,
      'stored_path' => $relativePath,
      'original_name' => $origName,
      'mime_type'   => $mime,
      'size_bytes'  => $size,
      'version_no'  => $nextVersion
    ]
  ]);

} catch (Throwable $e) {
  if (isset($storedPath) && is_file($storedPath)) {
    @unlink($storedPath);
  }
  error_log('document_vault_upload error: ' . $e->getMessage() . "\n" . $e->getTraceAsString());
  out(false, [
    'error' => 'Server error',
    'debug' => $e->getMessage(),
    'line'  => $e->getLine(),
  ], 500);
}
