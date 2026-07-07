<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN','OPERATIONS','MANAGEMENT','FINANCE']);

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
$statuses = ['OPEN','IN_PROGRESS','OPERATIONAL_CLOSED','DELIVERED','CLOSED']; // adjust to your enum values

try {
  // Build placeholders for statuses
  $placeholders = implode(',', array_fill(0, count($statuses), '?'));

  $sql = "
    SELECT
      ofm.operations_file_reference,
      ofm.client_id,
      cm.client_name AS client_name,   -- safer: use the column you KNOW exists

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

  // bind_param needs a types string: statuses (all strings) + ref (string)
  $types = str_repeat('s', count($statuses)) . 's';
  $params = array_merge($statuses, [$ref]);

  // bind_param with variadics (PHP 5.6+)
  $stmt->bind_param($types, ...$params);

  if (!$stmt->execute()) {
    jexit(['ok'=>false,'error'=>'Query execute failed'], 500);
  }

  // --- Fetch row: prefer get_result if available, otherwise bind_result fallback ---
  $row = null;

  if (method_exists($stmt, 'get_result')) {
    $res = $stmt->get_result();
    $row = $res ? $res->fetch_assoc() : null;
  } else {
    // Fallback if mysqlnd is missing
    $stmt->store_result();

    $cols = [
      'operations_file_reference','client_id','client_name','service_type',
      'sea_bl','sea_vessel','sea_voyage','sea_pol','sea_pod',
      'air_mawb','air_airline','air_flightno','air_origin','air_dest',
      'port_of_loading','port_of_delivery',
      'commodity','commodity_desc','package_count','gross_weight','weight_unit','marks_numbers',
      'eta','ata','place_delivery','place_receipt','operations_status'
    ];

    $bind = [];
    foreach ($cols as $c) { $bind[$c] = null; }

    $stmt->bind_result(
      $bind['operations_file_reference'],
      $bind['client_id'],
      $bind['client_name'],
      $bind['service_type'],

      $bind['sea_bl'],
      $bind['sea_vessel'],
      $bind['sea_voyage'],
      $bind['sea_pol'],
      $bind['sea_pod'],

      $bind['air_mawb'],
      $bind['air_airline'],
      $bind['air_flightno'],
      $bind['air_origin'],
      $bind['air_dest'],

      $bind['port_of_loading'],
      $bind['port_of_delivery'],

      $bind['commodity'],
      $bind['commodity_desc'],
      $bind['package_count'],
      $bind['gross_weight'],
      $bind['weight_unit'],
      $bind['marks_numbers'],

      $bind['eta'],
      $bind['ata'],

      $bind['place_delivery'],
      $bind['place_receipt'],

      $bind['operations_status']
    );

    if ($stmt->fetch()) {
      $row = $bind;
    }
  }

  if (!$row) jexit(['ok'=>false,'error'=>'Not found'], 404);

  // Build UI-friendly mapped payload (DB-only)
  $service = (string)($row['service_type'] ?? '');

  // PHP7+ compatible "contains"
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

  // fallback to generic fields if needed
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
  ];

  jexit(['ok'=>true,'data'=>$payload]);

} catch (Throwable $e) {
  // Avoid leaking internals unless you explicitly want it during debugging.
  jexit([
    'ok'=>false,
    'error'=>'Server error',
    // 'detail'=>$e->getMessage(), // enable only for debugging
  ], 500);
}
