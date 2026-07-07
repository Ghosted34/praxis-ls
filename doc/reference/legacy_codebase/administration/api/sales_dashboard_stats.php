<?php
/**
 * SALES DASHBOARD API ENDPOINT
 * Returns KPIs, Blended Activity Feed, and Actionable Tasks
 */
require_once __DIR__ . '/../includes/init.php';
require_once __DIR__ . '/../includes/role_guard.php';
require_role(['SALES', 'ADMIN', 'MANAGEMENT']);

header('Content-Type: application/json');
$conn = db();

try {
    // --- 1. KPI: PIPELINE VALUE ---
    // Logic: Sum of Open Quote Requests (not yet converted) + Active Margin Simulations
    $sqlPipeline = "
        SELECT 
            (SELECT COALESCE(SUM(estimated_value_xaf), 0) 
             FROM quote_requests 
             WHERE status NOT IN ('REJECTED', 'CONVERTED', 'LOST')) 
            + 
            (SELECT COALESCE(SUM(total_sell_ttc), 0) 
             FROM margin_pricing_simulations 
             WHERE status IN ('DRAFT', 'SUBMITTED', 'VALIDATED')) 
        as total_pipeline
    ";
    $pipelineVal = (float)$conn->query($sqlPipeline)->fetch_assoc()['total_pipeline'];

    // --- 2. KPI: CONVERSION RATE ---
    // Logic: (Won Deals / Total Quote Requests) * 100
    $sqlConv = "
        SELECT 
            (SELECT COUNT(*) FROM margin_pricing_simulations WHERE status = 'APPROVED') as won_count,
            (SELECT COUNT(*) FROM quote_requests) as total_leads
    ";
    $convData = $conn->query($sqlConv)->fetch_assoc();
    $won = (int)$convData['won_count'];
    $total = (int)$convData['total_leads'];
    $conversionRate = ($total > 0) ? round(($won / $total) * 100, 1) : 0;

    // --- 3. KPI: NEW LEADS (This Week) ---
    $sqlLeads = "SELECT COUNT(*) as c FROM quote_requests WHERE YEARWEEK(submission_datetime, 1) = YEARWEEK(CURDATE(), 1)";
    $newLeads = (int)$conn->query($sqlLeads)->fetch_assoc()['c'];

    // --- 4. KPI: DRAFT QUOTES ---
    $sqlDrafts = "SELECT COUNT(*) as c FROM margin_pricing_simulations WHERE status = 'DRAFT'";
    $draftQuotes = (int)$conn->query($sqlDrafts)->fetch_assoc()['c'];

    // --- 5. GOAL TRACKING (From department_goals) ---
    $curMonth = (int)date('m');
    $curYear = (int)date('Y');
    $sqlGoal = "SELECT target_amount FROM department_goals WHERE department = 'SALES' AND goal_month = $curMonth AND goal_year = $curYear LIMIT 1";
    $resGoal = $conn->query($sqlGoal)->fetch_assoc();
    $targetAmount = $resGoal ? (float)$resGoal['target_amount'] : 100000000; // Default 100M if not set
    
    // Calculate actual closed deals for the progress bar (Simulations Approved + Closed/Won Requests)
    // Simplified for MVP: Using total pipeline as "Progress" creates a visual, but strictly it should be 'Won Revenue'.
    // Let's use 'Won Revenue' for accuracy.
    $sqlWonRev = "SELECT SUM(total_sell_ttc) as s FROM margin_pricing_simulations WHERE status = 'APPROVED'";
    $wonRevenue = (float)$conn->query($sqlWonRev)->fetch_assoc()['s'];
    
    $goalPercent = ($targetAmount > 0) ? round(($wonRevenue / $targetAmount) * 100) : 0;
    if($goalPercent > 100) $goalPercent = 100;

    // --- 6. BLENDED ACTIVITY FEED (Polyfill Query) ---
    // We union the last 5 items from Quotes, Simulations, and Cash Requests to create a "Live Feed"
    $sqlFeed = "
        (SELECT 'LEAD' as type, requester_company as title, 'New Quote Request Received' as msg, submission_datetime as date_time 
         FROM quote_requests ORDER BY submission_datetime DESC LIMIT 3)
        UNION ALL
        (SELECT 'QUOTE' as type, client_name_cached as title, CONCAT('Quote ', status) as msg, updated_at as date_time 
         FROM margin_pricing_simulations WHERE updated_at IS NOT NULL ORDER BY updated_at DESC LIMIT 3)
        UNION ALL
        (SELECT 'CASH' as type, beneficiary as title, CONCAT('Cash Request ', status) as msg, updated_at as date_time 
         FROM cash_request_master WHERE status = 'APPROVED_LOCKED' ORDER BY updated_at DESC LIMIT 3)
        ORDER BY date_time DESC LIMIT 10
    ";
    $feedResult = $conn->query($sqlFeed)->fetch_all(MYSQLI_ASSOC);

    // --- 7. ACTIONABLE TASKS TABLE ---
    // Logic: Quote Requests needing action + Draft Quotes
    $sqlTasks = "
        SELECT 'LEAD' as type, requester_company as client, 'New Inquiry' as status, estimated_value_xaf as val, quote_request_id as ref
        FROM quote_requests WHERE status = 'RECEIVED'
        UNION ALL
        SELECT 'QUOTE' as type, client_name_cached as client, 'Draft Pending' as status, total_sell_ttc as val, simulation_ref as ref
        FROM margin_pricing_simulations WHERE status = 'DRAFT'
        LIMIT 10
    ";
    $tasksResult = $conn->query($sqlTasks)->fetch_all(MYSQLI_ASSOC);

    echo json_encode([
        'ok' => true,
        'kpis' => [
            'pipeline' => $pipelineVal,
            'conversion' => $conversionRate,
            'new_leads' => $newLeads,
            'drafts' => $draftQuotes,
            'goal_percent' => $goalPercent,
            'goal_target' => $targetAmount
        ],
        'feed' => $feedResult,
        'tasks' => $tasksResult
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
?>