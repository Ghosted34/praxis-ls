<?php
// FILE: api/chart_data.php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','FINANCE','SALES','OPERATIONS','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$conn->set_charset('utf8mb4');

try {
    $year = (int)($_GET['year'] ?? date('Y'));

    // Revenue per month from invoice_master (INVOICE) — only posted statuses
    $sql = "SELECT MONTH(issue_date) AS m, COALESCE(SUM(total_xaf),0) AS revenue
            FROM invoice_master
            WHERE invoice_type = 'INVOICE'
              AND status IN ('ISSUED_LOCKED','PARTIALLY_PAID','PAID')
              AND YEAR(issue_date) = ?
            GROUP BY MONTH(issue_date)";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $year);
    $stmt->execute();
    $res = $stmt->get_result();
    $rev = array_fill(1, 12, 0.0);
    while ($r = $res->fetch_assoc()) { $rev[(int)$r['m']] = (float)$r['revenue']; }
    $stmt->close();

    // Cost per month from marginpricing_simulations.total_cost_ht by created_at (approved only)
    $sql = "SELECT MONTH(created_at) AS m, COALESCE(SUM(total_cost_ht),0) AS cost
            FROM marginpricing_simulations
            WHERE status = 'APPROVED'
              AND created_at IS NOT NULL
              AND YEAR(created_at) = ?
            GROUP BY MONTH(created_at)";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $year);
    $stmt->execute();
    $res = $stmt->get_result();
    $cost = array_fill(1, 12, 0.0);
    while ($r = $res->fetch_assoc()) { $cost[(int)$r['m']] = (float)$r['cost']; }
    $stmt->close();

    // Volume by mode - operations_file_master created_at
    $sql = "SELECT service_type, COUNT(*) AS cnt
            FROM operations_file_master
            WHERE YEAR(created_at) = ?
            GROUP BY service_type";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $year);
    $stmt->execute();
    $res = $stmt->get_result();
    $modes = ['SEA' => 0, 'AIR' => 0, 'ROAD' => 0];
    while ($r = $res->fetch_assoc()) {
        $st = strtoupper((string)$r['service_type']);
        $cnt = (int)$r['cnt'];
        if (strpos($st, 'SEA') !== false) $modes['SEA'] += $cnt;
        elseif (strpos($st, 'AIR') !== false) $modes['AIR'] += $cnt;
        elseif (strpos($st, 'ROAD') !== false || strpos($st, 'INLAND') !== false) $modes['ROAD'] += $cnt;
        else $modes['ROAD'] += $cnt;
    }
    $stmt->close();

    // Available years from invoice_master (plus fallback)
    $years = [];
    $sql = "SELECT DISTINCT YEAR(issue_date) AS y FROM invoice_master WHERE issue_date IS NOT NULL ORDER BY y DESC LIMIT 10";
    $res = $conn->query($sql);
    if ($res === false) throw new RuntimeException($conn->error);
    while ($r = $res->fetch_assoc()) $years[] = (int)$r['y'];
    if (empty($years)) $years[] = (int)date('Y');

    $labels = []; $revenue = []; $costs = [];
    for ($i = 1; $i <= 12; $i++) {
        $labels[] = date('M', mktime(0,0,0,$i,1,$year));
        $revenue[] = $rev[$i] ?? 0;
        $costs[] = $cost[$i] ?? 0;
    }

    echo json_encode([
        'selected_year' => $year,
        'available_years' => $years,
        'labels' => $labels,
        'revenue' => $revenue,
        'cost' => $costs,
        'mode_labels' => array_keys($modes),
        'mode_values' => array_values($modes)
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Query failed', 'details' => $e->getMessage()]);
}
