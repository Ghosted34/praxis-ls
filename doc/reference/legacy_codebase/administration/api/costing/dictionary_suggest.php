<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$q = trim((string)($_GET['q'] ?? ''));
$limit = min(50, max(5, (int)($_GET['limit'] ?? 20)));

if ($q === '' || mb_strlen($q) < 2) {
  json_out(['ok' => true, 'items' => []]);
}

/*
 * SIMPLE, BROAD, USER-FRIENDLY SEARCH
 * No service applicability.
 * No binary collation.
 * No smart guessing.
 */
$sql = "
  SELECT
    code,
    name_en,
    name_fr,
    category,
    subcategory
  FROM financial_dictionary
  WHERE
    code LIKE CONCAT('%', ?, '%')
    OR name_en LIKE CONCAT('%', ?, '%')
    OR name_fr LIKE CONCAT('%', ?, '%')
    OR subcategory LIKE CONCAT('%', ?, '%')
    OR category LIKE CONCAT('%', ?, '%')
  ORDER BY code ASC
  LIMIT {$limit}
";

$stmt = $conn->prepare($sql);
$stmt->bind_param('sssss', $q, $q, $q, $q, $q);
$stmt->execute();

$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

json_out([
  'ok' => true,
  'items' => $rows
]);
