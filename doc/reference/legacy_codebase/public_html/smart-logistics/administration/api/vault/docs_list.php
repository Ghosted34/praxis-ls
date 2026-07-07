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

  $as = strtoupper((string)($_GET['as_role'] ?? ''));
  // Only ADMIN or MANAGEMENT can simulate
  if (in_array($sessionRole, ['ADMIN','MANAGEMENT'], true) && in_array($as, ['REQ','FIN','MD'], true)) {
    return $as;
  }
  // ADMIN defaults to MD view privileges
  if ($base === 'ADMIN') return 'MD';
  return $base;
}

$role = effective_role();

$context = strtoupper((string)($_GET['context'] ?? 'OPS')); // OPS|OVH
$fileRef  = trim((string)($_GET['file_ref'] ?? ''));
$folder   = trim((string)($_GET['folder'] ?? ''));

if (!in_array($context, ['OPS','OVH'], true)) jexit(['ok'=>false,'error'=>'Invalid context'], 400);

// RBAC: Ops Staff cannot view vault contents
if ($role === 'REQ') {
  jexit(['ok'=>true, 'data'=>[], 'restricted'=>true]);
}

if ($context === 'OPS') {
  if ($fileRef === '') jexit(['ok'=>false,'error'=>'file_ref required'], 400);

  $sql = "
    SELECT id, doc_uid, doc_type, doc_ref, linked_request_ref, phys_location,
           status, version_no, original_filename, mime_type, file_size, created_at,
           created_by_user_id, verified_at
    FROM document_vault
    WHERE context='OPS' AND operations_file_reference=?
    ORDER BY created_at DESC
  ";
  $stmt = $conn->prepare($sql);
  $stmt->bind_param('s', $fileRef);
  $stmt->execute();
  $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
  jexit(['ok'=>true,'data'=>$rows, 'restricted'=>false]);
}

if ($folder === '') jexit(['ok'=>false,'error'=>'folder required'], 400);

$sql = "
  SELECT id, doc_uid, doc_type, doc_ref, linked_request_ref, phys_location,
         status, version_no, original_filename, mime_type, file_size, created_at,
         created_by_user_id, verified_at
  FROM document_vault
  WHERE context='OVH' AND overhead_folder=?
  ORDER BY created_at DESC
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $folder);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

jexit(['ok'=>true,'data'=>$rows, 'restricted'=>false]);
