<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES','FINANCE','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$conn = db();

function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => $ok], $extra));
  exit;
}

$q = trim((string)($_GET['q'] ?? ''));

$sql = "
  SELECT
    costing_id,
    costing_ref,
    operations_file_reference,
    client_id,
    client_name_cached,
    service_type,
    currency,
    exchange_rate_to_xaf,
    total_ttc,
    approved_at
  FROM costing_master
  WHERE status = 'Locked'
    AND approved_by_user_id IS NOT NULL
    AND approved_at IS NOT NULL
    " . ($q !== '' ? "AND (costing_id LIKE CONCAT('%', ?, '%') OR costing_ref LIKE CONCAT('%', ?, '%') OR client_name_cached LIKE CONCAT('%', ?, '%') OR operations_file_reference LIKE CONCAT('%', ?, '%'))" : "") . "
  ORDER BY approved_at DESC
  LIMIT 200
";

$stmt = $conn->prepare($sql);
if ($q !== '') {
  $stmt->bind_param('ssss', $q, $q, $q, $q);
}
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

out(true, ['items' => $rows]);
