<?php
/**
 * SMART LS ERP - OPERATIONS TASK FEED (GOLD MASTER)
 * -------------------------------------------------------------------------
 * 1. REJECTIONS: From Document Vault (Personalized)
 * 2. COMPLIANCE: Missing Evidence for Cash Requests (Personalized)
 * 3. BOT ALERTS:
 * - Customs: Discharged (M3) -> Needs Customs (M4)
 * - Transit Order: Customs (M4) -> Needs TO (M8) [Checks DB]
 * - Delivery Note: Loaded (M8/M4/M10) -> Needs DN [Checks DB]
 * -------------------------------------------------------------------------
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['OPERATIONS', 'ADMIN']);

header('Content-Type: application/json');
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

try {
    $conn = db();
    $tasks = [];

    // --- 1. USER IDENTIFICATION ---
    $myEmpId  = $_SESSION['auth']['employee_id'] ?? ''; 
    
    // Safety: If session is lost, return empty list instead of crashing
    if (empty($myEmpId)) { 
        echo json_encode(['success'=>true, 'data'=>[]]); 
        exit; 
    }

    // =================================================================================
    // SOURCE 1: MY REJECTED DOCUMENTS
    // =================================================================================
    $sqlRejects = "
        SELECT doc_id, doc_uuid, doc_reference, user_filename, rejection_note, uploaded_at 
        FROM document_vault_master 
        WHERE status = 'REJECTED' 
        AND uploaded_by = ? 
        LIMIT 20
    ";
    $stmt = $conn->prepare($sqlRejects);
    $stmt->bind_param('s', $myEmpId);
    $stmt->execute();
    $resRejects = $stmt->get_result();

    while ($row = $resRejects->fetch_assoc()) {
        // [FIX] Added File Ref to Description
        $fileRef = $row['doc_reference'] ? "[{$row['doc_reference']}] " : "";
        
        $tasks[] = [
            'id'           => 'rej_' . $row['doc_id'],
            'time'         => $row['uploaded_at'] ? date('H:i', strtotime($row['uploaded_at'])) : '09:00',
            'source'       => 'Compliance',
            'description'  => "REJECTED: {$fileRef}{$row['user_filename']}",
            'action_label' => 'Fix Doc',
            'action_type'  => 'FIX_DOC',
            'ref'          => $row['doc_uuid'],
            'urgency'      => 'critical'
        ];
    }

    // =================================================================================
    // SOURCE 2: MY MISSING EVIDENCE (Fixed Column Name)
    // =================================================================================
    $sqlMissing = "
        SELECT crl.line_id, crl.line_desc, crl.pr_id, crm.ops_file_ref
        FROM cash_request_lines crl
        JOIN cash_request_master crm ON crl.pr_id = crm.pr_id
        WHERE crl.justification_required = 1
        AND crm.created_by = ? 
        AND NOT EXISTS (
            SELECT 1 FROM document_vault_master dv 
            WHERE dv.pr_linked_id = CAST(crl.line_id AS CHAR)
            AND dv.status != 'REJECTED'
        )
        LIMIT 20
    ";
    
    $stmt2 = $conn->prepare($sqlMissing);
    $stmt2->bind_param('s', $myEmpId);
    $stmt2->execute();
    $resMissing = $stmt2->get_result();

    while ($row = $resMissing->fetch_assoc()) {
        // Build the File Reference string if it exists
        $fileRef = $row['ops_file_ref'] ? "[{$row['ops_file_ref']}] " : "";

        $tasks[] = [
            'id'           => 'miss_' . $row['line_id'],
            'time'         => 'Pending',
            'source'       => 'Audit Bot',
            'description'  => "Missing Evidence {$fileRef}for {$row['line_desc']}",
            'action_label' => 'Resolve',
            'action_type'  => 'RESOLVE_EVIDENCE',
            'ref'          => $row['pr_id'],
            'urgency'      => 'critical'
        ];
    }

    // =================================================================================
    // SOURCE 3: SYSTEM BOT (The "Smart Track" Engine)
    // =================================================================================
    $sqlScan = "
        SELECT 
            operations_file_reference,
            service_type,
            expected_delivery_time,
            m3_completed_at,
            m4_completed_at,
            m8_completed_at,
            m10_completed_at
        FROM operations_file_master
        WHERE operations_status IN ('OPEN', 'IN_PROGRESS')
        ORDER BY expected_delivery_time ASC
        LIMIT 100
    ";
    
    $resScan = $conn->query($sqlScan);
    if($resScan) {
        while ($file = $resScan->fetch_assoc()) {
            $ref = $file['operations_file_reference'];
            // SECURITY: Sanitize ref for the inner queries
            $safeRef = $conn->real_escape_string($ref);
            $edd = $file['expected_delivery_time'];
            
            // --- A. EDD WARNING (Delivery in < 48 Hours) ---
            if ($edd) {
                $hoursUntil = (strtotime($edd) - time()) / 3600;
                if ($hoursUntil > 0 && $hoursUntil < 48) {
                    $tasks[] = [
                        'id'           => 'edd_' . $ref,
                        'time'         => date('H:i'),
                        'source'       => 'Smart Track',
                        'description'  => "[{$ref}] delivery deadline in < 48h. Confirm readiness. Mail client",
                        'action_label' => 'Confirm',
                        'action_type'  => 'CONFIRM_EDD',
                        'ref'          => $ref,
                        'urgency'      => 'urgent'
                    ];
                }
            }

            // --- B. CUSTOMS PREP (Discharged M3 -> Needs Customs M4) ---
            if ($file['service_type'] === 'SEA_FREIGHT_IMPORT' && !empty($file['m3_completed_at']) && empty($file['m4_completed_at'])) {
                $lastUpdate = date('H:i', strtotime($file['m3_completed_at']));
                $tasks[] = [
                    'id'           => 'bot_cust_' . $ref,
                    'time'         => $lastUpdate,
                    'source'       => 'Milestone Tracker',
                    'description'  => "Cargo Discharged for File Ref. [{$ref}]. Update Milestone to Customs Declaration.",
                    'action_label' => 'Update MS',
                    'action_type'  => 'TRACK_FILE',
                    'ref'          => $ref,
                    'urgency'      => 'normal'
                ];
            }

            // --- C. TRANSIT ORDER (Customs M4 -> Needs Loading M8) ---
            elseif ($file['service_type'] === 'SEA_FREIGHT_IMPORT' && !empty($file['m4_completed_at']) && empty($file['m8_completed_at'])) {
                // Strict Check: Does a TO exist in 'transit_orders'?
                $chkTO = $conn->query("SELECT 1 FROM transit_orders WHERE operation_file_ref = '$safeRef' LIMIT 1");
                if ($chkTO && $chkTO->num_rows == 0) {
                     // 24h Grace Period
                     $custTime = strtotime($file['m4_completed_at']);
                     if ((time() - $custTime) > 86400) {
                         $tasks[] = [
                            'id'           => 'bot_to_' . $ref,
                            'time'         => $lastUpdate,
                            'source'       => 'Logistics',
                            'description'  => "Customs cleared for File Ref. [{$ref}]. You should Issue Transit Order (TO) to and send to client.",
                            'action_label' => 'Issue TO',
                            'action_type'  => 'ISSUE_TO',
                            'ref'          => $ref,
                            'urgency'      => 'normal'
                         ];
                     }
                }
            }

            // --- D. DELIVERY NOTE (Loaded -> Needs DN) ---
            $readyForDN = false;
            // 1. Sea Import (Loaded M8)
            if ($file['service_type'] === 'SEA_FREIGHT_IMPORT' && !empty($file['m8_completed_at'])) $readyForDN = true;
            // 2. Air Import (Dispatch M10)
            elseif ($file['service_type'] === 'AIR_FREIGHT_IMPORT' && !empty($file['m10_completed_at'])) $readyForDN = true;
            // 3. Hinterland (Loaded M4) [RESTORED]
            elseif ($file['service_type'] === 'HINTERLAND_TRANSIT' && !empty($file['m4_completed_at'])) $readyForDN = true;

            if ($readyForDN) {
                // Strict Check: Does a DN exist in 'delivery_notes'?
                $chkDN = $conn->query("SELECT 1 FROM delivery_notes WHERE file_ref = '$safeRef' LIMIT 1");
                if ($chkDN && $chkDN->num_rows == 0) {
                     $tasks[] = [
                        'id'           => 'bot_dn_' . $ref,
                        'time'         => $lastUpdate,
                        'source'       => 'Ops Delivery',
                        'description'  => "Cargo loaded for File Ref. [{$ref}]. Issue Delivery Note now to secure Proof of Delivery (POD) for Invoicing.",
                        'action_label' => 'Issue DN',
                        'action_type'  => 'ISSUE_DN',
                        'ref'          => $ref,
                        'urgency'      => 'High'
                     ];
                }
            }
        }
    }

    // Final Sort: Critical Items First
    usort($tasks, function($a, $b) {
        $urgencyScore = ['critical' => 3, 'urgent' => 2, 'normal' => 1];
        if ($urgencyScore[$b['urgency']] !== $urgencyScore[$a['urgency']]) {
            return $urgencyScore[$b['urgency']] - $urgencyScore[$a['urgency']];
        }
        return strcmp($b['time'], $a['time']);
    });

    echo json_encode(['success' => true, 'data' => $tasks]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>