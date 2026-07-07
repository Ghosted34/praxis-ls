<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Adjust roles as needed. If you want SALES/OPERATIONS to view clients, add them here.
require_role(['ADMIN','FINANCE','SALES','OPERATIONS','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $payload): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}

function qstr(string $k, string $default=''): string {
  return trim((string)($_GET[$k] ?? $default));
}
function qint(string $k, int $default=0): int {
  $v = (int)($_GET[$k] ?? $default);
  return $v;
}

$conn = db();
$conn->set_charset('utf8mb4');

try {
  $role = strtoupper((string)($_SESSION['auth']['role'] ?? ''));
  // Finance-only figures (receivables, over_limit). Hide for SALES/OPERATIONS by default.
  $canSeeFinance = in_array($role, ['ADMIN','FINANCE','MANAGEMENT'], true);

  // Filters
  $type   = strtoupper(qstr('type', 'ALL'));     // ALL | SHIPPER | CONSIGNEE | BOTH | BUSINESS_PARTNER
  $status = strtoupper(qstr('status', 'ALL'));   // ALL | ACTIVE | DEACTIVATED
  $q      = qstr('q', '');                       // search string
  $page   = max(1, qint('page', 1));
  $limit  = qint('limit', 50);
  if ($limit < 10) $limit = 10;
  if ($limit > 200) $limit = 200;
  $offset = ($page - 1) * $limit;

  $where = " WHERE 1=1 ";
  $types = "";
  $params = [];

  if ($type !== 'ALL') {
    $where .= " AND client_type = ? ";
    $types .= "s";
    $params[] = $type;
  }

  if ($status !== 'ALL') {
    $where .= " AND status = ? ";
    $types .= "s";
    $params[] = $status;
  }

  if ($q !== '') {
    // Search across id/name/niu/email/contact person
    $where .= " AND (
      client_id LIKE CONCAT('%', ?, '%') OR
      client_name LIKE CONCAT('%', ?, '%') OR
      niu LIKE CONCAT('%', ?, '%') OR
      contact_email LIKE CONCAT('%', ?, '%') OR
      contact_person LIKE CONCAT('%', ?, '%')
    ) ";
    $types .= "sssss";
    array_push($params, $q, $q, $q, $q, $q);
  }

  // ---- KPIs (based on current filter scope) ----
 // KPI query (same filters used for rows)
$sqlKpis = "
  SELECT
    COUNT(*) AS total,
    SUM(status='ACTIVE') AS active,
    SUM(COALESCE(cached_receivables,0)) AS receivables,
    SUM(
      CASE
        WHEN credit_limit IS NOT NULL
         AND COALESCE(cached_receivables,0) > credit_limit THEN 1
        ELSE 0
      END
    ) AS over_limit
  FROM client_master
  $where
";

$stmtK = $conn->prepare($sqlKpis);
if (!$stmtK) throw new RuntimeException($conn->error);

if ($types !== '') $stmtK->bind_param($types, ...$params);
$stmtK->execute();
$k = $stmtK->get_result()->fetch_assoc() ?: [];
$stmtK->close();

$kpis = [
  'total' => (int)($k['total'] ?? 0),
  'active' => (int)($k['active'] ?? 0),
  'receivables' => (float)($k['receivables'] ?? 0),
  'over_limit' => (int)($k['over_limit'] ?? 0),
];

  // ---- Total rows for pagination ----
  $sqlCount = "SELECT COUNT(*) AS cnt FROM client_master $where";
  $stmt = $conn->prepare($sqlCount);
  if (!$stmt) throw new RuntimeException("Prepare count failed: ".$conn->error);

  if ($types !== '') {
    $stmt->bind_param($types, ...$params);
  }
  $stmt->execute();
  $cntRow = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  $totalRows = (int)($cntRow['cnt'] ?? 0);

  // ---- Rows ----
  $sqlRows = "
    SELECT
      client_id,
      client_name,
      client_type,
      contact_person,
      contact_email,
      contact_phone,
      niu,
      rccm,
      address,
      country,
      payment_terms_days,
      credit_limit,
      COALESCE(cached_receivables,0) AS cached_receivables,
      status,
      created_at,
      updated_at
    FROM client_master
    $where
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ? OFFSET ?
  ";

  $stmt = $conn->prepare($sqlRows);
  if (!$stmt) throw new RuntimeException("Prepare rows failed: ".$conn->error);

  // bind filters + limit/offset
  $typesRows = $types . "ii";
  $paramsRows = $params;
  $paramsRows[] = $limit;
  $paramsRows[] = $offset;

  $stmt->bind_param($typesRows, ...$paramsRows);
  $stmt->execute();
  $res = $stmt->get_result();

  $rows = [];
  while ($r = $res->fetch_assoc()) {
    $rows[] = [
      'id' => $r['client_id'],
      'name' => $r['client_name'],
      'type' => $r['client_type'],
      'niu' => $r['niu'],
      'rccm' => $r['rccm'],
      'address' => $r['address'],
      'country' => $r['country'],
      'contact' => $r['contact_person'],
      'phone' => $r['contact_phone'],
      'email' => $r['contact_email'],
      'terms' => (int)$r['payment_terms_days'],
      'credit_limit' => $r['credit_limit'],
      'receivables' => $canSeeFinance ? (float)$r['cached_receivables'] : null,
      'status' => $r['status'],
      'updated_at' => $r['updated_at'],
    ];
  }
  $stmt->close();

  respond(200, [
    'ok' => true,
    'kpis' => [
      'total' => (int)($k['total'] ?? 0),
      'active' => (int)($k['active'] ?? 0),
      'deactivated' => (int)($k['deactivated'] ?? 0),
      'receivables' => $k['receivables'] === null ? null : (float)$k['receivables'],
      'over_limit' => $k['over_limit'] === null ? null : (int)$k['over_limit'],
    ],
    'rows' => $rows,
    'page' => $page,
    'limit' => $limit,
    'total_rows' => $totalRows,
    'total_pages' => (int)ceil($totalRows / max(1, $limit)),
    'can_see_finance' => $canSeeFinance
  ]);

} catch (Throwable $e) {
  respond(500, ['ok' => false, 'error' => $e->getMessage()]);
}
