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

$id = trim((string)($_GET['id'] ?? ''));
if ($id === '') jexit(['ok'=>false,'error'=>'Missing id'], 400);

try {
  // Detect whether id is UUID or costing_ref
  $isUuid = (bool)preg_match('/^[0-9a-fA-F\-]{36}$/', $id);

  if ($isUuid) {
    $sqlM = "SELECT * FROM costing_master WHERE costing_id = ? LIMIT 1";
  } else {
    $sqlM = "SELECT * FROM costing_master WHERE costing_ref = ? LIMIT 1";
  }

  $stM = $conn->prepare($sqlM);
  if (!$stM) jexit(['ok'=>false,'error'=>'Prepare failed'], 500);
  $stM->bind_param('s', $id);
  $stM->execute();
  $master = $stM->get_result()->fetch_assoc();
  if (!$master) jexit(['ok'=>false,'error'=>'Costing not found'], 404);

  $costing_id = (string)$master['costing_id'];

  $sqlL = "
    SELECT
      line_id, costing_id, line_no,
      financial_dictionary_id, code,
      description_en, description_fr, description_used,
      qty, unit_cost,
      vat_applicable, vat_rate,
      total_ht, total_vat, total_ttc,
      created_at
    FROM costing_lines
    WHERE costing_id = ?
    ORDER BY line_no ASC
  ";
  $stL = $conn->prepare($sqlL);
  if (!$stL) jexit(['ok'=>false,'error'=>'Prepare failed'], 500);
  $stL->bind_param('s', $costing_id);
  $stL->execute();

  $lines = [];
  $res = $stL->get_result();
  while ($row = $res->fetch_assoc()) {
    $lines[] = $row;
  }

  jexit(['ok'=>true,'master'=>$master,'lines'=>$lines]);
} catch (Throwable $e) {
  jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
}
