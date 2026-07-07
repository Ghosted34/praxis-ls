<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','FINANCE','OPERATIONS','SALES']);
require_method('POST');
header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$userId = get_session_user_id();
$role   = get_session_role();

$conn->begin_transaction();

try {
  // 1) Create DRAFT shell
  // Create a placeholder ref first; you can refine format later.
  $tmpRef = 'SLAS-MA-TMP';

  $ins = $conn->prepare("
    INSERT INTO marginpricing_simulations
      (simulation_ref, status, created_by_user_id, created_at, updated_at)
    VALUES
      (?, 'DRAFT', ?, NOW(), NOW())
  ");
  $ins->bind_param('si', $tmpRef, $userId);
  $ins->execute();

  $newId = (int)$conn->insert_id;

  // 2) Generate final readable reference (example format)
  $simulationRef = 'SLAS-QUO-' . str_pad((string)$newId, 5, '0', STR_PAD_LEFT);

  $up = $conn->prepare("
    UPDATE marginpricing_simulations
    SET simulation_ref = ?, updated_at = NOW()
    WHERE id = ?
    LIMIT 1
  ");
  $up->bind_param('si', $simulationRef, $newId);
  $up->execute();

  // 3) Event log (optional but recommended)
  $evt = $conn->prepare("
    INSERT INTO marginpricing_simulation_events
      (marginpricing_simulation_id, simulation_ref, event, actor_user_id, actor_role, message, created_at)
    VALUES
      (?, ?, 'CREATED', ?, ?, 'Created draft simulation', NOW())
  ");
  $evt->bind_param('isis', $newId, $simulationRef, $userId, $role);
  $evt->execute();

  $conn->commit();

  json_out([
    'ok' => true,
    'simulation' => [
      'id' => $newId,
      'simulation_ref' => $simulationRef,
      'status' => 'DRAFT',
      'costing_id' => null,
      'costing_ref' => null,
      'operations_file_reference' => null
    ]
  ]);

} catch (Throwable $e) {
  $conn->rollback();
  json_out(['ok' => false, 'error' => $e->getMessage()], 500);
}
