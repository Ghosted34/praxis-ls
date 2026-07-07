<?php
/**
 * Marketing Campaign List API - SMART LS
 * Provides filtered campaign data and aggregated KPIs
 */

declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Access control for all relevant business roles
require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

/**
 * Standardized JSON output helper
 */
function json_out(array $payload, int $code = 200): void {
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

// --- 1. Capture Filters ---
$q        = trim((string)($_GET['q'] ?? ''));
$platform = trim((string)($_GET['platform'] ?? ''));
$status   = trim((string)($_GET['status'] ?? ''));

$where = "1=1";
$types = "";
$params = [];

// Search by name or owner
if ($q !== '') {
    $where .= " AND (mc.name LIKE CONCAT('%', ?, '%') OR mc.owner_name LIKE CONCAT('%', ?, '%'))";
    $types .= "ss";
    $params[] = $q;
    $params[] = $q;
}

// Filter by Platform
if ($platform !== '') {
    $where .= " AND mc.platform = ?";
    $types .= "s";
    $params[] = $platform;
}

// Filter by Status
if ($status !== '') {
    $where .= " AND mc.status = ?";
    $types .= "s";
    $params[] = $status;
}

// --- 2. KPI Aggregation ---
// Calculates the dashboard header totals based on current filters
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
$kpi = $kpiStmt->get_result()->fetch_assoc() ?: ['total_spend' => 0, 'total_leads' => 0, 'total_won' => 0];

// --- 3. Rows Retrieval ---
// Fetching all columns including new strategy/rejection fields
$rowsSql = "
    SELECT
        mc.id,
        mc.name,
        mc.remarks,
        mc.rejection_reason,
        mc.platform,
        mc.start_date,
        mc.end_date,
        mc.budget_amount,
        mc.currency,
        mc.target_service,
        mc.target_leads,
        mc.target_opportunities,
        mc.target_won,
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
    // Cast types for frontend JS consistency
    $r['budget_amount']        = (float)$r['budget_amount'];
    
    // Planned Targets
    $r['target_leads']         = (int)$r['target_leads'];
    $r['target_opportunities'] = (int)$r['target_opportunities'];
    $r['target_won']           = (int)$r['target_won'];
    
    // Real Performance
    $r['leads']                = (int)$r['leads'];
    $r['opportunities']        = (int)$r['opportunities'];
    $r['won']                  = (int)$r['won'];
    
    $rows[] = $r;
}

// --- 4. Final KPI Calculations ---
$totalSpend = (float)$kpi['total_spend'];
$totalLeads = (int)$kpi['total_leads'];
$totalWon   = (int)$kpi['total_won'];

// Conversion Rate: Total Wins / Total Leads
$avgConv = ($totalLeads > 0) ? round(($totalWon / $totalLeads) * 100, 1) : 0.0;

// --- 5. Return JSON Response ---
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