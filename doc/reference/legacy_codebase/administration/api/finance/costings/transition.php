<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

$payload = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($payload)) jexit(['ok'=>false,'error'=>'Invalid JSON'], 400);

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) jexit(['ok'=>false,'error'=>'Unauthenticated'], 401);

$costing_id = trim((string)($payload['costing_id'] ?? ''));
$nextStatus = trim((string)($payload['status'] ?? ''));

if ($costing_id === '') jexit(['ok'=>false,'error'=>'costing_id is required'], 400);
if ($nextStatus === '') jexit(['ok'=>false,'error'=>'status is required'], 400);

$allowed = [
  'DRAFT',
  'SUBMITTED_FOR_VALIDATION',
  'VALIDATED',
  'SUBMITTED_FOR_APPROVAL',
  'APPROVED_LOCKED',
  'REJECTED'
];
if (!in_array($nextStatus, $allowed, true)) {
  jexit(['ok'=>false,'error'=>'Invalid status'], 400);
}

try {
  $sql = "SELECT costing_ref, status FROM costing_master WHERE costing_id = ? LIMIT 1";
  $st = $conn->prepare($sql);
  if (!$st) jexit(['ok'=>false,'error'=>'Prepare failed'], 500);
  $st->bind_param('s', $costing_id);
  $st->execute();
  $row = $st->get_result()->fetch_assoc();
  if (!$row) jexit(['ok'=>false,'error'=>'Costing not found'], 404);

  $cur = (string)$row['status'];

  if ($cur === 'APPROVED_LOCKED') {
    jexit(['ok'=>false,'error'=>'This costing is locked'], 409);
  }

  // Enforce basic state machine (tighten as you wish)
  $validTransitions = [
    'DRAFT' => ['DRAFT','SUBMITTED_FOR_VALIDATION'],
    'SUBMITTED_FOR_VALIDATION' => ['VALIDATED','REJECTED'],
    'VALIDATED' => ['SUBMITTED_FOR_APPROVAL','REJECTED'],
    'SUBMITTED_FOR_APPROVAL' => ['APPROVED_LOCKED','REJECTED'],
    'REJECTED' => ['DRAFT','SUBMITTED_FOR_VALIDATION'],
  ];

  $allowedNext = $validTransitions[$cur] ?? [];
  if (!in_array($nextStatus, $allowedNext, true)) {
    jexit(['ok'=>false,'error'=>"Invalid transition: {$cur} → {$nextStatus}"], 409);
  }

  $conn->begin_transaction();

  // Update audit columns depending on transition
  if ($nextStatus === 'VALIDATED') {
    $sqlU = "
      UPDATE costing_master
      SET status='VALIDATED',
          validated_by_user_id=?,
          validated_at=NOW(),
          updated_at=NOW()
      WHERE costing_id=?
      LIMIT 1
    ";
    $u = $conn->prepare($sqlU);
    if (!$u) throw new RuntimeException('Prepare failed');
    $u->bind_param('is', $userId, $costing_id);
    $u->execute();
  } elseif ($nextStatus === 'APPROVED_LOCKED') {
    $sqlU = "
      UPDATE costing_master
      SET status='APPROVED_LOCKED',
          approved_by_user_id=?,
          approved_at=NOW(),
          locked_at=NOW(),
          updated_at=NOW()
      WHERE costing_id=?
      LIMIT 1
    ";
    $u = $conn->prepare($sqlU);
    if (!$u) throw new RuntimeException('Prepare failed');
    $u->bind_param('is', $userId, $costing_id);
    $u->execute();
  } else {
    $sqlU = "
      UPDATE costing_master
      SET status=?,
          updated_at=NOW()
      WHERE costing_id=?
      LIMIT 1
    ";
    $u = $conn->prepare($sqlU);
    if (!$u) throw new RuntimeException('Prepare failed');
    $u->bind_param('ss', $nextStatus, $costing_id);
    $u->execute();
  }

  $conn->commit();

  jexit([
    'ok'=>true,
    'costing_id'=>$costing_id,
    'costing_ref'=>$row['costing_ref'],
    'status'=>$nextStatus
  ]);
} catch (Throwable $e) {
  try { $conn->rollback(); } catch (Throwable $x) {}
  jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
}
