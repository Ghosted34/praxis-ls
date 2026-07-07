<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']);

$conn = db();

// 1. Inputs
$q = trim((string)($_GET['q'] ?? ''));
$status = trim((string)($_GET['status'] ?? ''));
$period = trim((string)($_GET['period'] ?? 'this_month')); // Default to This Month
$page = max(1, (int)($_GET['page'] ?? 1));
$pageSize = min(50, max(5, (int)($_GET['pageSize'] ?? 10)));
$offset = ($page - 1) * $pageSize;

// 2. Build Filter Criteria
$where = "1=1";
$types = "";
$params = [];

// A. Text Search
if ($q !== '') {
  $where .= " AND (
    cm.costing_ref LIKE CONCAT('%', ?, '%')
    OR cm.operations_file_reference LIKE CONCAT('%', ?, '%')
    OR cm.client_name_cached LIKE CONCAT('%', ?, '%')
  )";
  $types .= "sss";
  $params[] = $q; $params[] = $q; $params[] = $q;
}

// B. Status Filter
if ($status !== '' && $status !== 'ALL') {
  $where .= " AND cm.status = ?";
  $types .= "s";
  $params[] = $status;
}

// C. Period Filter (Date Logic)
if ($period !== 'all_time') {
    $startDate = '';
    $endDate = '';
    
    $y = (int)date('Y');
    $m = (int)date('n');

    switch ($period) {
        case 'this_month':
            $startDate = date('Y-m-01');
            $endDate = date('Y-m-t');
            break;
        case 'last_month':
            $startDate = date('Y-m-01', strtotime('last month'));
            $endDate = date('Y-m-t', strtotime('last month'));
            break;
        case 'this_quarter':
            $qStartMonth = (($m - 1) / 3) * 3 + 1;
            $startDate = date('Y-m-d', mktime(0, 0, 0, (int)$qStartMonth, 1, $y));
            $endDate = date('Y-m-t', mktime(0, 0, 0, (int)$qStartMonth + 2, 1, $y));
            break;
        case 'this_year':
            $startDate = date('Y-01-01');
            $endDate = date('Y-12-31');
            break;
        default: 
            // Fallback to this month if invalid
            $startDate = date('Y-m-01');
            $endDate = date('Y-m-t');
            break;
    }

    $where .= " AND cm.costing_date BETWEEN ? AND ?";
    $types .= "ss";
    $params[] = $startDate;
    $params[] = $endDate;
}

// 3. Main List Query (Paginated)
$countSql = "SELECT COUNT(*) AS c FROM costing_master cm WHERE {$where}";
$stmt = $conn->prepare($countSql);
if ($types !== '') $stmt->bind_param($types, ...$params);
$stmt->execute();
$total = (int)($stmt->get_result()->fetch_assoc()['c'] ?? 0);

$sql = "
  SELECT
    cm.costing_id,
    cm.costing_ref,
    cm.costing_date,
    cm.operations_file_reference,
    cm.client_id,
    cm.client_name_cached,
    cm.currency,
    cm.total_ttc,
    cm.exchange_rate_to_xaf, 
    cm.status,
    cm.created_at
  FROM costing_master cm
  WHERE {$where}
  ORDER BY cm.created_at DESC
  LIMIT ? OFFSET ?
";

$typesList = $types . "ii";
$paramsList = array_merge($params, [$pageSize, $offset]);

$stmt = $conn->prepare($sql);
$stmt->bind_param($typesList, ...$paramsList);
$stmt->execute();
$items = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// 4. KPI Shadow Query (Aggregated & Currency Normalized)
// This re-uses the exact same $where clause so the stats match the filters
$kpiSql = "
    SELECT 
        COUNT(*) as count_mtd,
        SUM(CASE WHEN cm.status = 'SUBMITTED_FOR_VALIDATION' THEN 1 ELSE 0 END) as count_val,
        SUM(CASE WHEN cm.status = 'SUBMITTED_FOR_APPROVAL' THEN 1 ELSE 0 END) as count_app,
        SUM(cm.total_ttc * COALESCE(cm.exchange_rate_to_xaf, 1)) as total_ttc_xaf
    FROM costing_master cm
    WHERE {$where}
";

$stmt = $conn->prepare($kpiSql);
if ($types !== '') $stmt->bind_param($types, ...$params);
$stmt->execute();
$kpi = $stmt->get_result()->fetch_assoc();

// 5. Output
json_out([
  'ok' => true,
  'items' => $items,
  'meta' => [
      'page' => $page,
      'pageSize' => $pageSize,
      'total' => $total,
      'totalPages' => (int)ceil($total / $pageSize),
      'kpi' => $kpi // <--- The Golden Data
  ]
]);