<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','FINANCE','OPERATIONS','SALES']);
require_method('GET');

header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
  // Optional filters (safe defaults)
  $q        = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
  $status   = isset($_GET['status']) ? strtoupper(trim((string)$_GET['status'])) : 'ACTIVE';
  $limit    = isset($_GET['limit']) ? (int)$_GET['limit'] : 2000;

  if ($limit < 1) $limit = 2000;
  if ($limit > 5000) $limit = 5000;

  if (!in_array($status, ['ACTIVE','DEPRECATED','ALL'], true)) {
    $status = 'ACTIVE';
  }

  $where = [];
  $types = '';
  $vals  = [];

  if ($status !== 'ALL') {
    $where[] = "fd.status = ?";
    $types  .= 's';
    $vals[]  = $status;
  }

  if ($q !== '') {
    // search by code/name_en/name_fr/category/subcategory
    $where[] = "(fd.code LIKE ? OR fd.name_en LIKE ? OR fd.name_fr LIKE ? OR fd.category LIKE ? OR fd.subcategory LIKE ?)";
    $types  .= 'sssss';
    $like    = '%' . $q . '%';
    array_push($vals, $like, $like, $like, $like, $like);
  }

  $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

  $sql = "
    SELECT
      fd.id,
      fd.code,
      fd.name_en,
      fd.name_fr,
      fd.category,
      fd.subcategory,
      fd.service_applicability,
      fd.territory,
      fd.cost_nature,
      fd.is_negotiable,
      fd.is_billable,
      fd.receipt_required,
      fd.receipt_source,
      fd.justification_required,
      fd.vat_treatment,
      fd.status
    FROM financial_dictionary fd
    $whereSql
    ORDER BY fd.name_en ASC
    LIMIT $limit
  ";

  $stmt = $conn->prepare($sql);
  if ($types !== '') {
    $stmt->bind_param($types, ...$vals);
  }
  $stmt->execute();

  $items = [];
  $rs = $stmt->get_result();
  while ($r = $rs->fetch_assoc()) {
    // service_applicability is stored as longtext but meant to be an array.
    // Return both raw and parsed (best effort).
    $raw = (string)($r['service_applicability'] ?? '');
    $parsed = null;
    if ($raw !== '') {
      $j = json_decode($raw, true);
      if (json_last_error() === JSON_ERROR_NONE) $parsed = $j;
    }
    $r['service_applicability_parsed'] = $parsed;

    $items[] = $r;
  }

  json_out(['ok' => true, 'items' => $items]);

} catch (Throwable $e) {
  json_out(['ok' => false, 'error' => $e->getMessage()], 500);
}
