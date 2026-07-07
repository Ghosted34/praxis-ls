<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','FINANCE','MANAGEMENT']);
require_method('POST');

header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$body = read_json_body();

session_start();
$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$role   = strtoupper((string)($_SESSION['auth']['role'] ?? ''));

$simRef = trim((string)($body['simulation_ref'] ?? ''));

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
  $status = strtoupper((string)$sim['status']);

  // Typically validate happens during SUBMITTED review
  if (!in_array($status, ['SUBMITTED','APPROVED'], true)) {
    throw new RuntimeException("Cannot validate from status: {$status}");
  }

  $evt = $conn->prepare("
    INSERT INTO marginpricing_simulation_events
      (marginpricing_simulation_id, simulation_ref, event, actor_user_id, actor_role, from_status, to_status, message)
    VALUES (?,?,?,?,?,?,?,?)
  ");
  $event = 'VALIDATED';
  $msg   = 'Validated during review';
  // from_status and to_status remain same since no state change
  $evt->bind_param('ississss', $simId, $simRef, $event, $userId, $role, $status, $status, $msg);
  $evt->execute();
  $evt->close();

  $conn->commit();

  json_out(['ok'=>true,'simulation_ref'=>$simRef,'status'=>$status]);
} catch (Throwable $e) {
  $conn->rollback();
  json_out(['ok'=>false,'error'=>$e->getMessage()], 400);
}
