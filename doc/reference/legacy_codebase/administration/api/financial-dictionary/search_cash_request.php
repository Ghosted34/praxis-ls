<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$q = trim((string)($_GET['q'] ?? ''));
$limit = (int)($_GET['limit'] ?? 12);
if ($limit < 1) $limit = 12;
if ($limit > 50) $limit = 50;

if ($q === '' || mb_strlen($q) < 2) {
  echo json_encode(['ok' => true, 'items' => []]);
  exit;
}

// Escape LIKE wildcards to avoid unintended matches.
$like = '%' . addcslashes($q, "\\%_") . '%';

$sql = "
  SELECT
    id,
    code,
    name_en,
    name_fr,
    category,
    subcategory,
    justification_required,
    vat_treatment
  FROM financial_dictionary
  WHERE status = 'ACTIVE'
    AND (
      name_en LIKE ?
      OR name_fr LIKE ?
      OR code LIKE ?
    )
  ORDER BY
    CASE WHEN code = ? THEN 0 ELSE 1 END,
    CASE WHEN name_en LIKE ? THEN 0 ELSE 1 END,
    name_en ASC
  LIMIT $limit
";

$stmt = $conn->prepare($sql);
$stmt->bind_param('sssss', $like, $like, $like, $q, $like);
$stmt->execute();
$res = $stmt->get_result();

$items = [];
while ($row = $res->fetch_assoc()) {
  $items[] = $row;
}

$stmt->close();

echo json_encode(['ok' => true, 'items' => $items]);
