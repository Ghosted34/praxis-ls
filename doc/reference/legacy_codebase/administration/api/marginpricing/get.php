<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','MANAGEMENT','SALES','FINANCE','OPERATIONS']);
header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$simRef = trim((string)($_GET['simulation_ref'] ?? ''));
$simId  = trim((string)($_GET['id'] ?? ''));

if ($simRef === '' && $simId === '') {
  http_response_code(400);
  echo json_encode(['ok'=>false,'error'=>'simulation_ref or id required']);
  exit;
}

/**
 * 1) Load simulation header
 */
$sql = "
  SELECT *
  FROM marginpricing_simulations
  WHERE " . ($simId !== '' ? "id = ?" : "simulation_ref = ?") . "
  LIMIT 1
";
$stmt = $conn->prepare($sql);
$lookup = ($simId !== '' ? $simId : $simRef);
$stmt->bind_param('s', $lookup);
$stmt->execute();

$sim = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$sim) {
  http_response_code(404);
  echo json_encode(['ok'=>false,'error'=>'Simulation not found']);
  exit;
}

/**
 * 2) Load lines
 *
 * IMPORTANT PATCH:
 * - Return canonical DB columns (cost_total_xaf, selling_total_xaf, cost_total_ht, sell_total_ht)
 * - Keep convenience fallbacks (cost_xaf, selling_xaf) for compatibility
 */
$sqlL = "
  SELECT
    id AS line_id,
    line_no,
    item_code AS code,
    item_description AS description,
    qty,

    -- canonical DB columns (frontend needs these to rehydrate correctly)
    cost_total_xaf,
    selling_total_xaf,
    cost_total_ht,
    sell_total_ht,

    -- compatibility / fallback aliases
    CASE
      WHEN cost_total_xaf IS NOT NULL AND cost_total_xaf > 0 THEN cost_total_xaf
      ELSE cost_total_ht
    END AS cost_xaf,

    CASE
      WHEN selling_total_xaf IS NOT NULL AND selling_total_xaf > 0 THEN selling_total_xaf
      ELSE sell_total_ht
    END AS selling_xaf,

    vat_applicable AS apply_vat,
    vat_rate,
    quote_remarks,
    print_on_quote AS client_facing,
    is_ad_hoc AS is_adhoc
  FROM marginpricing_simulation_lines
  WHERE marginpricing_simulation_id = ?
  ORDER BY line_no ASC
";

$stmt2 = $conn->prepare($sqlL);
$simIdInt = (int)($sim['id'] ?? 0);
$stmt2->bind_param('i', $simIdInt);
$stmt2->execute();

$lines = [];
$res2 = $stmt2->get_result();
while ($row = $res2->fetch_assoc()) {
  $lines[] = $row;
}
$stmt2->close();

echo json_encode(
  ['ok'=>true, 'simulation'=>$sim, 'lines'=>$lines],
  JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
);
