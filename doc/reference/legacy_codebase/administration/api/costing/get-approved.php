<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';

require_role(['ADMIN','MANAGEMENT','SALES','FINANCE','OPERATIONS']);
header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$costingId = (string)($_GET['costing_id'] ?? '');
if ($costingId === '') {
  http_response_code(400);
  echo json_encode(['ok'=>false,'error'=>'costing_id required']);
  exit;
}

$sqlH = "
  SELECT
    cm.costing_id,
    cm.costing_ref,
    cm.operations_file_reference,
    cm.client_id,
    cm.client_name_cached,
    cm.client_bill_to,
    cm.service_type,
    cm.service_territory,
    cm.currency,
    cm.exchange_rate_to_xaf,
    cm.total_ht,
    cm.total_vat,
    cm.total_ttc,
    cm.status,
    cm.costing_date,

    ofm.port_of_loading,
    ofm.port_of_delivery,
    ofm.sea_pol,
    ofm.sea_pod,
    ofm.eta,
    ofm.gross_weight,
    ofm.weight_unit,
    ofm.package_count,
    ofm.commodity,
    ofm.marks_numbers
  FROM costing_master cm
  LEFT JOIN operations_file_master ofm
    ON ofm.operations_file_reference = cm.operations_file_reference
  WHERE cm.costing_id = ? AND cm.status = 'APPROVED'
  LIMIT 1
";
$stmt = $conn->prepare($sqlH);
$stmt->bind_param('s', $costingId);
$stmt->execute();
$header = $stmt->get_result()->fetch_assoc();

if (!$header) {
  http_response_code(404);
  echo json_encode(['ok'=>false,'error'=>'Approved costing not found']);
  exit;
}

// lines
$sqlL = "
  SELECT
    cl.costing_line_id,
    cl.line_no,
    cl.item_code,
    cl.item_description,
    cl.qty,
    cl.unit_cost,
    cl.vat_applicable,
    cl.vat_rate,
    cl.total_ht,
    cl.total_vat,
    cl.total_ttc
  FROM costing_line cl
  WHERE cl.costing_id = ?
  ORDER BY cl.line_no ASC
";
$stmt2 = $conn->prepare($sqlL);
$stmt2->bind_param('s', $costingId);
$stmt2->execute();

$lines = [];
$res2 = $stmt2->get_result();
while ($row = $res2->fetch_assoc()) $lines[] = $row;

echo json_encode(['ok'=>true,'header'=>$header,'lines'=>$lines], JSON_UNESCAPED_UNICODE);
