<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT', 'OPERATIONS', 'SALES']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

$ref = trim((string)($_GET['ref'] ?? ''));
if ($ref === '') jexit(['ok'=>false,'error'=>'Missing ref'], 400);

try {
  $sql = "
    SELECT
      ofm.operations_file_reference,
      ofm.client_id,
      cm.client_name,
      ofm.client_bill_to,
      ofm.service_type,
      ofm.service_territory,

      ofm.voyage_no,
      ofm.marks_numbers,
      ofm.eta,
      ofm.ata,
      ofm.gross_weight,
      ofm.weight_unit,
      ofm.package_count,
      ofm.place_delivery,
      ofm.commodity,
      ofm.commodity_desc,

      ofm.sea_bl, ofm.sea_vessel, ofm.sea_voyage, ofm.sea_pol, ofm.sea_pod,
      ofm.air_mawb, ofm.air_airline, ofm.air_flightno, ofm.air_origin, ofm.air_dest,
      ofm.inland_truck, ofm.inland_decl, ofm.inland_border

    FROM operations_file_master ofm
    JOIN client_master cm ON cm.client_id = ofm.client_id
    WHERE ofm.operations_file_reference = ?
    LIMIT 1
  ";

  $stmt = $conn->prepare($sql);
  if (!$stmt) jexit(['ok'=>false,'error'=>'Prepare failed'], 500);
  $stmt->bind_param('s', $ref);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();

  if (!$row) jexit(['ok'=>false,'error'=>'Operations file not found'], 404);

  jexit(['ok'=>true,'item'=>$row]);
} catch (Throwable $e) {
  jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
}
