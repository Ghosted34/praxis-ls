<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function json_out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload);
  exit;
}

$q        = trim((string)($_GET['q'] ?? ''));
$platform = trim((string)($_GET['platform'] ?? ''));
$status   = trim((string)($_GET['status'] ?? ''));

$where = "1=1";
$types = "";
$params = [];

if ($q !== '') {
  $where .= " AND (mc.name LIKE CONCAT('%', ?, '%') OR mc.owner_name LIKE CONCAT('%', ?, '%'))";
  $types .= "ss";
  $params[] = $q;
  $params[] = $q;
}
if ($platform !== '') {
  $where .= " AND mc.platform = ?";
  $types .= "s";
  $params[] = $platform;
}
if ($status !== '') {
  $where .= " AND mc.status = ?";
  $types .= "s";
  $params[] = $status;
}

/* KPI query (same filters) */
$kpiSql = "
  SELECT
    COALESCE(SUM(mc.budget_amount), 0) AS total_spend,
    COALESCE(SUM(mc.leads), 0)         AS total_leads,
    COALESCE(SUM(mc.won), 0)           AS total_won
  FROM marketing_campaigns mc
  WHERE $where
";
$kpiStmt = $conn->prepare($kpiSql);
if ($types !== "") $kpiStmt->bind_param($types, ...$params);
$kpiStmt->execute();
$kpi = $kpiStmt->get_result()->fetch_assoc() ?: ['total_spend'=>0,'total_leads'=>0,'total_won'=>0];

/* Rows query */
$rowsSql = "
  SELECT
    mc.id,
    mc.name,
    mc.platform,
    mc.start_date,
    mc.end_date,
    mc.budget_amount,
    mc.currency,
    mc.target_service,
    mc.leads,
    mc.opportunities,
    mc.won,
    mc.status,
    mc.owner_name,
    mc.created_at,
    mc.updated_at
  FROM marketing_campaigns mc
  WHERE $where
  ORDER BY mc.start_date DESC, mc.created_at DESC
";
$rowsStmt = $conn->prepare($rowsSql);
if ($types !== "") $rowsStmt->bind_param($types, ...$params);
$rowsStmt->execute();
$res = $rowsStmt->get_result();

$rows = [];
while ($r = $res->fetch_assoc()) {
  // normalize types
  $r['budget_amount'] = (float)$r['budget_amount'];
  $r['leads'] = (int)$r['leads'];
  $r['opportunities'] = (int)$r['opportunities'];
  $r['won'] = (int)$r['won'];
  $rows[] = $r;
}

$totalSpend = (float)$kpi['total_spend'];
$totalLeads = (int)$kpi['total_leads'];
$totalWon   = (int)$kpi['total_won'];
$avgConv    = ($totalLeads > 0) ? round(($totalWon / $totalLeads) * 100, 1) : 0.0;

json_out([
  'ok' => true,
  'kpis' => [
    'total_spend' => $totalSpend,
    'total_leads' => $totalLeads,
    'total_won'   => $totalWon,
    'avg_conv'    => $avgConv
  ],
  'rows' => $rows
]);
