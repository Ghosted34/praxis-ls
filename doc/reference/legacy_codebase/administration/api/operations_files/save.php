<?php
declare(strict_types=1);
if (function_exists('set_time_limit')) {
    set_time_limit(300); 
}

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

if (session_status() === PHP_SESSION_NONE) session_start();

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => $ok], $extra));
  exit;
}

function norm_str($v): ?string {
  $s = trim((string)($v ?? ''));
  return $s === '' ? null : $s;
}

function require_str($v, string $field): string {
  $s = trim((string)($v ?? ''));
  if ($s === '') out(false, ['error' => "Missing required field: {$field}"], 422);
  return $s;
}

function to_int_or_null($v): ?int {
  if ($v === null) return null;
  $s = trim((string)$v);
  if ($s === '') return null;
  if (!preg_match('/^-?\d+$/', $s)) return null;
  return (int)$s;
}

function to_float_or_null($v): ?float {
  if ($v === null) return null;
  $s = trim((string)$v);
  if ($s === '') return null;
  if (!is_numeric($s)) return null;
  return (float)$s;
}

// FIX: Robust Date Normalizer for MySQL DATETIME
function normalize_datetime_or_null($v): ?string {
  $s = trim((string)($v ?? ''));
  if ($s === '') return null;

  // Replace HTML5 'T' separator with space
  $s = str_replace('T', ' ', $s);

  // Case 1: Full DATETIME (2026-01-24 14:30:00)
  if (preg_match('/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/', $s)) {
    return $s;
  }

  // Case 2: No Seconds (2026-01-24 14:30) -> Add :00
  if (preg_match('/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/', $s)) {
    return $s . ':00';
  }

  // Case 3: Date Only (2026-01-24) -> Add 00:00:00
  if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
    return $s . ' 00:00:00';
  }

  return null; // Invalid format
}

function uuid_v4(): string {
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  $hex = bin2hex($data);
  return sprintf('%s-%s-%s-%s-%s',
    substr($hex, 0, 8),
    substr($hex, 8, 4),
    substr($hex, 12, 4),
    substr($hex, 16, 4),
    substr($hex, 20, 12)
  );
}

function suffix_for_service(string $serviceType): string {
  $map = [
    'SEA_FREIGHT_IMPORT'        => 'SM',
    'SEA_FREIGHT_EXPORT'        => 'SX',
    'AIR_FREIGHT_IMPORT'        => 'AM',
    'AIR_FREIGHT_EXPORT'        => 'AX',
    'HINTERLAND_TRANSIT'        => 'HT',
    'INLAND_TRANSPORTATION'     => 'IT',
    'WAREHOUSING'               => 'WH',
    'END_TO_END_AIR_FREIGHT'    => 'AF',
    'END_TO_END_SEA_FREIGHT'    => 'EF',
    'BUSINESS_REPRESENTATION'   => 'BR',
  ];
  $k = strtoupper(trim($serviceType));
  return $map[$k] ?? 'XX';
}

function generate_ops_ref(mysqli $conn, string $serviceType): string {
  $suffix = suffix_for_service($serviceType);
  $stmt = $conn->prepare("SELECT 1 FROM operations_file_master WHERE operations_file_reference = ? LIMIT 1");

  for ($i = 0; $i < 25; $i++) {
    $digits = (string)random_int(1000000, 9999999);
    $ref = 'SL' . $digits . $suffix;

    $stmt->bind_param('s', $ref);
    $stmt->execute();
    $stmt->store_result();
    $exists = $stmt->num_rows > 0;
    $stmt->free_result();

    if (!$exists) {
      $stmt->close();
      return $ref;
    }
  }
  $stmt->close();
  return 'SL' . (string)random_int(1000000, 9999999) . $suffix;
}

/** dynamic bind_param helper */
function bind_stmt(mysqli_stmt $stmt, string $types, array &$params): void {
  $bind = [];
  $bind[] = $types;
  foreach ($params as &$v) $bind[] = &$v;

  if (!call_user_func_array([$stmt, 'bind_param'], $bind)) {
    throw new RuntimeException('bind_param failed');
  }
}

try {
  $userId = (int)($_SESSION['auth']['user_id'] ?? 0);
  if ($userId <= 0) out(false, ['error' => 'Unauthenticated'], 401);

  $raw = file_get_contents('php://input');
  $data = json_decode($raw ?: '', true);
  if (!is_array($data)) out(false, ['error' => 'Invalid JSON body'], 400);

  $conn = db();
  @$conn->set_charset('utf8mb4');

  $ref              = norm_str($data['ref'] ?? null);
  $legacyReference  = norm_str($data['legacy_reference'] ?? null);

  $clientId         = require_str($data['client_id'] ?? null, 'client_id');
  $serviceType      = require_str($data['service_type'] ?? null, 'service_type');
  $serviceTerritory = require_str($data['service_territory'] ?? null, 'service_territory');

  // --- FETCH CLIENT NAME AUTOMATICALLY ---
  $stmtCN = $conn->prepare("SELECT client_name FROM client_master WHERE client_id = ? LIMIT 1");
  if ($stmtCN) {
      $stmtCN->bind_param('s', $clientId);
      $stmtCN->execute();
      $stmtCN->bind_result($fetchedClientName);
      $stmtCN->fetch();
      $stmtCN->close();
  }
  $clientName = $fetchedClientName ?? null; 
  if ($clientName === null) {
      out(false, ['error' => "Client ID '{$clientId}' not found in registry. Please create the client first."], 422);
  }
  // --------------------------------------------

  $commodity         = norm_str($data['commodity'] ?? null);
  $grossWeight       = to_float_or_null($data['gross_weight'] ?? null);

  // DB enum: KG | TON | LB ; UI might send TONNE
  $weightUnitRaw = strtoupper(trim((string)($data['weight_unit'] ?? 'KG')));
  if ($weightUnitRaw === 'TONNE') $weightUnitRaw = 'TON';
  if ($weightUnitRaw === '') $weightUnitRaw = 'KG';
  if (!in_array($weightUnitRaw, ['KG','TON','LB'], true)) {
    out(false, ['error' => 'Invalid weight_unit. Allowed: KG, TON, LB'], 422);
  }
  $weightUnit = $weightUnitRaw;

  $packageCount     = to_int_or_null($data['package_count'] ?? null);
  $operationsStatus = norm_str($data['operations_status'] ?? null) ?? 'OPEN';
  
  // FIX: Using robust date normalizer
  $expectedDelivery = normalize_datetime_or_null($data['expected_delivery_time'] ?? null);

  $details = $data['details'] ?? [];
  if (!is_array($details)) $details = [];

  $linkOpportunity = !empty($details['linkOpportunity']) ? 1 : 0;

  $opportunityId = norm_str($data['opportunity_id'] ?? null);
  if ($linkOpportunity === 1) {
    $opportunityId = require_str($opportunityId, 'opportunity_id');
  } else {
    // If not linking, generate a UUID for the NOT NULL constraint (or you can relax db constraint)
    if ($opportunityId === null) $opportunityId = uuid_v4(); 
  }

  $commodityDesc  = norm_str($details['commodityDesc'] ?? null);
  $incoterm       = norm_str($details['incoterm'] ?? null);
  $marksNumbers   = norm_str($details['marksNumbers'] ?? null);
  $placeReceipt   = norm_str($details['placeReceipt'] ?? null);
  $placeDelivery  = norm_str($details['placeDelivery'] ?? null);
  
  // FIX: Robust Date Normalizer for ETA/ATA
  $eta            = normalize_datetime_or_null($details['etaField'] ?? null);
  $ata            = normalize_datetime_or_null($details['ataField'] ?? null);

  // Sea Fields
  $seaBl     = norm_str($details['sea_bl'] ?? null);
  $seaVessel = norm_str($details['sea_vessel'] ?? null);
  $seaVoyage = norm_str($details['sea_voyage'] ?? null);
  $seaPol    = norm_str($details['sea_pol'] ?? null);
  $seaPod    = norm_str($details['sea_pod'] ?? null);

  // Air Fields
  $airMawb    = norm_str($details['air_mawb'] ?? null);
  $airAirline = norm_str($details['air_airline'] ?? null);
  $airFlight  = norm_str($details['air_flightno'] ?? null);
  $airOrigin  = norm_str($details['air_origin'] ?? null);
  $airDest    = norm_str($details['air_dest'] ?? null);

  // Inland/Hinterland Fields
  $inlandTruck  = norm_str($details['inland_truck'] ?? null);
  $inlandDecl   = norm_str($details['inland_decl'] ?? null);
  $inlandBorder = norm_str($details['inland_border'] ?? null);

  // Warehouse Fields
  $warehouseLoc     = norm_str($details['warehouse_loc'] ?? null);
  $warehouseBonded  = norm_str($details['warehouse_bonded'] ?? null);
  $warehouseStockin = norm_str($details['warehouse_stockin'] ?? null); // Likely date-only

  // Business Rep Fields
  $repScope   = norm_str($details['rep_scope'] ?? null);
  $repContact = norm_str($details['rep_contact'] ?? null);

  // General Fields
  $voyageNo       = norm_str($details['voyage_no'] ?? null);
  $portOfLoading  = norm_str($details['port_of_loading'] ?? null);
  $portOfDelivery = norm_str($details['port_of_delivery'] ?? null);
  $clientBillTo   = norm_str($details['client_bill_to'] ?? null);

  $detailsJson = json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($detailsJson === false) out(false, ['error' => 'Failed to encode details_json'], 500);

  $grossWeightStr     = ($grossWeight === null) ? null : number_format($grossWeight, 2, '.', '');
  $packageCountStr    = ($packageCount === null) ? null : (string)$packageCount;

  $conn->begin_transaction();

  if ($ref === null) {
    // =========================
    // CREATE (INSERT)
    // =========================
    $newRef = generate_ops_ref($conn, $serviceType);

    $sql = "
      INSERT INTO operations_file_master (
        operations_file_reference, details_json, legacy_reference,
        opportunity_id, link_opportunity,
        client_id, client_name, client_bill_to,
        service_type, service_territory,
        voyage_no, port_of_loading, port_of_delivery,
        commodity, commodity_desc,
        gross_weight, weight_unit,
        incoterm, marks_numbers,
        place_receipt, place_delivery,
        eta, ata,
        sea_bl, sea_vessel, sea_voyage, sea_pol, sea_pod,
        air_mawb, air_airline, air_flightno, air_origin, air_dest,
        inland_truck, inland_decl, inland_border,
        warehouse_loc, warehouse_bonded, warehouse_stockin,
        rep_scope, rep_contact,
        package_count,
        operations_status,
        margin,
        created_by_user_id,
        created_at,
        expected_delivery_time,
        current_stage_index
      ) VALUES (
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?,
        ?,
        0.00,
        ?,
        NOW(),
        ?,
        0
      )
    ";

    $stmt = $conn->prepare($sql);

    $params = [
      $newRef, $detailsJson, $legacyReference,
      $opportunityId, $linkOpportunity,
      $clientId, $clientName, $clientBillTo,
      $serviceType, $serviceTerritory,
      $voyageNo, $portOfLoading, $portOfDelivery,
      $commodity, $commodityDesc,
      $grossWeightStr, $weightUnit,
      $incoterm, $marksNumbers,
      $placeReceipt, $placeDelivery,
      $eta, $ata,
      $seaBl, $seaVessel, $seaVoyage, $seaPol, $seaPod,
      $airMawb, $airAirline, $airFlight, $airOrigin, $airDest,
      $inlandTruck, $inlandDecl, $inlandBorder,
      $warehouseLoc, $warehouseBonded, $warehouseStockin,
      $repScope, $repContact,
      $packageCountStr,
      $operationsStatus,
      $userId,
      $expectedDelivery
    ];

    $ph = substr_count($sql, '?');
    if ($ph !== count($params)) {
      throw new RuntimeException("INSERT placeholder mismatch: placeholders={$ph}, params=" . count($params));
    }

    // Types string construction
    // 45 params total
    // 'i' at index 4 (linkOpportunity) and 43 (userId)
    $types = str_repeat('s', count($params));
    $types[4] = 'i'; 
    $types[43] = 'i'; 

    bind_stmt($stmt, $types, $params);
    $stmt->execute();
    $stmt->close();

    $conn->commit();

    out(true, [
      'ref' => $newRef,
      'opportunity_id' => $opportunityId,
      'link_opportunity' => $linkOpportunity
    ]);
  }

  // =========================
  // UPDATE
  // =========================
  $refUpd = $ref;

  $chk = $conn->prepare("SELECT 1 FROM operations_file_master WHERE operations_file_reference = ? LIMIT 1");
  $chk->bind_param('s', $refUpd);
  $chk->execute();
  $chk->store_result();
  if ($chk->num_rows === 0) {
    $chk->close();
    $conn->rollback();
    out(false, ['error' => 'Record not found'], 404);
  }
  $chk->close();

  $sqlU = "
    UPDATE operations_file_master
    SET
      details_json = ?,
      legacy_reference = ?,
      opportunity_id = ?,
      link_opportunity = ?,
      client_id = ?,
      client_name = ?,
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
      operations_status = ?,
      expected_delivery_time = ?,
      updated_at = NOW()
    WHERE operations_file_reference = ?
    LIMIT 1
  ";

  $stmtU = $conn->prepare($sqlU);

  $paramsU = [
    $detailsJson,
    $legacyReference,
    $opportunityId,
    $linkOpportunity,
    $clientId,
    $clientName,
    $clientBillTo,
    $serviceType,
    $serviceTerritory,
    $voyageNo,
    $portOfLoading,
    $portOfDelivery,
    $commodity,
    $commodityDesc,
    $grossWeightStr,
    $weightUnit,
    $incoterm,
    $marksNumbers,
    $placeReceipt,
    $placeDelivery,
    $eta,
    $ata,
    $seaBl,
    $seaVessel,
    $seaVoyage,
    $seaPol,
    $seaPod,
    $airMawb,
    $airAirline,
    $airFlight,
    $airOrigin,
    $airDest,
    $inlandTruck,
    $inlandDecl,
    $inlandBorder,
    $warehouseLoc,
    $warehouseBonded,
    $warehouseStockin,
    $repScope,
    $repContact,
    $packageCountStr,
    $operationsStatus,
    $expectedDelivery,
    $refUpd
  ];

  $phU = substr_count($sqlU, '?');
  if ($phU !== count($paramsU)) {
    throw new RuntimeException("UPDATE placeholder mismatch: placeholders={$phU}, params=" . count($paramsU));
  }

  $typesU = str_repeat('s', count($paramsU));
  $typesU[3] = 'i'; // linkOpportunity

  bind_stmt($stmtU, $typesU, $paramsU);
  $stmtU->execute();
  $stmtU->close();

  $conn->commit();

  out(true, [
    'ref' => $refUpd,
    'opportunity_id' => $opportunityId,
    'link_opportunity' => $linkOpportunity
  ]);

} catch (Throwable $e) {
  try {
    if (isset($conn) && $conn instanceof mysqli) {
      @$conn->rollback();
    }
  } catch (Throwable $_) {}

  out(false, [
    'error' => 'Server error',
    'debug' => $e->getMessage(),
    'line'  => $e->getLine(),
  ], 500);
}