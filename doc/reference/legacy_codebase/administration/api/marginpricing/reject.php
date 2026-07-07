<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT']);
require_method('POST');

header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$body = read_json_body();

session_start();
$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$role   = strtoupper((string)($_SESSION['auth']['role'] ?? ''));

$simRef  = trim((string)($body['simulation_ref'] ?? ''));
$reason  = trim((string)($body['reason'] ?? ''));

if ($simRef === '') {
  json_out(['ok'=>false,'error'=>'simulation_ref required'], 400);
}

$conn->begin_transaction();

try {
  $st = $conn->prepare("
    SELECT id, status
    FROM marginpricing_simulations
    WHERE simulation_ref = ?
    LIMIT 1
  ");
  $st->bind_param('s', $simRef);
  $st->execute();
  $sim = $st->get_result()->fetch_assoc();
  $st->close();

  if (!$sim) throw new RuntimeException('Simulation not found');

  $simId = (int)$sim['id'];
  $fromStatus = strtoupper((string)$sim['status']);

  if ($fromStatus !== 'SUBMITTED') {
    throw new RuntimeException("Cannot reject from status: {$fromStatus}");
  }

  $toStatus = 'REJECTED';

  $up = $conn->prepare("
    UPDATE marginpricing_simulations
    SET status = ?
    WHERE id = ?
    LIMIT 1
  ");
  $up->bind_param('si', $toStatus, $simId);
  $up->execute();
  $up->close();

  $evt = $conn->prepare("
    INSERT INTO marginpricing_simulation_events
      (marginpricing_simulation_id, simulation_ref, event, actor_user_id, actor_role, from_status, to_status, message)
    VALUES (?,?,?,?,?,?,?,?)
  ");
  $event = 'REJECTED';
  $msg   = $reason !== '' ? $reason : 'Rejected';
  $evt->bind_param('ississss', $simId, $simRef, $event, $userId, $role, $fromStatus, $toStatus, $msg);
  $evt->execute();
  $evt->close();

  $conn->commit();

  json_out(['ok'=>true,'simulation_ref'=>$simRef,'status'=>$toStatus]);
} catch (Throwable $e) {
  $conn->rollback();
  json_out(['ok'=>false,'error'=>$e->getMessage()], 400);
}
