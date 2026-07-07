<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS','SALES']);
header('Content-Type: application/json; charset=utf-8');

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$conn = db();

$opsRef = trim((string)($_GET['operations_file_reference'] ?? ''));
if ($opsRef === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => 'operations_file_reference is required']);
  exit;
}

try {
  /**
   * 1) Header context
   * operations_file_master -> client_master
   * costing_master by operations_file_reference
   */
  $sqlH = "
    SELECT
      ofm.operations_file_reference,
      ofm.client_id,
      COALESCE(cm.client_name, ofm.client_bill_to, ofm.client_id) AS client_name,
      ofm.client_bill_to,
      ofm.service_type,
      ofm.service_territory,

      c.costing_id,
      c.costing_ref,
      c.total_ttc,
      c.status AS costing_status
    FROM operations_file_master ofm
    LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
    JOIN costing_master c ON c.operations_file_reference = ofm.operations_file_reference
    WHERE ofm.operations_file_reference = ?
    LIMIT 1
  ";

  $stmt = $conn->prepare($sqlH);
  $stmt->bind_param('s', $opsRef);
  $stmt->execute();
  $header = $stmt->get_result()->fetch_assoc();

  if (!$header) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'message' => 'Operations file / costing not found for reference']);
    exit;
  }

  // Optional: enforce gating (APPROVED only)
  if (strtoupper((string)$header['costing_status']) !== 'APPROVED_LOCKED') {
    http_response_code(409);
    echo json_encode(['ok' => false, 'message' => 'Costing is not APPROVED for this operations file']);
    exit;
  }

  /**
   * 2) Lines from costing_line (budget = total_ttc)
   */
  $costingId = (string)$header['costing_id'];

  $sqlL = "
    SELECT
      cl.costing_line_id,
      cl.costing_id,
      cl.line_no,
      cl.item_code,
      cl.item_description,
      cl.total_ttc
    FROM costing_line cl
    WHERE cl.costing_id = ?
    ORDER BY cl.line_no ASC
  ";
  $stmt2 = $conn->prepare($sqlL);
  $stmt2->bind_param('s', $costingId);
  $stmt2->execute();
  $rs = $stmt2->get_result();

  $lines = [];
  while ($r = $rs->fetch_assoc()) {
    $lines[] = [
      'costing_line_id' => (string)$r['costing_line_id'],
      'line_no' => (int)$r['line_no'],
      'code' => (string)($r['item_code'] ?? ''),
      'desc' => (string)($r['item_description'] ?? ''),
      'budget_ttc' => (float)($r['total_ttc'] ?? 0),
      // Placeholder until you implement expense dictionary mapping:
      'doc_required' => 0
    ];
  }

  echo json_encode([
    'ok' => true,
    'header' => [
      'operations_file_reference' => (string)$header['operations_file_reference'],
      'client_id' => (string)$header['client_id'],
      'client_name' => (string)$header['client_name'],
      'client_bill_to' => (string)($header['client_bill_to'] ?? ''),
      'service_type' => (string)$header['service_type'],
      'service_territory' => (string)($header['service_territory'] ?? ''),

      'costing_id' => (string)$header['costing_id'],
      'costing_ref' => (string)$header['costing_ref'],
      'costing_total_ttc' => (float)($header['total_ttc'] ?? 0),
      'costing_status' => (string)$header['costing_status'],
    ],
    'lines' => $lines
  ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    'ok' => false,
    'message' => 'Server error in file_context.php',
    'detail' => $e->getMessage()
  ], JSON_UNESCAPED_UNICODE);
}
