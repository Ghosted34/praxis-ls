<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','SALES','MANAGEMENT','FINANCE','OPERATIONS']);

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function json_out(array $p, int $code = 200): void {
  http_response_code($code);
  echo json_encode($p, JSON_UNESCAPED_UNICODE);
  exit;
}

try {
  $conn = db();

  // IMPORTANT: these must exist in your enum
  $approvedStatuses = ['APPROVED', 'APPROVED_LOCKED'];
  $placeholders = implode(',', array_fill(0, count($approvedStatuses), '?'));

  // Exclude costings that already have a margin simulation attached
  // (any row in marginpricing_simulations with same costing_id)
  $sql = "
    SELECT
      cm.costing_id,
      cm.costing_ref,
      cm.operations_file_reference,
      cm.client_id,
      cm.client_name_cached,
      cm.total_ttc,
      cm.currency,
      cm.status,
      cm.approved_at,
      cm.created_at
    FROM costing_master cm
    LEFT JOIN marginpricing_simulations mps
      ON mps.costing_id = cm.costing_id
    WHERE cm.status IN ($placeholders)
      AND mps.id IS NULL
    ORDER BY cm.approved_at DESC, cm.created_at DESC
    LIMIT 500
  ";

  $stmt = $conn->prepare($sql);

  // bind_param needs references (use variables)
  $s1 = $approvedStatuses[0];
  $s2 = $approvedStatuses[1];
  $stmt->bind_param('ss', $s1, $s2);

  $stmt->execute();
  $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
  $stmt->close();

  json_out(['ok' => true, 'items' => $rows]);

} catch (Throwable $e) {
  json_out([
    'ok' => false,
    'message' => 'Failed to load approved costings',
    'error' => $e->getMessage(),
  ], 500);
}
