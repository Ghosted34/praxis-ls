<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','MANAGEMENT']);
require_method('POST');

header('Content-Type: application/json; charset=utf-8');
$conn = db();

$body = read_json_body();
$id = (int)($body['id'] ?? 0);

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');

if ($id <= 0) { http_response_code(400); echo json_encode(['ok'=>false,'message'=>'id required']); exit; }

$conn->begin_transaction();
try {
  $stmt = $conn->prepare("SELECT status FROM marginpricing_simulations WHERE id=? LIMIT 1");
  $stmt->bind_param('i', $id);
  $stmt->execute();
  $cur = $stmt->get_result()->fetch_assoc();
  if (!$cur) throw new RuntimeException("Simulation not found");

  if (!in_array($cur['status'], ['APPROVED','QUOTED'], true)) {
    throw new RuntimeException("Only APPROVED/QUOTED can be unlocked");
  }

  $stmt = $conn->prepare("
    UPDATE marginpricing_simulations
    SET status='DRAFT', locked_at=NULL
    WHERE id=?
  ");
  $stmt->bind_param('i', $id);
  $stmt->execute();

  $stmt = $conn->prepare("
    INSERT INTO marginpricing_simulation_events
      (marginpricing_simulation_id, simulation_ref, event, actor_user_id, actor_employee_id, message)
    SELECT id, simulation_ref, 'UNLOCKED', ?, ?, 'Unlocked to DRAFT'
    FROM marginpricing_simulations WHERE id=? LIMIT 1
  ");
  $stmt->bind_param('isi', $userId, $employeeId, $id);
  $stmt->execute();

  $conn->commit();
  echo json_encode(['ok'=>true,'message'=>'Unlocked']);
} catch (Throwable $e) {
  $conn->rollback();
  http_response_code(500);
  echo json_encode(['ok'=>false,'message'=>$e->getMessage()]);
}
