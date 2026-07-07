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
$reason = trim((string)($body['reason'] ?? ''));

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');

if ($id <= 0) { http_response_code(400); echo json_encode(['ok'=>false,'message'=>'id required']); exit; }
if ($reason === '') { http_response_code(400); echo json_encode(['ok'=>false,'message'=>'reason required']); exit; }

$conn->begin_transaction();
try {
  $stmt = $conn->prepare("SELECT status FROM marginpricing_simulations WHERE id=? LIMIT 1");
  $stmt->bind_param('i', $id);
  $stmt->execute();
  $cur = $stmt->get_result()->fetch_assoc();
  if (!$cur) throw new RuntimeException("Simulation not found");

  if ($cur['status'] !== 'SUBMITTED') throw new RuntimeException("Only SUBMITTED can be rejected");

  $stmt = $conn->prepare("
    UPDATE marginpricing_simulations
    SET status='REJECTED', rejected_by_user_id=?, rejected_at=NOW(), rejection_reason=?, locked_at=NULL
    WHERE id=?
  ");
  $stmt->bind_param('isi', $userId, $reason, $id);
  $stmt->execute();

  $stmt = $conn->prepare("
    INSERT INTO marginpricing_simulation_events
      (marginpricing_simulation_id, simulation_ref, event, actor_user_id, actor_employee_id, message)
    SELECT id, simulation_ref, 'REJECTED', ?, ?, ?
    FROM marginpricing_simulations WHERE id=? LIMIT 1
  ");
  $msg = "Rejected: ".$reason;
  $stmt->bind_param('issi', $userId, $employeeId, $msg, $id);
  $stmt->execute();

  $conn->commit();
  echo json_encode(['ok'=>true,'message'=>'Rejected']);
} catch (Throwable $e) {
  $conn->rollback();
  http_response_code(500);
  echo json_encode(['ok'=>false,'message'=>$e->getMessage()]);
}
