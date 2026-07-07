<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','OPERATIONS','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

$conn = db();

function post(string $k, $default=null) {
  return $_POST[$k] ?? $default;
}

$ref = trim((string)post('operations_file_reference', ''));
$stageIndexRaw = post('stage_index', null);

if ($ref === '') jexit(['ok'=>false,'error'=>'Missing operations_file_reference'], 400);
if ($stageIndexRaw === null || $stageIndexRaw === '') jexit(['ok'=>false,'error'=>'Missing stage_index'], 400);

$stageIndex = (int)$stageIndexRaw;
if ($stageIndex < 0 || $stageIndex > 13) jexit(['ok'=>false,'error'=>'Invalid stage_index'], 400);

$location = trim((string)post('location', ''));
$reference = trim((string)post('reference', ''));
$notes = trim((string)post('notes', ''));

$markCompleted = (int)post('mark_completed', 0) === 1;
$advanceNext   = (int)post('advance_next', 1) === 1;

// Optional: allow user to set a completed time; otherwise NOW.
$completedAt = trim((string)post('completed_at', '')); // expects 'YYYY-MM-DD HH:MM:SS' or empty

$completedAtSql = null;
if ($markCompleted) {
  if ($completedAt !== '') {
    // Minimal validation; you can reuse your normalizeDatetime helper if you already have one.
    $ts = strtotime($completedAt);
    if ($ts === false) jexit(['ok'=>false,'error'=>'Invalid completed_at datetime'], 400);
    $completedAtSql = date('Y-m-d H:i:s', $ts);
  } else {
    $completedAtSql = date('Y-m-d H:i:s');
  }
}

// Author (from session)
$userId = (int)($_SESSION['auth']['user_id'] ?? 0);

$conn->begin_transaction();

try {

  // Lock row to prevent race conditions when two users click "complete" same time.
  $stmt = $conn->prepare("
    SELECT current_stage_index
    FROM operations_file_master
    WHERE operations_file_reference = ?
    FOR UPDATE
  ");
  $stmt->bind_param('s', $ref);
  $stmt->execute();
  $cur = $stmt->get_result()->fetch_assoc();
  if (!$cur) throw new Exception("Not found");

  $currentStage = (int)$cur['current_stage_index'];

  $nextStage = $currentStage;
  if ($advanceNext && $markCompleted) {
    $nextStage = max($currentStage, $stageIndex + 1);
    if ($nextStage > 13) $nextStage = 13;
  }

  // Build dynamic column names safely (stage index already validated 0..13).
  $cCompleted = "m{$stageIndex}_completed_at";
  $cLoc       = "m{$stageIndex}_location";
  $cRef       = "m{$stageIndex}_reference";
  $cNotes     = "m{$stageIndex}_notes";

  // We cannot bind identifiers, so we embed them after validation.
  $sql = "
    UPDATE operations_file_master
    SET
      $cLoc = ?,
      $cRef = ?,
      $cNotes = ?,
      $cCompleted = " . ($markCompleted ? "?" : "$cCompleted") . ",
      current_stage_index = ?,
      current_stage_updated_at = NOW(),
      current_stage_updated_by_user_id = ?
      " . (($markCompleted && $nextStage >= 13) ? ", operations_status = 'OPERATIONAL_COMPLETEE'" : "") . "
    WHERE operations_file_reference = ?
    LIMIT 1
  ";

  $stmt2 = $conn->prepare($sql);

  if ($markCompleted) {
    $stmt2->bind_param(
      'sssiiis',
      $location,
      $reference,
      $notes,
      $completedAtSql,
      $nextStage,
      $userId,
      $ref
    );
  } else {
    $stmt2->bind_param(
      'sssiiis',
      $location,
      $reference,
      $notes,
      $nextStage,
      $userId,
      $ref
    );
  }

  $stmt2->execute();
  if ($stmt2->affected_rows < 0) throw new Exception("Update failed");

  $conn->commit();
  jexit(['ok'=>true,'data'=>['operations_file_reference'=>$ref,'current_stage_index'=>$nextStage]]);

} catch (Throwable $e) {
  $conn->rollback();
  jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
}
