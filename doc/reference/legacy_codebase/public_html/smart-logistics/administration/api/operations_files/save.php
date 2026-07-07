<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function jexit(array $p, int $code = 200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

$payload = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($payload)) {
  jexit(['ok' => false, 'error' => 'Invalid JSON'], 400);
}

/**
 * Accepts:
 * - "YYYY-MM-DDTHH:MM"
 * - "YYYY-MM-DD HH:MM"
 * - "YYYY-MM-DD HH:MM:SS"
 * Returns "YYYY-MM-DD HH:MM:SS" or null
 */
function normalizeDatetime($raw): ?string {
  if ($raw === null) return null;
  if (!is_string($raw)) return null;
  $s = trim($raw);
  if ($s === '') return null;

  $s = str_replace('T', ' ', $s);

  if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $s)) return $s . ':00';
  if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $s)) return $s;

  return null;
}

function normalizeDate($raw): ?string {
  if ($raw === null) return null;
  if (!is_string($raw)) return null;
  $s = trim($raw);
  if ($s === '') return null;
  if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) return $s;
  return null;
}

function normalizeInt($raw): ?int {
  if ($raw === null || $raw === '') return null;
  if (is_int($raw)) return $raw;
  if (is_numeric($raw)) return (int)$raw;
  return null;
}

function normalizeDecimal($raw): ?string {
  if ($raw === null || $raw === '') return null;
  if (is_numeric($raw)) return number_format((float)$raw, 2, '.', '');
  return null;
}

function normalizeBoolInt($raw, int $default = 1): int {
  if ($raw === null) return $default;
  if (is_bool($raw)) return $raw ? 1 : 0;
  $s = strtolower(trim((string)$raw));
  if ($s === '1' || $s === 'true' || $s === 'yes' || $s === 'on') return 1;
  if ($s === '0' || $s === 'false' || $s === 'no' || $s === 'off') return 0;
  return $default;
}

$ref           = trim((string)($payload['ref'] ?? '')); // empty => create
$legacyRefIn   = trim((string)($payload['legacy_reference'] ?? ''));
$oppId         = trim((string)($payload['opportunity_id'] ?? ''));
$clientId      = trim((string)($payload['client_id'] ?? ''));
$serviceType   = trim((string)($payload['service_type'] ?? ''));
$territory     = trim((string)($payload['service_territory'] ?? ''));

$commodityIn   = trim((string)($payload['commodity'] ?? ''));

$grossWeight   = normalizeDecimal($payload['gross_weight'] ?? null);
$weightUnit    = trim((string)($payload['weight_unit'] ?? 'KG'));
$packageCount  = normalizeInt($payload['package_count'] ?? null);

$statusRaw = $payload['operations_status'] ?? null;
$status    = is_string($statusRaw) ? trim($statusRaw) : null;

// top-level expected_delivery_time (already supported)
$expectedDelivery = normalizeDatetime($payload['expected_delivery_time'] ?? null);

$details = $payload['details'] ?? [];
if (!is_array($details)) $details = [];

/* ---------------------------
   Required checks
---------------------------- */
if ($oppId === '' || $clientId === '' || $serviceType === '' || $territory === '') {
  jexit(['ok' => false, 'error' => 'Missing required fields (opportunity_id, client_id, service_type, service_territory)'], 422);
}

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) {
  jexit(['ok' => false, 'error' => 'Session invalid'], 401);
}

/* ---------- Validate Client Exists + Active ---------- */
$cs = $conn->prepare("SELECT client_id FROM client_master WHERE client_id = ? AND status = 'ACTIVE' LIMIT 1");
if (!$cs) jexit(['ok' => false, 'error' => 'DB prepare failed (client check)'], 500);

$cs->bind_param('s', $clientId);
$cs->execute();
$cr = $cs->get_result();
$found = ($cr && $cr->fetch_assoc());
$cs->close();

if (!$found) {
  jexit(['ok' => false, 'error' => 'Invalid client_id (not found or inactive)'], 422);
}

/* ---------- Normalize nullables ---------- */
$legacyRef = ($legacyRefIn !== '') ? $legacyRefIn : null;
$commodity = ($commodityIn !== '') ? $commodityIn : null;

/* ============================================================
   PROMOTE details_json fields into DB columns (authoritative)
============================================================ */
$linkOpportunity = normalizeBoolInt($details['linkOpportunity'] ?? null, 1);

// SSDC fields
$commodityDesc   = trim((string)($details['commodityDesc'] ?? ''));
$commodityDesc   = ($commodityDesc !== '') ? $commodityDesc : null;

$incoterm        = trim((string)($details['incoterm'] ?? ''));
$incoterm        = ($incoterm !== '') ? $incoterm : null;

$marksNumbers    = trim((string)($details['marksNumbers'] ?? ''));
$marksNumbers    = ($marksNumbers !== '') ? $marksNumbers : null;

$placeReceipt    = trim((string)($details['placeReceipt'] ?? ''));
$placeReceipt    = ($placeReceipt !== '') ? $placeReceipt : null;

$placeDelivery   = trim((string)($details['placeDelivery'] ?? ''));
$placeDelivery   = ($placeDelivery !== '') ? $placeDelivery : null;

$eta             = normalizeDatetime($details['etaField'] ?? null);
$ata             = normalizeDatetime($details['ataField'] ?? null);

// If top-level is null, allow details fallback
if ($expectedDelivery === null) {
  $expectedDelivery = normalizeDatetime($details['expectedDeliveryTime'] ?? null);
}

// SEA
$sea_bl      = trim((string)($details['sea_bl'] ?? ''));      $sea_bl      = ($sea_bl !== '') ? $sea_bl : null;
$sea_vessel  = trim((string)($details['sea_vessel'] ?? ''));  $sea_vessel  = ($sea_vessel !== '') ? $sea_vessel : null;
$sea_voyage  = trim((string)($details['sea_voyage'] ?? ''));  $sea_voyage  = ($sea_voyage !== '') ? $sea_voyage : null;
$sea_pol     = trim((string)($details['sea_pol'] ?? ''));     $sea_pol     = ($sea_pol !== '') ? $sea_pol : null;
$sea_pod     = trim((string)($details['sea_pod'] ?? ''));     $sea_pod     = ($sea_pod !== '') ? $sea_pod : null;

// AIR
$air_mawb     = trim((string)($details['air_mawb'] ?? ''));      $air_mawb     = ($air_mawb !== '') ? $air_mawb : null;
$air_airline  = trim((string)($details['air_airline'] ?? ''));   $air_airline  = ($air_airline !== '') ? $air_airline : null;
$air_flightno = trim((string)($details['air_flightno'] ?? ''));  $air_flightno = ($air_flightno !== '') ? $air_flightno : null;
$air_origin   = trim((string)($details['air_origin'] ?? ''));    $air_origin   = ($air_origin !== '') ? $air_origin : null;
$air_dest     = trim((string)($details['air_dest'] ?? ''));      $air_dest     = ($air_dest !== '') ? $air_dest : null;

// INLAND
$inland_truck  = trim((string)($details['inland_truck'] ?? ''));  $inland_truck  = ($inland_truck !== '') ? $inland_truck : null;
$inland_decl   = trim((string)($details['inland_decl'] ?? ''));   $inland_decl   = ($inland_decl !== '') ? $inland_decl : null;
$inland_border = trim((string)($details['inland_border'] ?? '')); $inland_border = ($inland_border !== '') ? $inland_border : null;

// WAREHOUSE
$warehouse_loc     = trim((string)($details['warehouse_loc'] ?? ''));     $warehouse_loc     = ($warehouse_loc !== '') ? $warehouse_loc : null;
$warehouse_bonded  = trim((string)($details['warehouse_bonded'] ?? ''));  $warehouse_bonded  = ($warehouse_bonded !== '') ? $warehouse_bonded : null;
$warehouse_stockin = normalizeDate($details['warehouse_stockin'] ?? null);

// REP
$rep_scope   = trim((string)($details['rep_scope'] ?? ''));   $rep_scope   = ($rep_scope !== '') ? $rep_scope : null;
$rep_contact = trim((string)($details['rep_contact'] ?? '')); $rep_contact = ($rep_contact !== '') ? $rep_contact : null;

/* Generic columns (populate from SEA where applicable) */
$voyage_no        = null;
$port_of_loading  = null;
$port_of_delivery = null;

if (stripos($serviceType, 'SEA') !== false) {
  $voyage_no        = $sea_voyage;
  $port_of_loading  = $sea_pol;
  $port_of_delivery = $sea_pod;
}

/* client_bill_to optional snapshot */
$client_bill_to = trim((string)($details['clientBillTo'] ?? ''));
$client_bill_to = ($client_bill_to !== '' && $client_bill_to !== $clientId) ? $client_bill_to : null;

/* ---------- Reference generator ---------- */
$suffixMap = [
  'SEA_FREIGHT_IMPORT'        => 'SM',
  'SEA_FREIGHT_EXPORT'        => 'SX',
  'AIR_FREIGHT_IMPORT'        => 'AM',
  'AIR_FREIGHT_EXPORT'        => 'AX',
  'HINTERLAND_TRANSIT'        => 'HT',
  'INLAND_TRANSPORTATION'     => 'IT',
  'WAREHOUSING'               => 'WH',
  'END_TO_END_AIR_FREIGHT'    => 'AF',
  'END_TO_END_SEA_FREIGHT'    => 'EF',
  'BUSINESS_REPRESENTATION'   => 'BR'
];
$suffix = $suffixMap[$serviceType] ?? 'XX';

$genRef = function(string $suffix): string {
  $n = random_int(1000000, 9999999);
  return 'SL' . $n . $suffix;
};

$conn->begin_transaction();

try {
  if ($ref === '') {
    $tries = 0;

    do {
      $tries++;
      $ref = $genRef($suffix);

      if ($status === null || $status === '') $status = 'NOT_AWARDED';

      $sql = "
        INSERT INTO operations_file_master (
          operations_file_reference,
          details_json,
          legacy_reference,
          opportunity_id,
          link_opportunity,
          client_id,
          client_bill_to,
          service_type,
          service_territory,
          voyage_no,
          port_of_loading,
          port_of_delivery,
          commodity,
          commodity_desc,
          gross_weight,
          weight_unit,
          incoterm,
          marks_numbers,
          place_receipt,
          place_delivery,
          eta,
          ata,
          sea_bl,
          sea_vessel,
          sea_voyage,
          sea_pol,
          sea_pod,
          air_mawb,
          air_airline,
          air_flightno,
          air_origin,
          air_dest,
          inland_truck,
          inland_decl,
          inland_border,
          warehouse_loc,
          warehouse_bonded,
          warehouse_stockin,
          rep_scope,
          rep_contact,
          package_count,
          operations_status,
          margin,
          created_by_user_id,
          expected_delivery_time
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          0.00,
          ?, ?
        )
      ";

      $stmt = $conn->prepare($sql);
      if (!$stmt) throw new RuntimeException('Prepare failed for INSERT: ' . $conn->error);

      $json = json_encode($details, JSON_UNESCAPED_UNICODE);

      // 44 params (margin is literal 0.00). i at param5 and param43.
      $types = 'ssss' . 'i' . str_repeat('s', 37) . 'i' . 's';

      $stmt->bind_param(
        $types,
        $ref,               // 1
        $json,              // 2
        $legacyRef,         // 3
        $oppId,             // 4
        $linkOpportunity,   // 5 (i)
        $clientId,          // 6
        $client_bill_to,    // 7
        $serviceType,       // 8
        $territory,         // 9
        $voyage_no,         // 10
        $port_of_loading,   // 11
        $port_of_delivery,  // 12
        $commodity,         // 13
        $commodityDesc,     // 14
        $grossWeight,       // 15
        $weightUnit,        // 16
        $incoterm,          // 17
        $marksNumbers,      // 18
        $placeReceipt,      // 19
        $placeDelivery,     // 20
        $eta,               // 21
        $ata,               // 22
        $sea_bl,            // 23
        $sea_vessel,        // 24
        $sea_voyage,        // 25
        $sea_pol,           // 26
        $sea_pod,           // 27
        $air_mawb,          // 28
        $air_airline,       // 29
        $air_flightno,      // 30
        $air_origin,        // 31
        $air_dest,          // 32
        $inland_truck,      // 33
        $inland_decl,       // 34
        $inland_border,     // 35
        $warehouse_loc,     // 36
        $warehouse_bonded,  // 37
        $warehouse_stockin, // 38
        $rep_scope,         // 39
        $rep_contact,       // 40
        $packageCount,      // 41
        $status,            // 42
        $userId,            // 43 (i) created_by_user_id
        $expectedDelivery   // 44 expected_delivery_time
      );

      $ok = $stmt->execute();
      $errno = (int)$stmt->errno;
      $stmt->close();

      if ($ok) break;

      // duplicate ref, retry up to 7 times
      if ($errno !== 1062 || $tries >= 7) {
        throw new RuntimeException('Create failed (errno ' . $errno . ')');
      }
    } while (true);

  } else {
    // UPDATE
    $sql = "
      UPDATE operations_file_master
      SET
        details_json = ?,
        legacy_reference = ?,
        opportunity_id = ?,
        link_opportunity = ?,
        client_id = ?,
        client_bill_to = ?,
        service_type = ?,
        service_territory = ?,
        voyage_no = ?,
        port_of_loading = ?,
        port_of_delivery = ?,
        commodity = ?,
        commodity_desc = ?,
        gross_weight = ?,
        weight_unit = ?,
        incoterm = ?,
        marks_numbers = ?,
        place_receipt = ?,
        place_delivery = ?,
        eta = ?,
        ata = ?,
        sea_bl = ?,
        sea_vessel = ?,
        sea_voyage = ?,
        sea_pol = ?,
        sea_pod = ?,
        air_mawb = ?,
        air_airline = ?,
        air_flightno = ?,
        air_origin = ?,
        air_dest = ?,
        inland_truck = ?,
        inland_decl = ?,
        inland_border = ?,
        warehouse_loc = ?,
        warehouse_bonded = ?,
        warehouse_stockin = ?,
        rep_scope = ?,
        rep_contact = ?,
        package_count = ?,
        operations_status = COALESCE(?, operations_status),
        expected_delivery_time = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE operations_file_reference = ?
      LIMIT 1
    ";

    $stmt = $conn->prepare($sql);
    if (!$stmt) throw new RuntimeException('Prepare failed for UPDATE: ' . $conn->error);

    $json = json_encode($details, JSON_UNESCAPED_UNICODE);

    // 43 params; i at param4, rest s
    $types = 'sssi' . str_repeat('s', 39);

    $stmt->bind_param(
      $types,
      $json,              // 1
      $legacyRef,         // 2
      $oppId,             // 3
      $linkOpportunity,   // 4 (i)
      $clientId,          // 5
      $client_bill_to,    // 6
      $serviceType,       // 7
      $territory,         // 8
      $voyage_no,         // 9
      $port_of_loading,   // 10
      $port_of_delivery,  // 11
      $commodity,         // 12
      $commodityDesc,     // 13
      $grossWeight,       // 14
      $weightUnit,        // 15
      $incoterm,          // 16
      $marksNumbers,      // 17
      $placeReceipt,      // 18
      $placeDelivery,     // 19
      $eta,               // 20
      $ata,               // 21
      $sea_bl,            // 22
      $sea_vessel,        // 23
      $sea_voyage,        // 24
      $sea_pol,           // 25
      $sea_pod,           // 26
      $air_mawb,          // 27
      $air_airline,       // 28
      $air_flightno,      // 29
      $air_origin,        // 30
      $air_dest,          // 31
      $inland_truck,      // 32
      $inland_decl,       // 33
      $inland_border,     // 34
      $warehouse_loc,     // 35
      $warehouse_bonded,  // 36
      $warehouse_stockin, // 37
      $rep_scope,         // 38
      $rep_contact,       // 39
      $packageCount,      // 40
      $status,            // 41
      $expectedDelivery,  // 42
      $ref                // 43
    );

    $stmt->execute();
    if ($stmt->errno) {
      $err = $stmt->error;
      $stmt->close();
      throw new RuntimeException('Update failed: ' . $err);
    }
    $stmt->close();
  }

  $conn->commit();
  jexit(['ok' => true, 'ref' => $ref]);

} catch (Throwable $e) {
  $conn->rollback();
  jexit(['ok' => false, 'error' => $e->getMessage()], 500);
}
