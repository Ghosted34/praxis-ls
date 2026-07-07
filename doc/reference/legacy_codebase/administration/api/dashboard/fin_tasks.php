<?php
/**
 * SMART LS ERP - TREASURY COMMAND
 * -------------------------------------------------------------------------
 * Endpoint: api/dashboard/fin_tasks.php
 * @description Aggregates actionable items for the Finance Controller.
 * * SOURCES:
 * 1. Cash Requests: Status = 'SUBMITTED' (Needs Verification)
 * 2. OCR Audit: Status = 'SUBMITTED' AND Variance > 15%
 * 3. System Bot: Recent 'FINANCE' events from system_events_log
 * -------------------------------------------------------------------------
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Strictly allow FINANCE role
require_role(['FINANCE']);

header('Content-Type: application/json');

$tasks = [];

try {
    $conn = db();

    // ---------------------------------------------------------
    // SOURCE 1: CASH REQUESTS (Pending Verification)
    // ---------------------------------------------------------
    // We look for requests submitted by Ops, waiting for Finance to 'Verify' 
    // before they go to Management for Approval.
    $sql_cash = "
        SELECT 
            pr_id, 
            created_by, 
            created_at, 
            amount_total, 
            beneficiary 
        FROM cash_request_master 
        WHERE status = 'SUBMITTED' 
        ORDER BY created_at ASC 
        LIMIT 10
    ";
    
    $res_cash = $conn->query($sql_cash);
    if ($res_cash) {
        while ($row = $res_cash->fetch_assoc()) {
            // Format time relative to today
            $timeLabel = date('H:i', strtotime($row['created_at']));
            // If it's from a previous day, show date
            if (date('Y-m-d') !== date('Y-m-d', strtotime($row['created_at']))) {
                $timeLabel = date('M d', strtotime($row['created_at']));
            }

            $tasks[] = [
                'sort_time'   => strtotime($row['created_at']),
                'display_time'=> $timeLabel,
                'category'    => 'Operations',
                'description' => "New Cash Request [{$row['pr_id']}] for " . number_format($row['amount_total']) . " XAF requires validation.",
                'action_label'=> 'Verify',
                'action_type' => 'modal_cash_request', // Frontend handles this trigger
                'action_id'   => $row['pr_id'],
                'urgency'     => 'NORMAL'
            ];
        }
    }

    // ---------------------------------------------------------
    // SOURCE 2: OCR VARIANCE AUDIT
    // ---------------------------------------------------------
    // Logic: If Actual Spend > Budget by 15%, flag it.
    $sql_ocr = "
        SELECT 
            ocr_id, 
            operations_file_reference, 
            total_budget_ttc, 
            total_actual_ttc, 
            updated_at 
        FROM ocr_master 
        WHERE status = 'SUBMITTED'
    ";

    $res_ocr = $conn->query($sql_ocr);
    if ($res_ocr) {
        while ($row = $res_ocr->fetch_assoc()) {
            $budget = (float)$row['total_budget_ttc'];
            $actual = (float)$row['total_actual_ttc'];

            // Avoid division by zero
            if ($budget > 0) {
                $variance = ($actual - $budget) / $budget;

                // THRESHOLD: 15% (0.15)
                if ($variance > 0.15) {
                    $pct = round($variance * 100);
                    $tasks[] = [
                        'sort_time'   => strtotime($row['updated_at']),
                        'display_time'=> date('H:i', strtotime($row['updated_at'])),
                        'category'    => 'OCR System',
                        'description' => "High Variance ({$pct}%) detected on [{$row['operations_file_reference']}]. Review actuals vs budget.",
                        'action_label'=> 'Audit',
                        'action_type' => 'link_ocr_worksheet',
                        'action_id'   => $row['ocr_id'],
                        'urgency'     => 'CRITICAL' // Red highlight in frontend
                    ];
                }
            }
        }
    }

    // ---------------------------------------------------------
    // SOURCE 3: SYSTEM BOT (Events)
    // ---------------------------------------------------------
    // Pulls recent auto-generated events (Payment Confirmed, etc.)
    $sql_bot = "
        SELECT 
            event_title, 
            event_description, 
            created_at, 
            related_ref 
        FROM system_events_log 
        WHERE event_type = 'FINANCE' 
          AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY created_at DESC 
        LIMIT 5
    ";

    $res_bot = $conn->query($sql_bot);
    if ($res_bot) {
        while ($row = $res_bot->fetch_assoc()) {
            $tasks[] = [
                'sort_time'   => strtotime($row['created_at']),
                'display_time'=> date('H:i', strtotime($row['created_at'])),
                'category'    => 'System Bot',
                'description' => $row['event_description'],
                'action_label'=> 'Confirm', // Generic acknowledgement
                'action_type' => 'toast_ack',
                'action_id'   => $row['related_ref'],
                'urgency'     => 'NORMAL'
            ];
        }
    }

    // ---------------------------------------------------------
    // SORT & RETURN
    // ---------------------------------------------------------
    // Sort all tasks by time (Newest first)
    usort($tasks, function($a, $b) {
        return $b['sort_time'] - $a['sort_time'];
    });

    echo json_encode([
        'success' => true,
        'count'   => count($tasks),
        'data'    => $tasks
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Task Loading Error: ' . $e->getMessage()
    ]);
}
?>