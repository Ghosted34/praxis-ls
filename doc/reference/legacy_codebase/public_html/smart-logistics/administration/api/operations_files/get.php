<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

$ref = trim((string)($_GET['ref'] ?? ''));
if ($ref === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'Missing ref']);
  exit;
}

$sql = "
  SELECT
    m.operations_file_reference,
    m.legacy_reference,
    m.opportunity_id,
    m.client_id,
    c.client_name,
    m.service_type,
    m.service_territory,
    m.commodity,
    m.gross_weight,
    m.weight_unit,
    m.package_count,
    m.operations_status,
    d.details_json
  FROM operations_file_master m
  LEFT JOIN client_master c ON c.client_id = m.client_id
  LEFT JOIN operations_file_master d ON d.operations_file_reference = m.operations_file_reference
  WHERE m.operations_file_reference = ?
  LIMIT 1
";

$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $ref);
$stmt->execute();
$res = $stmt->get_result();
$row = $res ? $res->fetch_assoc() : null;

if (!$row) {
  http_response_code(404);
  echo json_encode(['ok' => false, 'error' => 'Record not found']);
  exit;
}

$details = [];
if (!empty($row['details_json'])) {
  $decoded = json_decode((string)$row['details_json'], true);
  if (is_array($decoded)) $details = $decoded;
}

echo json_encode([
  'ok' => true,
  'record' => [
    'ref' => $row['operations_file_reference'],
    'legacy_reference' => $row['legacy_reference'],
    'opportunity_id' => $row['opportunity_id'],
    'client_id' => $row['client_id'],
    'client_name' => $row['client_name'] ?? null,
    'service_type' => $row['service_type'],
    'service_territory' => $row['service_territory'],
    'commodity' => $row['commodity'],
    'gross_weight' => $row['gross_weight'],
    'weight_unit' => $row['weight_unit'],
    'package_count' => $row['package_count'],
    'operations_status' => $row['operations_status'],
    'details' => $details
  ]
]);
