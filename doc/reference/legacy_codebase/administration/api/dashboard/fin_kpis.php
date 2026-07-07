<?php
/**
 * SMART LS ERP - TREASURY COMMAND
 * -------------------------------------------------------------------------
 * Endpoint: api/dashboard/fin_kpis.php
 * @description Calculates the 4 Strategic Financial KPIs
 * * KPIs Returned:
 * 1. Pending Disbursements (Count & Value)
 * 2. Critical Overdue (Amount > 60 Days)
 * 3. Conversion Ratio (Proforma vs Final)
 * 4. WCN Leverage (Debt vs Active Projects)
 * -------------------------------------------------------------------------
 */

// 1. Initialize System & Security
require_once __DIR__ . '../../../includes/init.php';
require_once __DIR__ . '../../../includes/role_guard.php';

// Strictly allow FINANCE role
require_role(['FINANCE']);

header('Content-Type: application/json');

try {
    $conn = db();
    
    // ---------------------------------------------------------
    // KPI 1: PENDING DISBURSEMENTS
    // Source: cash_request_master (Strictly APPROVED status)
    // ---------------------------------------------------------
    $sql_pending = "
        SELECT 
            COUNT(*) as pending_count, 
            COALESCE(SUM(amount_total), 0) as pending_value
        FROM cash_request_master 
        WHERE status = 'APPROVED'
    ";
    $stmt = $conn->prepare($sql_pending);
    $stmt->execute();
    $res_pending = $stmt->get_result()->fetch_assoc();
    
    // ---------------------------------------------------------
    // KPI 2: CRITICAL OVERDUE
    // Source: invoice_master (ISSUED_LOCKED + APPROVED + > 60 Days Old)
    // ---------------------------------------------------------
    $sql_overdue = "
        SELECT COALESCE(SUM(balance_xaf), 0) as overdue_amount
        FROM invoice_master
        WHERE approval_status = 'APPROVED'
          AND status = 'ISSUED_LOCKED'
          AND due_date < DATE_SUB(NOW(), INTERVAL 60 DAY)
    ";
    $stmt = $conn->prepare($sql_overdue);
    $stmt->execute();
    $res_overdue = $stmt->get_result()->fetch_assoc();

    // ---------------------------------------------------------
    // KPI 3: PROFORMA-TO-FINAL RATIO (Volume Based)
    // Source: invoice_master (for Finals) vs proforma_invoice (for Proformas)
    // ---------------------------------------------------------
    // Count Final Invoices (Excluding Drafts)
    $sql_finals = "SELECT COUNT(*) as cnt FROM invoice_master WHERE invoice_type = 'INVOICE' AND status != 'DRAFT'";
    $res_finals = $conn->query($sql_finals)->fetch_assoc();
    $count_finals = (int)$res_finals['cnt'];

    // Count Proforma Invoices (Excluding Drafts)
    $sql_proformas = "SELECT COUNT(*) as cnt FROM proforma_invoice WHERE status != 'DRAFT'";
    $res_proformas = $conn->query($sql_proformas)->fetch_assoc();
    $count_proformas = (int)$res_proformas['cnt'];

    // Calculate Ratio safely
    $conversion_ratio = 0;
    if ($count_proformas > 0) {
        $conversion_ratio = round(($count_finals / $count_proformas) * 100);
    }

    // ---------------------------------------------------------
    // KPI 4: WCN LEVERAGE RATIO
    // Source: debt_engagements (Active Debt) vs costing_master (Active Projects)
    // ---------------------------------------------------------
    // 1. Total Active Debt
    $sql_debt = "SELECT COALESCE(SUM(balance_due), 0) as val FROM debt_engagements WHERE status = 'ACTIVE'";
    $res_debt = $conn->query($sql_debt)->fetch_assoc();
    $total_debt = (float)$res_debt['val'];

    // 2. Total Open Project Value (Costing HT)
    // Excludes Drafts and Rejected costings
    $sql_projects = "SELECT COALESCE(SUM(total_ht), 0) as val FROM costing_master WHERE status NOT IN ('DRAFT', 'REJECTED')";
    $res_projects = $conn->query($sql_projects)->fetch_assoc();
    $total_projects = (float)$res_projects['val'];

    // Calculate Leverage safely
    $leverage_ratio = 0;
    if ($total_projects > 0) {
        $leverage_ratio = round(($total_debt / $total_projects) * 100, 1);
    }

    // ---------------------------------------------------------
    // FINAL RESPONSE
    // ---------------------------------------------------------
    echo json_encode([
        'success' => true,
        'data' => [
            'pending_disbursements' => [
                'count' => (int)$res_pending['pending_count'],
                'value' => (float)$res_pending['pending_value'],
                'formatted' => number_format((float)$res_pending['pending_value']) . ' XAF'
            ],
            'critical_overdue' => [
                'amount' => (float)$res_overdue['overdue_amount'],
                'formatted' => number_format((float)$res_overdue['overdue_amount']) . ' XAF'
            ],
            'conversion_ratio' => [
                'percent' => $conversion_ratio,
                'label' => $conversion_ratio . '%'
            ],
            'leverage_ratio' => [
                'percent' => $leverage_ratio,
                'label' => $leverage_ratio . '%'
            ]
        ]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'KPI Calculation Error: ' . $e->getMessage()
    ]);
}
?>