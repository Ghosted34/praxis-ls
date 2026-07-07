<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','SALES']);
require_method('POST');

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function fail(string $msg, int $code = 400, array $extra = []): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => false, 'error' => $msg], $extra), JSON_UNESCAPED_UNICODE);
  exit;
}

function ok(array $payload = []): void {
  echo json_encode(array_merge(['ok' => true], $payload), JSON_UNESCAPED_UNICODE);
  exit;
}

try {
  $conn = db();

  $body = read_json_body();

  if (session_status() === PHP_SESSION_NONE) {
    session_start();
  }

  $userId = (int)($_SESSION['auth']['user_id'] ?? 0);
  $role   = strtoupper((string)($_SESSION['auth']['role'] ?? ''));

  $simRef = trim((string)($body['simulation_ref'] ?? ''));
  if ($simRef === '') fail('simulation_ref required', 400);

  $conn->begin_transaction();

  // 1) Load simulation
  $st = $conn->prepare("
    SELECT id, status, costing_id, risk_flag, risk_justification
    FROM marginpricing_simulations
    WHERE simulation_ref = ?
    LIMIT 1
  ");
  $st->bind_param('s', $simRef);
  $st->execute();
  $sim = $st->get_result()->fetch_assoc();
  $st->close();

  if (!$sim) {
    $conn->rollback();
    fail('Simulation not found', 404);
  }

  $simId      = (int)$sim['id'];
  $fromStatus = strtoupper((string)$sim['status']);

  // 2) Allowed sources
  if (!in_array($fromStatus, ['DRAFT','REVISION','REJECTED'], true)) {
    $conn->rollback();
    fail("Cannot submit from status: {$fromStatus}", 409);
  }

  // 3) Must be linked to costing
  $costingId = (string)($sim['costing_id'] ?? '');
  if ($costingId === '') {
    $conn->rollback();
    fail('Link an approved costing first', 409);
  }

  // 4) Risk justification required if flagged
  $riskFlag = (int)($sim['risk_flag'] ?? 0);
  $riskJust = trim((string)($sim['risk_justification'] ?? ''));
  if ($riskFlag === 1 && $riskJust === '') {
    $conn->rollback();
    fail('Negative margin risk detected: risk justification is required before submission', 409);
  }

  $toStatus = 'SUBMITTED';

  // 5) Update status ONLY (do not touch other columns)
  $up = $conn->prepare("
    UPDATE marginpricing_simulations
    SET status = ?
    WHERE id = ?
    LIMIT 1
  ");
  $up->bind_param('si', $toStatus, $simId);
  $up->execute();
  $up->close();

  // 6) Event log (IMPORTANT: include created_at)
  $evt = $conn->prepare("
    INSERT INTO marginpricing_simulation_events
      (marginpricing_simulation_id, simulation_ref, event,
       actor_user_id, actor_role, from_status, to_status, message, created_at)
    VALUES (?,?,?,?,?,?,?,?,NOW())
  ");
  $event = 'SUBMITTED';
  $msg   = 'Submitted for approval';

  $evt->bind_param(
    'ississss',
    $simId,
    $simRef,
    $event,
    $userId,
    $role,
    $fromStatus,
    $toStatus,
    $msg
  );
  $evt->execute();
  $evt->close();

  $conn->commit();

  ok(['simulation_ref' => $simRef, 'status' => $toStatus]);

} catch (Throwable $e) {
  // If a SQL exception occurred, STRICT mode throws -> return the real message
  try {
    if (isset($conn) && $conn instanceof mysqli) $conn->rollback();
  } catch (Throwable $ignored) {}

  fail('Submit failed', 500, [
    'details' => $e->getMessage()
  ]);
}
