<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS','SALES']);
header('Content-Type: application/json; charset=utf-8');

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$conn = db();

try {
  /**
   * Eligible files for OCR creation:
   * - Operations file exists
   * - There is a related costing_master
   * - Costing is APPROVED (your gating)
   *
   * Note: using operations_file_master (NOT operational_file_master)
   */
  $sql = "
  SELECT
    ofm.operations_file_reference,
    ofm.client_id,
    COALESCE(cm.client_name, ofm.client_bill_to, ofm.client_id) AS client_name,
    ofm.service_type,
    ofm.service_territory,

    c.costing_id,
    c.costing_ref,
    c.status AS costing_status
  FROM operations_file_master ofm
  JOIN costing_master c
    ON c.operations_file_reference = ofm.operations_file_reference

  -- EXCLUDE files that already have OCRs (DRAFT and above)
  LEFT JOIN ocr_master om
    ON om.operations_file_reference = ofm.operations_file_reference
    AND om.status IN ('DRAFT','SUBMITTED','VALIDATED','APPROVED')

  LEFT JOIN client_master cm
    ON cm.client_id = ofm.client_id

  WHERE
    c.status = 'APPROVED_LOCKED'
    AND om.ocr_id IS NULL

  ORDER BY ofm.updated_at DESC, ofm.operations_file_reference DESC
  LIMIT 500
";


  $rs = $conn->query($sql);
  $items = [];
  while ($row = $rs->fetch_assoc()) {
    $items[] = [
      'operations_file_reference' => (string)$row['operations_file_reference'],
      'client_id'   => (string)$row['client_id'],
      'client_name' => (string)$row['client_name'],
      'service_type' => (string)$row['service_type'],
      'service_territory' => (string)($row['service_territory'] ?? ''),

      'costing_id'  => (string)$row['costing_id'],
      'costing_ref' => (string)$row['costing_ref'],
      'costing_status' => (string)$row['costing_status'],
    ];
  }

  echo json_encode(['ok' => true, 'items' => $items], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    'ok' => false,
    'message' => 'Server error in files.php',
    'detail' => $e->getMessage(),
  ], JSON_UNESCAPED_UNICODE);
}
