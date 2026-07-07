<?php
/**
 * SMART LS ERP - OPERATIONS DASHBOARD API (KPIs)
 * -------------------------------------------------------------------------
 * Returns the 4 Key Performance Indicators for the Ops Control Center.
 * 1. Files in Transit (Active)
 * 2. Milestones Due (Today) -> Calculated via Class
 * 3. Late Deliveries (At Risk)
 * 4. Pending OCR (Closure)
 * -------------------------------------------------------------------------
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Adjust path if your class is in a different folder (e.g., classes/)
require_once __DIR__ . '/../../classes/MilestoneCalculator.php'; 

require_role(['OPERATIONS', 'ADMIN', 'MANAGEMENT']);

header('Content-Type: application/json');

try {
    $conn = db();
    $todayStr = date('Y-m-d');
    
    // ---------------------------------------------------
    // 1. SIMPLE SQL COUNTERS
    // ---------------------------------------------------

    // KPI 1: Active Files (OPEN or IN_PROGRESS)
    $sqlActive = "SELECT COUNT(*) as cnt FROM operations_file_master WHERE operations_status IN ('OPEN', 'IN_PROGRESS')";
    $resActive = $conn->query($sqlActive);
    $activeCount = $resActive->fetch_assoc()['cnt'] ?? 0;

    // KPI 3: Late Deliveries (Expected Delivery < NOW and NOT completed)
    // We exclude 'NOT_AWARDED', 'COMPLETED', 'OPERATIONALLY_COMPLETED'
    $sqlLate = "
        SELECT COUNT(*) as cnt 
        FROM operations_file_master 
        WHERE expected_delivery_time < NOW() 
        AND operations_status NOT IN ('OPERATIONALLY_COMPLETED', 'COMPLETED', 'NOT_AWARDED')
    ";
    $resLate = $conn->query($sqlLate);
    $lateCount = $resLate->fetch_assoc()['cnt'] ?? 0;

    // KPI 4: Pending OCR (Operationally Completed but Missing or Invalid OCR)
    // Checks if ocr_id is NULL OR if it exists but status is not VALIDATED
    $sqlOcr = "
        SELECT COUNT(*) as cnt 
        FROM operations_file_master ofm
        LEFT JOIN ocr_master om ON ofm.ocr_id = om.ocr_id
        WHERE ofm.operations_status = 'OPERATIONALLY_COMPLETED' 
        AND (ofm.ocr_id IS NULL OR ofm.ocr_id = '' OR om.status != 'VALIDATED')
    ";
    $resOcr = $conn->query($sqlOcr);
    $ocrCount = $resOcr->fetch_assoc()['cnt'] ?? 0;

    // ---------------------------------------------------
    // 2. COMPLEX CALCULATION: MILESTONES DUE TODAY
    // ---------------------------------------------------
    
    $milestonesDueCount = 0;
    $calc = new MilestoneCalculator();

    // Fetch all active files with their milestone dates
    $sqlMilestones = "
        SELECT 
            operations_file_reference,
            service_type,
            created_at,
            expected_delivery_time,
            m0_completed_at, m1_completed_at, m2_completed_at, m3_completed_at,
            m4_completed_at, m5_completed_at, m6_completed_at, m7_completed_at,
            m8_completed_at, m9_completed_at, m10_completed_at, m11_completed_at,
            m12_completed_at, m13_completed_at
        FROM operations_file_master
        WHERE operations_status IN ('OPEN', 'IN_PROGRESS')
    ";
    $resM = $conn->query($sqlMilestones);

    while ($row = $resM->fetch_assoc()) {
        // Build the progress array required by your Calculator
        $progressData = [];
        for ($i = 0; $i <= 13; $i++) {
            $col = "m{$i}_completed_at";
            if (!empty($row[$col])) {
                $progressData[$i] = $row[$col];
            }
        }

        // Run the calculator logic
        $timeline = $calc->calculateTimeline(
            $row['service_type'],
            $row['created_at'],
            $row['expected_delivery_time'],
            $progressData
        );

        // Scan the schedule for items due TODAY (or earlier) that are still PENDING
        foreach ($timeline['schedule'] as $stage) {
            if ($stage['status'] === 'pending' && !empty($stage['due_at'])) {
                $dueDateOnly = date('Y-m-d', strtotime($stage['due_at']));
                // If it is due today or was due in the past (overdue), it counts as "Due"
                if ($dueDateOnly <= $todayStr) {
                    $milestonesDueCount++;
                    // Break so we only count 1 due milestone per file (avoids double counting a single bad file)
                    break; 
                }
            }
        }
    }

    // ---------------------------------------------------
    // 3. RETURN JSON
    // ---------------------------------------------------
    echo json_encode([
        'success' => true,
        'data' => [
            'kpi_active_transit' => (int)$activeCount,
            'kpi_milestones_due' => (int)$milestonesDueCount,
            'kpi_late_deliveries' => (int)$lateCount,
            'kpi_pending_ocr'    => (int)$ocrCount
        ]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}