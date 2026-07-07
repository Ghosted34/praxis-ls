<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit($p, int $code=200): void { http_response_code($code); echo json_encode($p); exit; }

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$role   = strtoupper((string)($_SESSION['auth']['role'] ?? ''));

// Only FINANCE can verify (ADMIN optional; if you want, keep ADMIN too)
if (!in_array($role, ['FINANCE','ADMIN'], true)) {
  jexit(['ok'=>false,'error'=>'Forbidden: only Finance can verify'], 403);
}

$docUid = trim((string)($_POST['doc_uid'] ?? ''));
if ($docUid === '') jexit(['ok'=>false,'error'=>'doc_uid required'], 400);

$sql = "UPDATE document_vault
        SET status='VERIFIED', verified_by_user_id=?, verified_at=NOW()
        WHERE doc_uid=? AND status='PENDING'";
$stmt = $conn->prepare($sql);
$stmt->bind_param('is', $userId, $docUid);
$stmt->execute();

if ($stmt->affected_rows <= 0) {
  jexit(['ok'=>false,'error'=>'Not found or already verified'], 404);
}

jexit(['ok'=>true]);
