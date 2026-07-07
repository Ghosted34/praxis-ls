<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','MANAGEMENT','SALES','FINANCE','OPERATIONS']);
header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

// --- Filters ---
$q = trim((string)($_GET['q'] ?? ''));
$status = strtoupper(trim((string)($_GET['status'] ?? '')));

// Challenge 32: Default limit increased to 50
$limit = (int)($_GET['limit'] ?? 50);
if ($limit < 1 || $limit > 500) $limit = 50;

$where = "1=1";
$params = [];
$types = "";

if ($status !== '' && $status !== 'ALL') {
    $where .= " AND mps.status = ?";
    $types .= "s";
    $params[] = $status;
}

if ($q !== '') {
    $where .= " AND (
        mps.simulation_ref LIKE CONCAT('%', ?, '%')
        OR COALESCE(mps.costing_ref,'') LIKE CONCAT('%', ?, '%')
        OR COALESCE(mps.operations_file_reference,'') LIKE CONCAT('%', ?, '%')
        OR COALESCE(mps.client_name_cached,'') LIKE CONCAT('%', ?, '%')
    )";
    $types .= "ssss";
    array_push($params, $q, $q, $q, $q);
}

// Main List Query
// Added: verification_hash, currency for frontend display
$sql = "
    SELECT 
        mps.id,
        mps.simulation_ref,
        mps.status,
        mps.costing_id,
        mps.costing_ref,
        mps.operations_file_reference,
        mps.client_name_cached,
        mps.currency,
        mps.total_sell_ttc,
        mps.margin_amount,
        mps.margin_percent,
        mps.quote_ref,
        mps.verification_hash,
        mps.created_at,
        mps.updated_at
    FROM marginpricing_simulations mps
    WHERE $where
    ORDER BY mps.updated_at DESC
    LIMIT $limit
";

$stmt = $conn->prepare($sql);
if ($types !== "") $stmt->bind_param($types, ...$params);
$stmt->execute();

$items = [];
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $items[] = $row;
}
$stmt->close();

// -----------------------------------------------------------------------------
// KPI SUMMARY (Server-Side Logic - Challenge 2)
// -----------------------------------------------------------------------------
// We do this in a separate try/catch to ensure the list loads even if stats fail
$summary = [
    'win_rate_mtd' => 0.0,
    'win_rate_delta' => 0.0,
    'active_quotes' => 0,
    'pipeline_xaf' => 0.0,
    'pending_approval' => 0,
    'projected_margin_xaf' => 0.0,
];

try {
    // 1. Win Rate MTD (Month to Date)
    // Formula: Quoted / (Quoted + Rejected) created this month
    $sql_mtd = "
        SELECT 
            SUM(CASE WHEN status='QUOTED' THEN 1 ELSE 0 END) as q,
            SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) as r
        FROM marginpricing_simulations 
        WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
    ";
    $row_mtd = $conn->query($sql_mtd)->fetch_assoc();
    $q_mtd = (int)($row_mtd['q'] ?? 0);
    $r_mtd = (int)($row_mtd['r'] ?? 0);
    $total_mtd = $q_mtd + $r_mtd;
    $summary['win_rate_mtd'] = ($total_mtd > 0) ? round(($q_mtd / $total_mtd) * 100, 1) : 0.0;

    // 2. Win Rate Last Month (for Delta)
    $sql_lm = "
        SELECT 
            SUM(CASE WHEN status='QUOTED' THEN 1 ELSE 0 END) as q,
            SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) as r
        FROM marginpricing_simulations 
        WHERE created_at >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01')
          AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01')
    ";
    $row_lm = $conn->query($sql_lm)->fetch_assoc();
    $q_lm = (int)($row_lm['q'] ?? 0);
    $r_lm = (int)($row_lm['r'] ?? 0);
    $total_lm = $q_lm + $r_lm;
    $rate_lm = ($total_lm > 0) ? ($q_lm / $total_lm * 100.0) : 0.0;
    
    $summary['win_rate_delta'] = round($summary['win_rate_mtd'] - $rate_lm, 1);

    // 3. Active Quotes (Status=QUOTED, recent)
    $res_aq = $conn->query("SELECT COUNT(*) as c FROM marginpricing_simulations WHERE status='QUOTED' AND updated_at >= (NOW() - INTERVAL 30 DAY)");
    $summary['active_quotes'] = (int)($res_aq->fetch_assoc()['c'] ?? 0);

    // 4. Pending Approval
    $res_pa = $conn->query("SELECT COUNT(*) as c FROM marginpricing_simulations WHERE status='SUBMITTED'");
    $summary['pending_approval'] = (int)($res_pa->fetch_assoc()['c'] ?? 0);

    // 5. Pipeline Value & Projected Margin (Weighted) in XAF
    // If currency is NOT XAF, we should ideally use the exchange rate stored. 
    // For simplicity/speed in aggregation, we assume header totals are roughly indicative 
    // or convert if needed. The DB stores 'total_sell_ttc' in SIM currency.
    // To be accurate server-side, we multiply by exchange_rate_to_xaf.
    $sql_fin = "
        SELECT 
            SUM(
                CASE 
                    WHEN status IN ('SUBMITTED','APPROVED','QUOTED') 
                    THEN total_sell_ttc * exchange_rate_to_xaf 
                    ELSE 0 
                END
            ) as pipe_val,
            SUM(
                CASE 
                    WHEN status='SUBMITTED' THEN (margin_amount * exchange_rate_to_xaf) * 0.40
                    WHEN status='APPROVED'  THEN (margin_amount * exchange_rate_to_xaf) * 0.70
                    WHEN status='QUOTED'    THEN (margin_amount * exchange_rate_to_xaf) * 1.00
                    ELSE 0
                END
            ) as proj_marg
        FROM marginpricing_simulations
    ";
    $row_fin = $conn->query($sql_fin)->fetch_assoc();
    $summary['pipeline_xaf'] = (float)($row_fin['pipe_val'] ?? 0);
    $summary['projected_margin_xaf'] = (float)($row_fin['proj_marg'] ?? 0);

} catch (Exception $e) {
    // Fail silently on KPIs, but serve the list
    // error_log($e->getMessage()); 
}

echo json_encode([
    'ok' => true,
    'items' => $items,
    'summary' => $summary
], JSON_UNESCAPED_UNICODE);
?>