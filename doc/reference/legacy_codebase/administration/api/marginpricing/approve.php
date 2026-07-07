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

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$role   = strtoupper((string)($_SESSION['auth']['role'] ?? ''));

$simId  = (int)($body['id'] ?? 0);
$simRef = trim((string)($body['simulation_ref'] ?? ''));

if ($simId <= 0 && $simRef === '') {
  json_out(['ok'=>false,'error'=>'id or simulation_ref required'], 400);
}

// Resolve id/ref so we always have both
if ($simId <= 0) {
  $st = $conn->prepare("SELECT id FROM marginpricing_simulations WHERE simulation_ref=? LIMIT 1");
  $st->bind_param('s', $simRef);
  $st->execute();
  $row = $st->get_result()->fetch_assoc();
  $st->close();

  if (!$row) json_out(['ok'=>false,'error'=>'Simulation not found'], 404);
  $simId = (int)$row['id'];
} else {
  $st = $conn->prepare("SELECT simulation_ref FROM marginpricing_simulations WHERE id=? LIMIT 1");
  $st->bind_param('i', $simId);
  $st->execute();
  $row = $st->get_result()->fetch_assoc();
  $st->close();

  if (!$row) json_out(['ok'=>false,'error'=>'Simulation not found'], 404);
  $simRef = (string)$row['simulation_ref'];
}

$conn->begin_transaction();

try {
  // 1. Lock the row AND fetch the financial details needed for the update
  // Added: margin_amount, currency, exchange_rate, ops_ref
  $st = $conn->prepare("
      SELECT 
          status, 
          margin_amount, 
          currency, 
          exchange_rate_to_xaf, 
          operations_file_reference 
      FROM marginpricing_simulations 
      WHERE id=? 
      LIMIT 1 
      FOR UPDATE
  ");
  $st->bind_param('i', $simId);
  $st->execute();
  $sim = $st->get_result()->fetch_assoc();
  $st->close();

  if (!$sim) throw new RuntimeException('Simulation not found');

  $cur = strtoupper((string)$sim['status']);
  // Validation: Must be submitted to be approved
  if ($cur !== 'SUBMITTED') throw new RuntimeException("Can only approve SUBMITTED (now {$cur})");

  $to = 'APPROVED';

  // 2. Update Simulation Status
  $up = $conn->prepare("
    UPDATE marginpricing_simulations
    SET status='APPROVED', approved_by_user_id=?, approved_at=NOW()
    WHERE id=?
    LIMIT 1
  ");
  $up->bind_param('ii', $userId, $simId);
  $up->execute();
  $up->close();

  // 3. Log Event
  $evt = $conn->prepare("
    INSERT INTO marginpricing_simulation_events
      (marginpricing_simulation_id, simulation_ref, event, actor_user_id, actor_role, from_status, to_status, message)
    VALUES (?,?,?,?,?,?,?,?)
  ");
  $ev  = 'APPROVED';
  $msg = 'Approved';
  $evt->bind_param('ississss', $simId, $simRef, $ev, $userId, $role, $cur, $to, $msg);
  $evt->execute();
  $evt->close();

  // 4. Update Master File (The Logic You Requested)
  // Check if we have a file reference to update
  $opsRef = trim((string)($sim['operations_file_reference'] ?? ''));
  
  if ($opsRef !== '') {
      $marginRaw = (float)$sim['margin_amount'];
      $curr      = $sim['currency'];
      $fx        = (float)$sim['exchange_rate_to_xaf'];
      if ($fx <= 0) $fx = 1.0;

      // Convert to XAF
      $marginXaf = ($curr === 'XAF') ? $marginRaw : ($marginRaw * $fx);

      // CRITICAL: This query ONLY updates 'margin_simulator_amount' and 'margin_simulator_id'
      // The 'margin' column is intentionally NOT included here.
      $updOps = $conn->prepare("
          UPDATE operations_file_master
          SET 
              margin_simulator_amount = ?, 
              margin_simulator_id = ?
          WHERE operations_file_reference = ?
      ");
      $updOps->bind_param('dss', $marginXaf, $simRef, $opsRef);
      $updOps->execute();
      $updOps->close();
  }

  $conn->commit();
  json_out(['ok'=>true,'status'=>$to]);

} catch (Throwable $e) {
  $conn->rollback();
  json_out(['ok'=>false,'error'=>$e->getMessage()], 400);
}