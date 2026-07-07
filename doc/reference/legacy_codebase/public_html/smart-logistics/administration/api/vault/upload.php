<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit($p, int $code=200): void { http_response_code($code); echo json_encode($p); exit; }

function effective_role(): string {
  $sessionRole = strtoupper((string)($_SESSION['auth']['role'] ?? 'OPERATIONS'));
  $map = ['OPERATIONS'=>'REQ','FINANCE'=>'FIN','MANAGEMENT'=>'MD','ADMIN'=>'ADMIN','SALES'=>'REQ'];
  $base = $map[$sessionRole] ?? 'REQ';

  $as = strtoupper((string)($_POST['as_role'] ?? ''));
  if (in_array($sessionRole, ['ADMIN','MANAGEMENT'], true) && in_array($as, ['REQ','FIN','MD'], true)) {
    return $as;
  }
  if ($base === 'ADMIN') return 'MD';
  return $base;
}

$role = effective_role();

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');

if ($userId <= 0) jexit(['ok'=>false,'error'=>'No session'], 401);

// Upload is allowed for all roles (REQ upload-only is the main use-case)
$context = strtoupper((string)($_POST['context'] ?? 'OPS')); // OPS|OVH
$fileRef = trim((string)($_POST['file_ref'] ?? ''));
$folder  = trim((string)($_POST['folder'] ?? ''));          // for OVH
$docType = strtoupper((string)($_POST['doc_type'] ?? 'OTHER'));
$docRef  = trim((string)($_POST['doc_ref'] ?? ''));
$linkPR  = trim((string)($_POST['linked_request_ref'] ?? ''));
$physLoc = trim((string)($_POST['phys_location'] ?? ''));

$allowedTypes = ['INVOICE','RECEIPT','BL','POD','CUSTOMS','OTHER'];
if (!in_array($docType, $allowedTypes, true)) $docType = 'OTHER';

if (!in_array($context, ['OPS','OVH'], true)) jexit(['ok'=>false,'error'=>'Invalid context'], 400);
if ($context === 'OPS' && $fileRef === '') jexit(['ok'=>false,'error'=>'file_ref required'], 400);
if ($context === 'OVH' && $folder === '') jexit(['ok'=>false,'error'=>'folder required'], 400);

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
  jexit(['ok'=>false,'error'=>'File upload failed'], 400);
}

$f = $_FILES['file'];
$maxBytes = 10 * 1024 * 1024;
if ($f['size'] > $maxBytes) jexit(['ok'=>false,'error'=>'Max file size is 10MB'], 400);

$origName = $f['name'];
$tmpPath  = $f['tmp_name'];

$mime = mime_content_type($tmpPath) ?: 'application/octet-stream';
$allowedMime = [
  'application/pdf','image/jpeg','image/png'
];
if (!in_array($mime, $allowedMime, true)) jexit(['ok'=>false,'error'=>'Only PDF/JPG/PNG allowed'], 400);

// Versioning rule: if same (context + fileRef/folder + docType + docRef) exists, archive old and increment
$docIdExisting = null;
$nextVersion = 1;

if ($context === 'OPS') {
  $sql = "SELECT id, version_no FROM document_vault
          WHERE context='OPS' AND operations_file_reference=? AND doc_type=? AND COALESCE(doc_ref,'')=?
          ORDER BY version_no DESC LIMIT 1";
  $stmt = $conn->prepare($sql);
  $docRefCmp = $docRef;
  $stmt->bind_param('sss', $fileRef, $docType, $docRefCmp);
  $stmt->execute();
  $ex = $stmt->get_result()->fetch_assoc();
  if ($ex) { $docIdExisting = (int)$ex['id']; $nextVersion = ((int)$ex['version_no']) + 1; }
} else {
  $sql = "SELECT id, version_no FROM document_vault
          WHERE context='OVH' AND overhead_folder=? AND doc_type=? AND COALESCE(doc_ref,'')=?
          ORDER BY version_no DESC LIMIT 1";
  $stmt = $conn->prepare($sql);
  $docRefCmp = $docRef;
  $stmt->bind_param('sss', $folder, $docType, $docRefCmp);
  $stmt->execute();
  $ex = $stmt->get_result()->fetch_assoc();
  if ($ex) { $docIdExisting = (int)$ex['id']; $nextVersion = ((int)$ex['version_no']) + 1; }
}

// Storage path
$baseDir = realpath(__DIR__ . '/../../../storage');
if ($baseDir === false) jexit(['ok'=>false,'error'=>'Storage base missing'], 500);

$subDir = ($context === 'OPS') ? 'vault/ops' : 'vault/ovh';
$targetDir = $baseDir . DIRECTORY_SEPARATOR . $subDir;

if (!is_dir($targetDir) && !mkdir($targetDir, 0775, true)) {
  jexit(['ok'=>false,'error'=>'Cannot create storage directory'], 500);
}

$docUid = 'SLAS-DOC-' . str_pad((string)random_int(1, 999999), 6, '0', STR_PAD_LEFT);
$ext = ($mime === 'application/pdf') ? 'pdf' : (($mime === 'image/png') ? 'png' : 'jpg');

$storedFilename = $docUid . '_v' . $nextVersion . '.' . $ext;
$storedPathRel = $subDir . '/' . $storedFilename;
$storedPathAbs = $targetDir . DIRECTORY_SEPARATOR . $storedFilename;

// Move file
if (!move_uploaded_file($tmpPath, $storedPathAbs)) {
  jexit(['ok'=>false,'error'=>'Failed to save file to disk'], 500);
}

// Archive old active record (soft)
if ($docIdExisting) {
  $sql = "UPDATE document_vault SET status='ARCHIVED' WHERE id=?";
  $stmt = $conn->prepare($sql);
  $stmt->bind_param('i', $docIdExisting);
  $stmt->execute();
}

// Insert new record
$sql = "
  INSERT INTO document_vault
  (doc_uid, context, operations_file_reference, overhead_folder,
   doc_type, doc_ref, linked_request_ref, phys_location,
   status, version_no,
   original_filename, stored_filename, stored_path, mime_type, file_size,
   created_by_user_id, created_by_employee_id)
  VALUES
  (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)
";
$stmt = $conn->prepare($sql);

$opsRef = ($context === 'OPS') ? $fileRef : null;
$ovhFld = ($context === 'OVH') ? $folder : null;

$size = (int)$f['size'];

$stmt->bind_param(
  'ssssssssissssiis',
  $docUid,
  $context,
  $opsRef,
  $ovhFld,
  $docType,
  $docRef,
  $linkPR,
  $physLoc,
  $nextVersion,
  $origName,
  $storedFilename,
  $storedPathRel,
  $mime,
  $size,
  $userId,
  $employeeId
);

if (!$stmt->execute()) {
  // Roll back file on failure
  @unlink($storedPathAbs);
  jexit(['ok'=>false,'error'=>'DB insert failed'], 500);
}

jexit(['ok'=>true, 'doc_uid'=>$docUid, 'version'=>$nextVersion]);
