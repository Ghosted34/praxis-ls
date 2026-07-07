<?php
/**
 * SMART LS ERP - TREASURY COMMAND
 * -------------------------------------------------------------------------
 * Endpoint: api/treasury/get_liquidity.php
 * @description Calculates the "Liquidity Heartbeat" of the company.
 * * LOGIC (Per Agreement):
 * 1. Calculate MTD (Month-to-Date) Cash Inflow from Clients.
 * 2. Calculate MTD Cash Outflow (Disbursed Requests + Debt Repayments).
 * 3. Compare "Net Flow" against "Pending Approved Requests".
 * -------------------------------------------------------------------------
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Strictly allow FINANCE role
require_role(['FINANCE']);

header('Content-Type: application/json');

try {
    $conn = db();
    
    // Time Definitions (Current Month Window)
    $startOfMonth = date('Y-m-01 00:00:00');
    $now = date('Y-m-d H:i:s');

    // ---------------------------------------------------------
    // 1. CALCULATE INFLOW (Money In)
    // Source: invoice_payment_history (Clients paying us)
    // ---------------------------------------------------------
    $sql_in = "
        SELECT COALESCE(SUM(amount_paid_xaf), 0) as total_in
        FROM invoice_payment_history
        WHERE payment_date >= ? AND payment_date <= ?
    ";
    $stmt_in = $conn->prepare($sql_in);
    $stmt_in->bind_param('ss', $startOfMonth, $now);
    $stmt_in->execute();
    $inflow = (float)$stmt_in->get_result()->fetch_assoc()['total_in'];

    // ---------------------------------------------------------
    // 2. CALCULATE OUTFLOW (Money Out)
    // Source A: cash_request_master (Operational Expenses Disbursed)
    // Source B: debt_repayments (Loan Repayments)
    // ---------------------------------------------------------
    
    // A. Operational Disbursed
    $sql_out_ops = "
        SELECT COALESCE(SUM(disbursed_total), 0) as total_out_ops
        FROM cash_request_master
        WHERE disbursed_time >= ? AND disbursed_time <= ?
    ";
    $stmt_out_ops = $conn->prepare($sql_out_ops);
    $stmt_out_ops->bind_param('ss', $startOfMonth, $now);
    $stmt_out_ops->execute();
    $outflow_ops = (float)$stmt_out_ops->get_result()->fetch_assoc()['total_out_ops'];

    // B. Debt Repayments
    $sql_out_debt = "
        SELECT COALESCE(SUM(amount_paid), 0) as total_out_debt
        FROM debt_repayments
        WHERE payment_date >= ? AND payment_date <= ?
    ";
    $stmt_out_debt = $conn->prepare($sql_out_debt);
    $stmt_out_debt->bind_param('ss', $startOfMonth, $now);
    $stmt_out_debt->execute();
    $outflow_debt = (float)$stmt_out_debt->get_result()->fetch_assoc()['total_out_debt'];

    $total_outflow = $outflow_ops + $outflow_debt;

    // ---------------------------------------------------------
    // 3. CALCULATE PENDING NEED (Immediate Liability)
    // Source: cash_request_master (Status = APPROVED)
    // ---------------------------------------------------------
    $sql_pending = "
        SELECT COALESCE(SUM(amount_total), 0) as pending_val
        FROM cash_request_master
        WHERE status = 'APPROVED'
    ";
    $res_pending = $conn->query($sql_pending)->fetch_assoc();
    $pending_liability = (float)$res_pending['pending_val'];

    // ---------------------------------------------------------
    // 4. HEARTBEAT LOGIC
    // ---------------------------------------------------------
    $net_position = $inflow - $total_outflow;
    
    // Default State
    $heartbeat = 'STAGNANT';
    $color_code = 'danger'; // Red
    $message = 'Critical: Outflows exceed MTD Collections.';

    if ($net_position > $pending_liability) {
        // SCENARIO 1: Healthy. We have more net cash than we need to spend today.
        $heartbeat = 'LIQUID';
        $color_code = 'success'; // Green
        $message = 'Optimal: Cash covers all pending requests.';
    } elseif ($net_position > 0) {
        // SCENARIO 2: Positive flow, but not enough for everything pending.
        $heartbeat = 'STRAINED';
        $color_code = 'warning'; // Yellow
        $message = 'Caution: Approved requests exceed liquid float.';
    } else {
        // SCENARIO 3: Negative flow (Red)
        // Message is already set as default above.
    }

    echo json_encode([
        'success' => true,
        'data' => [
            'status' => $heartbeat,
            'color'  => $color_code,
            'message'=> $message,
            'metrics'=> [
                'mtd_inflow'  => $inflow,
                'mtd_outflow' => $total_outflow,
                'net_position'=> $net_position,
                'pending_req' => $pending_liability
            ]
        ]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Heartbeat Error: ' . $e->getMessage()
    ]);
}
?>