<?php
/**
 * SMART LS ERP - TREASURY COMMAND
 * -------------------------------------------------------------------------
 * Endpoint: api/receivables/aging_summary.php
 * @description Generates the "Aging Buckets" for the Receivable Ledger.
 * * LOGIC:
 * 1. Scans all 'ISSUED_LOCKED' invoices with a positive balance.
 * 2. Compares 'due_date' vs NOW() to categorize into 3 buckets:
 * - 0-30 Days (Standard Float)
 * - 31-60 Days (Action Required)
 * - 60+ Days (Critical Risk)
 * -------------------------------------------------------------------------
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Strictly allow FINANCE role
require_role(['FINANCE']);

header('Content-Type: application/json');

try {
    $conn = db();
    
    // Buckets Initialization
    $buckets = [
        '0-30'  => 0.00,
        '31-60' => 0.00,
        '60+'   => 0.00
    ];

    $sql = "
        SELECT 
            balance_xaf, 
            DATEDIFF(NOW(), due_date) as days_overdue
        FROM invoice_master
        WHERE status = 'ISSUED_LOCKED' 
          AND approval_status = 'APPROVED'
          AND balance_xaf > 0
    ";

    $result = $conn->query($sql);

    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $days = (int)$row['days_overdue'];
            $amount = (float)$row['balance_xaf'];

            // Categorization Logic
            if ($days <= 30) {
                // Includes invoices not yet due (negative days) or slightly overdue
                $buckets['0-30'] += $amount;
            } elseif ($days <= 60) {
                $buckets['31-60'] += $amount;
            } else {
                // Critical
                $buckets['60+'] += $amount;
            }
        }
    }

    // Format for ChartJS or Frontend Render
    echo json_encode([
        'success' => true,
        'data' => [
            'labels' => ['0-30 Days', '31-60 Days', '60+ Days (Critical)'],
            'values' => [
                $buckets['0-30'],
                $buckets['31-60'],
                $buckets['60+']
            ],
            'total_receivable' => array_sum($buckets)
        ]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Aging Logic Error: ' . $e->getMessage()
    ]);
}
?>