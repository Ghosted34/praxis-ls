<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$ref = trim((string)($_GET['ref'] ?? ''));

if ($ref === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'Missing ref']);
  exit;
}

try {
  // ---------------------------------------------------------------------------
  // 1) Fetch Master Record (with collation safety)
  // ---------------------------------------------------------------------------
  $sql = "
    SELECT
      m.*,
      c.client_name
    FROM operations_file_master m
    LEFT JOIN client_master c
      ON c.client_id COLLATE utf8mb4_general_ci = m.client_id COLLATE utf8mb4_general_ci
    WHERE m.operations_file_reference COLLATE utf8mb4_general_ci = ? COLLATE utf8mb4_general_ci
    LIMIT 1
  ";

  $stmt = $conn->prepare($sql);
  $stmt->bind_param('s', $ref);
  $stmt->execute();
  $stmt->store_result();

  if ($stmt->num_rows < 1) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'Record not found']);
    exit;
  }

  // Fetch all columns from m.* plus client_name without get_result()
  $meta = $stmt->result_metadata();
  $fields = $meta->fetch_fields();

  $row = [];
  $bindOut = [];
  foreach ($fields as $f) {
    $row[$f->name] = null;
    $bindOut[] = &$row[$f->name];
  }
  $stmt->bind_result(...$bindOut);
  $stmt->fetch();

  // Decode details_json
  $details = [];
  if (!empty($row['details_json'])) {
    $decoded = json_decode((string)$row['details_json'], true);
    if (is_array($decoded)) $details = $decoded;
  }

  // ---------------------------------------------------------------------------
  // 2) Fetch Documents (ALL VERSIONS)
  // ---------------------------------------------------------------------------
  $docs = [];

  $sqlDocs = "
    SELECT
      doc_uid,
      original_filename,
      stored_path,
      mime_type,
      created_at,
      version_no
    FROM document_vault
    WHERE operations_file_reference COLLATE utf8mb4_general_ci = ? COLLATE utf8mb4_general_ci
    ORDER BY doc_uid ASC, version_no DESC
  ";

  $stmtD = $conn->prepare($sqlDocs);
  $stmtD->bind_param('s', $ref);
  $stmtD->execute();
  $stmtD->store_result();

  $doc_uid = $original_filename = $stored_path = $mime_type = $created_at = null;
  $version_no = 0;

  $stmtD->bind_result($doc_uid, $original_filename, $stored_path, $mime_type, $created_at, $version_no);

  while ($stmtD->fetch()) {
    $docs[] = [
      'id' => $doc_uid,
      'name' => $original_filename,
      'url' => $stored_path,
      'type' => $mime_type,
      'date' => $created_at,
      'version' => (int)$version_no
    ];
  }

  echo json_encode([
    'ok' => true,
    'record' => [
      'ref' => $row['operations_file_reference'] ?? '',
      'client_id' => $row['client_id'] ?? '',
      'client_name' => $row['client_name'] ?? ($row['client_id'] ?? ''),
      'service_type' => $row['service_type'] ?? '',
      'service_territory' => $row['service_territory'] ?? '',
      'operations_status' => $row['operations_status'] ?? '',
      'opportunity_id' => $row['opportunity_id'] ?? null,
      'commodity' => $row['commodity'] ?? null,
      'gross_weight' => $row['gross_weight'] ?? null,
      'weight_unit' => $row['weight_unit'] ?? null,
      'package_count' => $row['package_count'] ?? null,
      'expected_delivery_time' => $row['expected_delivery_time'] ?? null,
      'details' => $details,
      'documents' => $docs
    ]
  ], JSON_UNESCAPED_UNICODE);

  exit;

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    'ok' => false,
    'error' => 'Details fetch failed',
    'detail' => $e->getMessage()
  ], JSON_UNESCAPED_UNICODE);
  exit;
}
