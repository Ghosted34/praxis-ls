<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS']); // adjust to your policy

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

/**
 * CONFIG: change table/column names here if yours differ.
 */
const COSTINGS_TABLE = 'finance_costings';
const ID_COL         = 'costing_id';
const PREFIX         = 'SLAS-COST-';
const PAD_LEN        = 7; // SLAS-COST-001401 (6 digits?) you can set 6/7 to match your standard

// Find max numeric suffix from IDs like "SLAS-COST-0000123"
$sql = "
  SELECT MAX(CAST(SUBSTRING_INDEX(" . ID_COL . ", '-', -1) AS UNSIGNED)) AS max_n
  FROM " . COSTINGS_TABLE . "
  WHERE " . ID_COL . " LIKE CONCAT(?, '%')
  LIMIT 1
";

$stmt = $conn->prepare($sql);
if (!$stmt) jexit(['ok'=>false,'error'=>'DB prepare failed: '.$conn->error], 500);

$stmt->bind_param('s', $prefix = PREFIX);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

$maxN = (int)($row['max_n'] ?? 0);
$nextN = $maxN + 1;

// If you want to start from a baseline, set it here.
if ($nextN < 1) $nextN = 1;

$nextId = PREFIX . str_pad((string)$nextN, PAD_LEN, '0', STR_PAD_LEFT);

jexit([
  'ok' => true,
  'data' => [
    'next_id' => $nextId,
    'next_n'  => $nextN,
  ]
]);
