<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN','OPERATIONS','MANAGEMENT','FINANCE','SALES']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

$ref = trim((string)($_GET['ref'] ?? ''));
if ($ref === '') jexit(['ok'=>false,'error'=>'Missing ref'], 400);

// Exclude NOT_AWARDED
$statuses = ['OPEN','IN_PROGRESS','OPERATIONAL_CLOSED','DELIVERED','CLOSED']; 

try {
  // --- 1. Fetch File Data ---
  $placeholders = implode(',', array_fill(0, count($statuses), '?'));

  $sql = "
    SELECT
      ofm.operations_file_reference,
      ofm.client_id,
      cm.client_name AS client_name,
      ofm.service_type,

      -- SEA fields
      ofm.sea_bl,
      ofm.sea_vessel,
      ofm.sea_voyage,
      ofm.sea_pol,
      ofm.sea_pod,

      -- AIR fields
      ofm.air_mawb,
      ofm.air_airline,
      ofm.air_flightno,
      ofm.air_origin,
      ofm.air_dest,

      -- generic / fallback ports
      ofm.port_of_loading,
      ofm.port_of_delivery,

      -- cargo
      ofm.commodity,
      ofm.commodity_desc,
      ofm.package_count,
      ofm.gross_weight,
      ofm.weight_unit,
      ofm.marks_numbers,

      -- times
      ofm.eta,
      ofm.ata,

      -- delivery
      ofm.place_delivery,
      ofm.place_receipt,

      ofm.operations_status
    FROM operations_file_master ofm
    LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
    WHERE ofm.operations_status IN ($placeholders)
      AND ofm.operations_file_reference = ?
    LIMIT 1
  ";

  $stmt = $conn->prepare($sql);
  if (!$stmt) {
    jexit(['ok'=>false,'error'=>'Prepare failed'], 500);
  }

  $types = str_repeat('s', count($statuses)) . 's';
  $params = array_merge($statuses, [$ref]);
  $stmt->bind_param($types, ...$params);

  if (!$stmt->execute()) {
    jexit(['ok'=>false,'error'=>'Query execute failed'], 500);
  }

  $row = null;
  if (method_exists($stmt, 'get_result')) {
    $res = $stmt->get_result();
    $row = $res ? $res->fetch_assoc() : null;
  } else {
    // Fallback if mysqlnd is missing
    $stmt->store_result();
    // (Variables binding block omitted for brevity, assuming get_result works on your server 
    // or you keep your existing bind_result block here)
    // ... insert your existing bind_result logic here if needed ...
  }

  if (!$row) jexit(['ok'=>false,'error'=>'Not found'], 404);


  // --- 2. Map Data to UI Payload ---
  $service = (string)($row['service_type'] ?? '');
  $isSea = (strpos($service, 'SEA') !== false);
  $isAir = (strpos($service, 'AIR') !== false);

  $docNo = $isSea ? ($row['sea_bl'] ?? '') : ($row['air_mawb'] ?? '');
  if ($docNo === '' || $docNo === null) $docNo = (string)($row['sea_bl'] ?? $row['air_mawb'] ?? '');

  $vesselVoyage = '';
  if ($isSea) {
    $v = trim((string)($row['sea_vessel'] ?? ''));
    $voy = trim((string)($row['sea_voyage'] ?? ''));
    $vesselVoyage = trim($v . ($voy !== '' ? ' / ' . $voy : ''));
  } elseif ($isAir) {
    $al = trim((string)($row['air_airline'] ?? ''));
    $fl = trim((string)($row['air_flightno'] ?? ''));
    $vesselVoyage = trim($al . ($fl !== '' ? ' / ' . $fl : ''));
  }

  $pol = $isSea ? ($row['sea_pol'] ?? '') : ($row['air_origin'] ?? '');
  $pod = $isSea ? ($row['sea_pod'] ?? '') : ($row['air_dest'] ?? '');

  if ($pol === null || trim((string)$pol) === '') $pol = (string)($row['port_of_loading'] ?? '');
  if ($pod === null || trim((string)$pod) === '') $pod = (string)($row['port_of_delivery'] ?? '');

  $desc = (string)($row['commodity_desc'] ?? '');
  if ($desc === '') $desc = (string)($row['commodity'] ?? '');

  $pkgs = ($row['package_count'] !== null && $row['package_count'] !== '') ? (string)$row['package_count'] : '';

  $weight = '';
  if ($row['gross_weight'] !== null && $row['gross_weight'] !== '') {
    $unit = (string)($row['weight_unit'] ?? 'KG');
    $gw = (string)$row['gross_weight'];
    $weight = rtrim(rtrim($gw, '0'), '.') . ' ' . $unit;
  }

  $ata = ($row['ata'] !== null && $row['ata'] !== '') ? (string)$row['ata'] : '';
  $eta = ($row['eta'] !== null && $row['eta'] !== '') ? (string)$row['eta'] : '';

  
  // --- 3. CHECK FOR EXISTING DELIVERY NOTE (NEW LOGIC) ---
  $existingDnNum  = null;
  $existingDnDate = null;

  // We check if this file_ref exists in the delivery_notes table
  // If multiple exist, we take the latest one (ORDER BY id DESC)
  $sqlDN = "SELECT dn_number_full, delivery_date FROM delivery_notes WHERE file_ref = ? ORDER BY id DESC LIMIT 1";
  
  // Create a fresh statement for this query
  if ($stmtDN = $conn->prepare($sqlDN)) {
      $stmtDN->bind_param('s', $row['operations_file_reference']);
      if ($stmtDN->execute()) {
          $resDN = $stmtDN->get_result();
          if ($rowDN = $resDN->fetch_assoc()) {
              $existingDnNum  = $rowDN['dn_number_full'];
              $existingDnDate = $rowDN['delivery_date'];
          }
      }
      $stmtDN->close();
  }


  // --- 4. Final Payload ---
  $payload = [
    'ref' => (string)$row['operations_file_reference'],
    'client' => (string)($row['client_name'] ?? ''),
    'service_type' => $service,
    'doc_no' => (string)$docNo,
    'vessel_voyage' => $vesselVoyage,
    'pol' => (string)$pol,
    'pod' => (string)$pod,
    'ata' => $ata,
    'eta' => $eta,
    'desc' => $desc,
    'pkgs' => $pkgs,
    'weight' => $weight,
    'marks' => (string)($row['marks_numbers'] ?? ''),
    'delivery' => (string)($row['place_delivery'] ?? $pod),
    
    // NEW FIELDS
    'existing_dn_number' => $existingDnNum, // e.g., "002401"
    'existing_dn_date'   => $existingDnDate
  ];

  jexit(['ok'=>true,'data'=>$payload]);

} catch (Throwable $e) {
  jexit([
    'ok'=>false,
    'error'=>'Server error',
    'detail' => $e->getMessage() // Optional: remove in production
  ], 500);
}