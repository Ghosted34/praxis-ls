<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']); // adjust if Finance can view too

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => $ok], $extra));
  exit;
}

$conn = db();
$conn->set_charset('utf8mb4');

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) out(false, ['error' => 'Session invalid'], 401);

$q    = trim((string)($_GET['q'] ?? ''));
$type = strtoupper(trim((string)($_GET['type'] ?? 'ALL')));

$allowedTypes = ['ALL','TRANSPORTER','SHIPPING_LINE','CUSTOMS_BROKER','AIRLINE','SERVICE_PROVIDER'];
if (!in_array($type, $allowedTypes, true)) $type = 'ALL';

/**
 * NOTE ABOUT "OVERDUE"
 * You do not have an invoice/AP ageing table shown here.
 * So we derive "overdue" from supplier_master using:
 * - status = ACTIVE
 * - cached_payables > 0
 * - created_at older than payment_terms_days
 * This is a proxy until you wire real AP ageing.
 */
$where = "1=1";
$types = "";
$params = [];

if ($q !== '') {
  $where .= " AND (
    supplier_name LIKE CONCAT('%', ?, '%')
    OR supplier_id LIKE CONCAT('%', ?, '%')
    OR contact_person LIKE CONCAT('%', ?, '%')
    OR contact_email LIKE CONCAT('%', ?, '%')
  )";
  $types .= "ssss";
  $params[] = $q; $params[] = $q; $params[] = $q; $params[] = $q;
}

if ($type !== 'ALL') {
  $where .= " AND supplier_type = ?";
  $types .= "s";
  $params[] = $type;
}

/* ==========================
   KPIs
========================== */
$sqlKpi = "
  SELECT
    COUNT(*) AS total_vendors,
    SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) AS active_vendors,
    COALESCE(SUM(CASE WHEN status='ACTIVE' THEN cached_payables ELSE 0 END), 0) AS total_payables,
    COALESCE(SUM(
      CASE
        WHEN status='ACTIVE'
         AND cached_payables > 0
         AND payment_terms_days > 0
         AND created_at IS NOT NULL
         AND created_at < (NOW() - INTERVAL payment_terms_days DAY)
        THEN cached_payables
        ELSE 0
      END
    ), 0) AS overdue_payables
  FROM supplier_master
  WHERE $where
";

$stmt = $conn->prepare($sqlKpi);
if ($types !== '') $stmt->bind_param($types, ...$params);
$stmt->execute();
$kpis = $stmt->get_result()->fetch_assoc() ?: [
  'total_vendors' => 0,
  'active_vendors' => 0,
  'total_payables' => 0,
  'overdue_payables' => 0,
];
$stmt->close();

/* ==========================
   Rows
========================== */
$sqlRows = "
  SELECT
    supplier_id,
    supplier_name,
    supplier_type,
    contact_person,
    contact_email,
    rating,
    cached_payables,
    status
  FROM supplier_master
  WHERE $where
  ORDER BY supplier_name ASC
  LIMIT 500
";

$stmt = $conn->prepare($sqlRows);
if ($types !== '') $stmt->bind_param($types, ...$params);
$stmt->execute();
$res = $stmt->get_result();

$rows = [];
while ($r = $res->fetch_assoc()) {
  $rows[] = [
    'id'      => (string)$r['supplier_id'],
    'name'    => (string)$r['supplier_name'],
    'type'    => (string)$r['supplier_type'],
    'contact' => (string)($r['contact_person'] ?? ''),
    'email'   => (string)($r['contact_email'] ?? ''),
    'rating'  => (int)($r['rating'] ?? 0),
    'payables'=> (float)($r['cached_payables'] ?? 0),
    'status'  => (string)($r['status'] ?? 'ACTIVE'),
  ];
}
$stmt->close();

out(true, [
  'kpis' => [
    'total'   => (int)$kpis['total_vendors'],
    'active'  => (int)$kpis['active_vendors'],
    'payables'=> (float)$kpis['total_payables'],
    'overdue' => (float)$kpis['overdue_payables'],
  ],
  'rows' => $rows
]);
