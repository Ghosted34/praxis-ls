<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','SALES','MANAGEMENT','FINANCE','OPERATIONS']);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
  http_response_code(405);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
  exit;
}


header('Content-Type: application/json; charset=utf-8');
$conn = db();

$costingId = trim((string)($_GET['costing_id'] ?? ''));
if ($costingId === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => 'costing_id is required']);
  exit;
}

/**
 * 1) Fetch costing header + ops file + client name
 */
$sql = "
  SELECT
    cm.costing_id,
    cm.costing_ref,
    cm.operations_file_reference,
    cm.client_id,
    cm.client_name_cached,
    cm.client_bill_to,
    cm.service_type,
    cm.service_territory,
    cm.costing_date,
    cm.currency,
    cm.exchange_rate_to_xaf,
    cm.total_ht,
    cm.total_vat,
    cm.total_ttc,
    cm.status,

    ofm.port_of_loading,
    ofm.port_of_delivery,
    ofm.eta,
    ofm.gross_weight,
    ofm.weight_unit,
    ofm.package_count,
    ofm.commodity,
    ofm.marks_numbers,
    ofm.sea_pol,
    ofm.sea_pod,
    ofm.air_origin,
    ofm.air_dest,
    ofm.place_receipt,
    ofm.place_delivery
  FROM costing_master cm
  JOIN operations_file_master ofm ON ofm.operations_file_reference = cm.operations_file_reference
  WHERE cm.costing_id = ?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $costingId);
$stmt->execute();
$hdr = $stmt->get_result()->fetch_assoc();

if (!$hdr) {
  http_response_code(404);
  echo json_encode(['ok' => false, 'message' => 'Costing not found']);
  exit;
}

if ($hdr['status'] !== 'APPROVED_LOCKED') {
  http_response_code(409);
  echo json_encode(['ok' => false, 'message' => 'Costing is not APPROVED']);
  exit;
}

/**
 * Route label logic (simple, deterministic)
 */
$route = '-';
$service = (string)$hdr['service_type'];

if (str_starts_with($service, 'SEA_')) {
  $pol = trim((string)($hdr['sea_pol'] ?? ''));
  $pod = trim((string)($hdr['sea_pod'] ?? ''));
  if ($pol !== '' || $pod !== '') $route = ($pol !== '' ? $pol : '-') . " > " . ($pod !== '' ? $pod : '-');
} elseif (str_starts_with($service, 'AIR_')) {
  $o = trim((string)($hdr['air_origin'] ?? ''));
  $d = trim((string)($hdr['air_dest'] ?? ''));
  if ($o !== '' || $d !== '') $route = ($o !== '' ? $o : '-') . " > " . ($d !== '' ? $d : '-');
} else {
  $pr = trim((string)($hdr['place_receipt'] ?? ''));
  $pd = trim((string)($hdr['place_delivery'] ?? ''));
  if ($pr !== '' || $pd !== '') $route = ($pr !== '' ? $pr : '-') . " > " . ($pd !== '' ? $pd : '-');
}

/**
 * 2) Fetch costing lines (ordered)
 */
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
$stmtL = $conn->prepare($sqlL);
$stmtL->bind_param('s', $costingId);
$stmtL->execute();
$lines = $stmtL->get_result()->fetch_all(MYSQLI_ASSOC);

echo json_encode([
  'ok' => true,
  'header' => [
    'costing_id' => $hdr['costing_id'],
    'costing_ref' => $hdr['costing_ref'],
    'operations_file_reference' => $hdr['operations_file_reference'],
    'client_id' => $hdr['client_id'],
    'client_name' => $hdr['client_name_cached'],
    'service_type' => $hdr['service_type'],
    'service_territory' => $hdr['service_territory'],
    'currency' => $hdr['currency'],
    'exchange_rate_to_xaf' => (float)$hdr['exchange_rate_to_xaf'],
    'totals' => [
      'total_ht' => (float)$hdr['total_ht'],
      'total_vat' => (float)$hdr['total_vat'],
      'total_ttc' => (float)$hdr['total_ttc'],
    ],
  ],
  'ssdc' => [
    'route_label' => $route,
    'eta' => $hdr['eta'],
    'weight' => $hdr['gross_weight'] !== null ? ((string)$hdr['gross_weight'] . ' ' . (string)$hdr['weight_unit']) : null,
    'packages' => $hdr['package_count'],
    'commodity' => $hdr['commodity'],
    'marks' => $hdr['marks_numbers'],
  ],
  'lines' => $lines
]);
