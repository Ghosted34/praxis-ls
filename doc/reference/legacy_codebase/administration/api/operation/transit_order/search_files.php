<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN','OPERATIONS','MANAGEMENT','FINANCE', 'SALES']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

$q = trim((string)($_GET['q'] ?? ''));
$limit = (int)($_GET['limit'] ?? 20);
if ($limit < 5) $limit = 5;
if ($limit > 50) $limit = 50;

// Exclude NOT_AWARDED
$statuses = ['OPEN','IN_PROGRESS','OPERATIONAL_CLOSED','DELIVERED','CLOSED']; // adjust to your enum values

/**
 * Fetch all rows without requiring mysqlnd (no get_result()).
 */
function stmt_fetch_all_assoc(mysqli_stmt $stmt): array {
  $meta = $stmt->result_metadata();
  if (!$meta) return [];

  $fields = $meta->fetch_fields();
  $row = [];
  $bind = [];
  foreach ($fields as $f) {
    $row[$f->name] = null;
    $bind[] = &$row[$f->name];
  }

  call_user_func_array([$stmt, 'bind_result'], $bind);

  $out = [];
  while ($stmt->fetch()) {
    $out[] = array_map(static fn($v) => $v, $row); // copy
  }
  return $out;
}

try {
  $ph = implode(',', array_fill(0, count($statuses), '?'));
  $statusTypes = str_repeat('s', count($statuses));

  // short query -> recent items
  if ($q === '' || strlen($q) < 2) {
    $sql = "
      SELECT
        ofm.operations_file_reference,
        ofm.client_id,
        cm.client_name AS client_name,
        ofm.service_type,
        COALESCE(ofm.sea_bl, ofm.air_mawb) AS doc_no,
        ofm.ata,
        ofm.eta
      FROM operations_file_master ofm
      LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
      WHERE ofm.operations_status IN ($ph)
      ORDER BY COALESCE(ofm.ata, ofm.eta) DESC, ofm.operations_file_reference DESC
      LIMIT ?
    ";

    $stmt = $conn->prepare($sql);
    if (!$stmt) jexit(['ok'=>false,'error'=>'Prepare failed'], 500);

    $types = $statusTypes . 'i';
    $params = array_merge($statuses, [$limit]);
    $stmt->bind_param($types, ...$params);

    if (!$stmt->execute()) jexit(['ok'=>false,'error'=>'Execute failed'], 500);

    $rows = stmt_fetch_all_assoc($stmt);
    jexit(['ok'=>true,'data'=>$rows]);
  }

  $like   = '%' . $q . '%';
  $prefix = $q . '%';

  $sql = "
    SELECT
      ofm.operations_file_reference,
      ofm.client_id,
      cm.client_name AS client_name,
      ofm.service_type,
      COALESCE(ofm.sea_bl, ofm.air_mawb) AS doc_no,
      ofm.ata,
      ofm.eta
    FROM operations_file_master ofm
    LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
    WHERE ofm.operations_status IN ($ph)
      AND (
        ofm.operations_file_reference LIKE ?
        OR ofm.sea_bl LIKE ?
        OR ofm.air_mawb LIKE ?
        OR cm.client_name LIKE ?
      )
    ORDER BY
      CASE
        WHEN ofm.operations_file_reference LIKE ? THEN 1
        WHEN COALESCE(ofm.sea_bl, ofm.air_mawb) LIKE ? THEN 2
        ELSE 3
      END,
      COALESCE(ofm.ata, ofm.eta) DESC
    LIMIT ?
  ";

  $stmt = $conn->prepare($sql);
  if (!$stmt) jexit(['ok'=>false,'error'=>'Prepare failed'], 500);

  // statuses + 6 strings + limit int
  $types = $statusTypes . 'ssssssi';
  $params = array_merge($statuses, [$like, $like, $like, $like, $prefix, $prefix, $limit]);
  $stmt->bind_param($types, ...$params);

  if (!$stmt->execute()) jexit(['ok'=>false,'error'=>'Execute failed'], 500);

  $rows = stmt_fetch_all_assoc($stmt);
  jexit(['ok'=>true,'data'=>$rows]);

} catch (Throwable $e) {
  jexit(['ok'=>false,'error'=>'Server error','detail'=>$e->getMessage()], 500);
}
