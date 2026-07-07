<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT', 'OPERATIONS','SALES']); // or allow FINANCE read

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => $ok], $extra));
  exit;
}

$conn = db();
$conn->set_charset('utf8mb4');

$q = trim((string)($_GET['q'] ?? ''));
$nature = strtoupper(trim((string)($_GET['nature'] ?? 'ALL')));

$where = "1=1";
$types = "";
$params = [];

if ($q !== '') {
  $where .= " AND (code LIKE ? OR name_en LIKE ? OR name_fr LIKE ?)";
  $like = '%' . $q . '%';
  $types .= "sss";
  $params[] = $like;
  $params[] = $like;
  $params[] = $like;
}

if ($nature !== '' && $nature !== 'ALL') {
  $where .= " AND cost_nature = ?";
  $types .= "s";
  $params[] = $nature;
}

$sql = "
  SELECT
    id, code, name_en, name_fr,
    category, subcategory, service_applicability,
    territory, cost_nature,
    is_negotiable, is_billable,
    receipt_required, receipt_source,
    justification_required,
    vat_treatment, status,
    created_by, created_at
  FROM financial_dictionary
  WHERE {$where}
  ORDER BY id DESC
  LIMIT 500
";


$stmt = $conn->prepare($sql);
if ($types !== '') {
  $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$res = $stmt->get_result();

$rows = [];
while ($r = $res->fetch_assoc()) {
  $app = [];
  $raw = (string)($r['service_applicability'] ?? '[]');
  $decoded = json_decode($raw, true);
  if (is_array($decoded)) $app = $decoded;

    $rows[] = [
    'id' => (int)$r['id'],
    'code' => $r['code'],
    'name_en' => $r['name_en'],
    'name_fr' => $r['name_fr'],
    'category' => $r['category'],
    'subcategory' => $r['subcategory'],
    'service_applicability' => $app,
    'territory' => $r['territory'],
    'cost_nature' => $r['cost_nature'],
    'is_negotiable' => (int)$r['is_negotiable'],
    'is_billable' => (int)$r['is_billable'],
    'receipt_required' => $r['receipt_required'],
    'receipt_source' => $r['receipt_source'],
    'justification_required' => (int)$r['justification_required'],
    'vat_treatment' => $r['vat_treatment'],
    'status' => $r['status'],
    'created_at' => $r['created_at'],
  ];

}

out(true, ['rows' => $rows]);
