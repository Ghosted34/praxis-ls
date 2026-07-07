<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']); // access gate
require_method('POST');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$body = read_json_body();

$costingId = must_str($body['costing_id'] ?? null, 'costing_id');
$action    = strtoupper(must_str($body['action'] ?? null, 'action'));
// Actions: SUBMIT | VALIDATE | APPROVE | REJECT | REQUEST_UNLOCK | UNLOCK | DENY_UNLOCK
$reason    = norm_str($body['reason'] ?? null);

$userId = get_session_user_id();
$role   = strtoupper(get_session_role());

function deny(string $msg): void {
  json_out(['ok' => false, 'error' => $msg], 403);
}

function can(string $role, string $action): bool {
  $policy = [
    'SUBMIT'         => ['ADMIN','SALES','OPERATIONS','MANAGEMENT'],
    'VALIDATE'       => ['ADMIN','MANAGEMENT','FINANCE','LEAD'],
    'APPROVE'        => ['ADMIN','MANAGEMENT'],
    'REJECT'         => ['ADMIN','FINANCE','MANAGEMENT','LEAD'],

    // --- NEW WORKFLOW POLICIES ---
    'REQUEST_UNLOCK' => ['ADMIN','SALES','OPERATIONS','MANAGEMENT'],
    'UNLOCK'         => ['ADMIN','MANAGEMENT'],
    'DENY_UNLOCK'    => ['ADMIN','MANAGEMENT'],
  ];
  return in_array($role, $policy[$action] ?? [], true);
}

if (!can($role, $action)) {
  deny("Role {$role} is not permitted to perform {$action}");
}

$conn->begin_transaction();

try {
  // Fetch acting employee name for logging
  $nm = $conn->prepare("SELECT em.full_name FROM employee_master em JOIN user_auth ua ON em.employee_id = ua.employee_id WHERE ua.user_id = ? LIMIT 1");
  $nm->bind_param('i', $userId); $nm->execute();
  $actingName = ($nm->get_result()->fetch_assoc())['full_name'] ?? "User #$userId";
  // fetch costing (PATCH: include costing_ref)
  $st = $conn->prepare("
    SELECT costing_id, costing_ref, operations_file_reference, status
    FROM costing_master
    WHERE costing_id = ?
    LIMIT 1
  ");
  $st->bind_param('s', $costingId);
  $st->execute();
  $row = $st->get_result()->fetch_assoc();

  if (!$row) {
    $conn->rollback();
    json_out(['ok' => false, 'error' => 'Costing not found'], 404);
  }

  $status     = (string)$row['status'];
  $opsRef     = (string)$row['operations_file_reference'];
  $costingRef = (string)($row['costing_ref'] ?? '');

  if ($action === 'SUBMIT') {
    if (!in_array($status, ['DRAFT','REJECTED'], true)) {
      $conn->rollback();
      json_out(['ok' => false, 'error' => "Cannot submit from status {$status}"], 409);
    }
    $upd = $conn->prepare("UPDATE costing_master SET status='SUBMITTED_FOR_VALIDATION' WHERE costing_id=? LIMIT 1");
    $upd->bind_param('s', $costingId);
    $upd->execute();
  }

  elseif ($action === 'VALIDATE') {
    if ($status !== 'SUBMITTED_FOR_VALIDATION') {
      $conn->rollback();
      json_out(['ok' => false, 'error' => "Cannot validate from status {$status}"], 409);
    }

    // 1) Move costing to approval stage + stamp validator
    $upd = $conn->prepare("
      UPDATE costing_master
      SET status='SUBMITTED_FOR_APPROVAL',
          validated_by_user_id=?,
          validated_at=NOW()
      WHERE costing_id=?
      LIMIT 1
    ");
    $upd->bind_param('is', $userId, $costingId);
    $upd->execute();

    // 2) PATCH: Sync costing_id + costing_ref to Operations File Master on VALIDATE
    if ($opsRef !== '') {
      $updOps = $conn->prepare("
        UPDATE operations_file_master
        SET costing_id = ?, costing_ref = ?
        WHERE operations_file_reference = ?
        LIMIT 1
      ");
      $updOps->bind_param('sss', $costingId, $costingRef, $opsRef);
      $updOps->execute();
    }
  }

  elseif ($action === 'APPROVE') {
    if ($status !== 'SUBMITTED_FOR_APPROVAL') {
      $conn->rollback();
      json_out(['ok' => false, 'error' => "Cannot approve from status {$status}"], 409);
    }

    // --- NEW: Generate Hybrid Auth Code ---
    // Generates a short, unique 8-character ID (e.g., "8F2A-9C10")
    $rawHash = strtoupper(md5(uniqid((string)rand(), true)));
    $authCode = substr($rawHash, 0, 4) . '-' . substr($rawHash, 4, 4);

    // 1) Approve + Lock + Save Auth Code
    $upd = $conn->prepare("
        UPDATE costing_master
        SET status='APPROVED_LOCKED',
            approved_by_user_id=?,
            approved_at=NOW(),
            locked_at=NOW(),
            approval_auth_code=? /* <--- Saving the code */
        WHERE costing_id=? LIMIT 1
    ");
    $upd->bind_param('iss', $userId, $authCode, $costingId);
    $upd->execute();

    // 2) Sync to Operations File
    $st2 = $conn->prepare("SELECT costing_ref, total_ht FROM costing_master WHERE costing_id = ? LIMIT 1");
    $st2->bind_param('s', $costingId);
    $st2->execute();
    $cm = $st2->get_result()->fetch_assoc();

    if ($cm) {
      $updOps = $conn->prepare("
        UPDATE operations_file_master
        SET costing_ref = ?, total_ht = ?
        WHERE operations_file_reference = ?
        LIMIT 1
      ");
      $costingRef2 = (string)$cm['costing_ref'];
      $totalHT = (float)$cm['total_ht'];
      $updOps->bind_param('sds', $costingRef2, $totalHT, $opsRef);
      $updOps->execute();
    }
  }

  elseif ($action === 'REJECT') {
    if (!in_array($status, ['SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL'], true)) {
      $conn->rollback();
      json_out(['ok' => false, 'error' => "Cannot reject from status {$status}"], 409);
    }
    $newRemarks = $reason ? ("REJECTION: " . $reason) : "REJECTED";
    $upd = $conn->prepare("
      UPDATE costing_master
      SET status='REJECTED',
          remarks = CONCAT(COALESCE(remarks,''), '\n', ?)
      WHERE costing_id=? LIMIT 1
    ");
    $upd->bind_param('ss', $newRemarks, $costingId);
    $upd->execute();
  }

  elseif ($action === 'REQUEST_UNLOCK') {
    if ($status !== 'APPROVED_LOCKED') {
      $conn->rollback();
      json_out(['ok' => false, 'error' => "Only Locked costings can be requested for unlock."], 409);
    }
    $note = "\n[Unlock Requested by $actingName at " . date('Y-m-d H:i') . "]";
    $upd = $conn->prepare("UPDATE costing_master SET status='UNLOCK_REQUESTED', remarks = CONCAT(COALESCE(remarks,''), ?) WHERE costing_id=? LIMIT 1");
    $upd->bind_param('ss', $note, $costingId);
    $upd->execute();
  }

  elseif ($action === 'UNLOCK') {
    if ($status !== 'UNLOCK_REQUESTED') {
      $conn->rollback();
      json_out(['ok' => false, 'error' => "Costing is not pending unlock."], 409);
    }
    $note = "\n[Unlocked by $actingName at " . date('Y-m-d H:i') . "]";
    $upd = $conn->prepare("UPDATE costing_master SET status='DRAFT', locked_at=NULL, remarks = CONCAT(COALESCE(remarks,''), ?) WHERE costing_id=? LIMIT 1");
    $upd->bind_param('ss', $note, $costingId);
    $upd->execute();
  }

  elseif ($action === 'DENY_UNLOCK') {
    if ($status !== 'UNLOCK_REQUESTED') {
      $conn->rollback();
      json_out(['ok' => false, 'error' => "Costing is not pending unlock."], 409);
    }
    $note = "\n[Unlock Denied by $actingName at " . date('Y-m-d H:i') . "]";
    $upd = $conn->prepare("UPDATE costing_master SET status='APPROVED_LOCKED', remarks = CONCAT(COALESCE(remarks,''), ?) WHERE costing_id=? LIMIT 1");
    $upd->bind_param('ss', $note, $costingId);
    $upd->execute();
  }

  else {
    $conn->rollback();
    json_out(['ok' => false, 'error' => 'Invalid action'], 422);
  }

  $conn->commit();
  json_out(['ok' => true, 'message' => 'Transition applied']);

} catch (Throwable $e) {
  if ($conn->in_transaction) $conn->rollback();
  json_out(['ok' => false, 'error' => 'Transition failed', 'detail' => $e->getMessage()], 500);
}
