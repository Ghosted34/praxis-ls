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
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
  // ... keep existing code, but wrap the main body in try
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    'ok' => false,
    'message' => 'Server error in get-costing-ssdc.php',
    'detail' => $e->getMessage(),
    'file' => basename($e->getFile()),
    'line' => $e->getLine()
  ], JSON_UNESCAPED_SLASHES);
  exit;
}


$costingId = trim((string)($_GET['costing_id'] ?? ''));
if ($costingId === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => 'costing_id is required']);
  exit;
}

/**
 * 1) Fetch costing header + ops file + client (from client_master)
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

    -- Client Master fields (for print)
    cma.client_name        AS client_name_master,
    cma.contact_person     AS client_contact_person,
    cma.contact_email      AS client_contact_email,
    cma.contact_phone      AS client_contact_phone,
    cma.niu                AS client_niu,
    cma.rccm               AS client_rccm,
    cma.address            AS client_address,
    cma.country            AS client_country,
    cma.payment_terms_days AS client_payment_terms_days,

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
    ofm.place_delivery,

    ofm.sea_bl,
    ofm.air_mawb,
    ofm.inland_decl,

    ofm.sea_vessel,
    ofm.sea_voyage,

    ofm.air_airline,
    ofm.air_flightno,

    ofm.inland_truck

  FROM costing_master cm
  JOIN operations_file_master ofm
    ON ofm.operations_file_reference = cm.operations_file_reference
  LEFT JOIN client_master cma
  ON BINARY cma.client_id = BINARY cm.client_id
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

if (($hdr['status'] ?? '') !== 'APPROVED_LOCKED') {
  http_response_code(409);
  echo json_encode(['ok' => false, 'message' => 'Costing is not APPROVED']);
  exit;
}

/**
 * Route label logic (simple, deterministic)
 */
$route = '-';
$service = (string)($hdr['service_type'] ?? '');

if (function_exists('str_starts_with') && str_starts_with($service, 'SEA_')) {
  $pol = trim((string)($hdr['sea_pol'] ?? ''));
  $pod = trim((string)($hdr['sea_pod'] ?? ''));
  if ($pol !== '' || $pod !== '') $route = ($pol !== '' ? $pol : '-') . " > " . ($pod !== '' ? $pod : '-');
} elseif (function_exists('str_starts_with') && str_starts_with($service, 'AIR_')) {
  $o = trim((string)($hdr['air_origin'] ?? ''));
  $d = trim((string)($hdr['air_dest'] ?? ''));
  if ($o !== '' || $d !== '') $route = ($o !== '' ? $o : '-') . " > " . ($d !== '' ? $d : '-');
} else {
  $pr = trim((string)($hdr['place_receipt'] ?? ''));
  $pd = trim((string)($hdr['place_delivery'] ?? ''));
  if ($pr !== '' || $pd !== '') $route = ($pr !== '' ? $pr : '-') . " > " . ($pd !== '' ? $pd : '-');
}

$pod = trim((string)($hdr['place_delivery'] ?? ''));

$transportRef = '';
if (trim((string)($hdr['sea_bl'] ?? '')) !== '') {
  $transportRef = trim((string)$hdr['sea_bl']);
} elseif (trim((string)($hdr['air_mawb'] ?? '')) !== '') {
  $transportRef = trim((string)$hdr['air_mawb']);
} elseif (trim((string)($hdr['inland_decl'] ?? '')) !== '') {
  $transportRef = trim((string)$hdr['inland_decl']);
}

$conveyance = '';
$seaVessel = trim((string)($hdr['sea_vessel'] ?? ''));
$seaVoyage = trim((string)($hdr['sea_voyage'] ?? ''));
$airLine   = trim((string)($hdr['air_airline'] ?? ''));
$airFlight = trim((string)($hdr['air_flightno'] ?? ''));
$truck     = trim((string)($hdr['inland_truck'] ?? ''));

if ($seaVessel !== '' || $seaVoyage !== '') {
  $conveyance = ($seaVessel !== '' ? $seaVessel : '-') . '/' . ($seaVoyage !== '' ? $seaVoyage : '-');
} elseif ($airLine !== '' || $airFlight !== '') {
  $conveyance = ($airLine !== '' ? $airLine : '-') . '/' . ($airFlight !== '' ? $airFlight : '-');
} elseif ($truck !== '') {
  $conveyance = $truck;
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

/**
 * Prefer client_master name; fallback to cached (for robustness)
 */
$clientName = '';
if (isset($hdr['client_name_master']) && trim((string)$hdr['client_name_master']) !== '') {
  $clientName = (string)$hdr['client_name_master'];
} else {
  $clientName = (string)($hdr['client_name_cached'] ?? '');
}

echo json_encode([
  'ok' => true,
  'header' => [
    'costing_id' => $hdr['costing_id'],
    'costing_ref' => $hdr['costing_ref'],
    'operations_file_reference' => $hdr['operations_file_reference'],
    'client_id' => $hdr['client_id'],

    // client identity
    'client_name' => $clientName,

    // service
    'service_type' => $hdr['service_type'],
    'service_territory' => $hdr['service_territory'],

    // money
    'currency' => $hdr['currency'],
    'exchange_rate_to_xaf' => (float)($hdr['exchange_rate_to_xaf'] ?? 0),

    // totals from costing header (not simulation)
    'totals' => [
      'total_ht' => (float)($hdr['total_ht'] ?? 0),
      'total_vat' => (float)($hdr['total_vat'] ?? 0),
      'total_ttc' => (float)($hdr['total_ttc'] ?? 0),
    ],

    // ✅ client_master fields (for quotation/analysis print)
    'client_contact' => $hdr['client_contact_person'] ?? null,
    'client_email'   => $hdr['client_contact_email'] ?? null,
    'client_phone'   => $hdr['client_contact_phone'] ?? null,
    'client_niu'     => $hdr['client_niu'] ?? null,
    'client_rccm'    => $hdr['client_rccm'] ?? null,
    'client_address' => $hdr['client_address'] ?? null,
    'client_country' => $hdr['client_country'] ?? null,
    'client_payment_terms_days' => isset($hdr['client_payment_terms_days'])
      ? (int)$hdr['client_payment_terms_days']
      : null,
  ],
  'ssdc' => [
    'route_label' => $route,
    'eta' => $hdr['eta'] ?? null,
    'weight' => ($hdr['gross_weight'] !== null)
      ? ((string)$hdr['gross_weight'] . ' ' . (string)($hdr['weight_unit'] ?? ''))
      : null,
    'packages' => $hdr['package_count'] ?? null,
    'commodity' => $hdr['commodity'] ?? null,
    'marks' => $hdr['marks_numbers'] ?? null,
        'pod' => $pod !== '' ? $pod : null,
    'transport_ref' => $transportRef !== '' ? $transportRef : null,
    'conveyance' => $conveyance !== '' ? $conveyance : null,
  ],
  'lines' => $lines
], JSON_UNESCAPED_SLASHES);
