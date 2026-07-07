<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']);

$conn = db();
$ref = must_str($_GET['ref'] ?? null, 'ref');

$sql = "
  SELECT
    ofm.operations_file_reference,
    ofm.client_id,
    cm.client_name,
    ofm.client_bill_to,
    ofm.service_type,
    ofm.service_territory,
    ofm.incoterm,
    ofm.marks_numbers,
    ofm.place_delivery,
    ofm.eta,
    ofm.ata,
    ofm.gross_weight,
    ofm.weight_unit,
    ofm.package_count,
    ofm.sea_bl,
    ofm.sea_vessel,
    ofm.sea_voyage,
    ofm.sea_pol,
    ofm.sea_pod,
    ofm.air_mawb,
    ofm.air_airline,
    ofm.air_flightno,
    ofm.air_origin,
    ofm.air_dest,
    ofm.inland_truck,
    ofm.inland_border,
    ofm.commodity,
    ofm.commodity_desc,
    ofm.operations_status
  FROM operations_file_master ofm
  JOIN client_master cm ON cm.client_id = ofm.client_id
  WHERE ofm.operations_file_reference = ?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $ref);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
if (!$row) json_out(['ok' => false, 'error' => 'Operations file not found'], 404);

json_out(['ok' => true, 'item' => $row]);
