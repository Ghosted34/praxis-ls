<?php
/**
 * ============================================================================
 * SMART LS - COST TRACKING API ENDPOINTS v2.0
 * ============================================================================
 * File: api/finance/cost-tracking-api.php
 * Purpose: Backend API for Cost Tracking Master Sheet
 * Version: 2.0 (Updated to match actual operations_file_master schema)
 * ============================================================================
 */

declare(strict_types=1);
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Set JSON response header
$action = $_GET['action'] ?? $_POST['action'] ?? '';

if ($action !== 'export_data') {
  header('Content-Type: application/json; charset=utf-8');
}


// Security: Require authentication
if (!isset($_SESSION['auth']['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$userId = (int)$_SESSION['auth']['user_id'];
$action = $_GET['action'] ?? $_POST['action'] ?? '';

// ============================================================================
// COST ITEMS CONFIGURATION
// ============================================================================
const COST_ITEMS = [
    "Brokerage Fees",   
    "Caution",
    "Customs Clearance",  
    "Demurrage",
    "Destination Fees",
    "Detention",
    "Endorsement",
    "Freight Cost",
    "Port Charges",          
    "Scanning Fees",       
    "Shipping Line Charges", 
    "Staff Transportation",
    "Storage",
    "Transport",
    "Yard Occupancy"
];

// ============================================================================
// ROUTING
// ============================================================================

try {
    $conn = db();
    
    switch ($action) {
        case 'get_files':
            getAvailableFiles($conn);
            break;
            
        case 'get_tracker_data':
            getTrackerData($conn);
            break;
            
        case 'get_file_details':
            $fileRef = $_GET['file_ref'] ?? '';
            getFileDetails($conn, $fileRef);
            break;
            
        case 'save_costs':
            $input = json_decode(file_get_contents('php://input'), true);
            saveCosts($conn, $input, $userId);
            break;
            
        case 'get_kpis':
            getKPIs($conn);
            break;
            
        case 'export_data':
            exportToCSV($conn);
            break;
            
        default:
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid action']);
    }
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false, 
        'error' => 'Server error: ' . $e->getMessage()
    ]);
}

// ============================================================================
// FUNCTION: Get Available Files (SEA Freight Only)
// ============================================================================
function getAvailableFiles($conn) {
    $sql = "
        SELECT 
            operations_file_reference AS id,
            client_name AS client,
            sea_bl AS bl,
            COALESCE(ata, eta) AS ata,
            place_delivery AS dest,
            service_type AS service
        FROM operations_file_master
        WHERE service_type IN (
            'SEA_FREIGHT_IMPORT',
            'SEA_FREIGHT_EXPORT',
            'END_TO_END_SEA_FREIGHT',
            'HINTERLAND_TRANSIT'
        )
        AND operations_status NOT IN ('CLOSED', 'NOT_AWARDED')
        ORDER BY COALESCE(ata, eta) DESC
    ";
    
    $result = $conn->query($sql);
    $files = [];
    
    while ($row = $result->fetch_assoc()) {
        // Format service type for display
        $service = str_replace('_', ' ', $row['service']);
        $service = ucwords(strtolower($service));
        
        $files[] = [
            'id' => $row['id'],
            'client' => $row['client'] ?: 'N/A',
            'bl' => $row['bl'] ?: 'N/A',
            'ata' => $row['ata'] ? date('Y-m-d', strtotime($row['ata'])) : 'TBD',
            'dest' => $row['dest'] ?: 'N/A',
            'service' => $service
        ];
    }
    
    echo json_encode(['success' => true, 'files' => $files]);
}

// ============================================================================
// FUNCTION: Get All Tracker Data (Horizontal Format)
// ============================================================================
function getTrackerData($conn) {
    // Fetch all ledgers with their entries
    $sql = "
        SELECT 
            l.operations_file_reference,
            l.manual_status,
            e.item_name,
            e.actual_cost,
            e.advance_received
        FROM cost_tracking_ledger l
        LEFT JOIN cost_entries e ON l.ledger_id = e.ledger_id
        ORDER BY l.operations_file_reference, e.item_name
    ";
    
    $result = $conn->query($sql);
    $data = [];
    
    while ($row = $result->fetch_assoc()) {
        $ref = $row['operations_file_reference'];
        
        // Initialize file if not exists
        if (!isset($data[$ref])) {
            $data[$ref] = [
                'costs' => array_fill(0, count(COST_ITEMS), 0),
                'adv' => array_fill(0, count(COST_ITEMS), 0),
                'status' => $row['manual_status'] === 'ON_HOLD' ? 'ON HOLD' : 'NOT STARTED'
            ];
        }
        
        // Map item to its index
        $itemName = $row['item_name'];
        $idx = array_search($itemName, COST_ITEMS);
        
        if ($idx !== false && $itemName !== null) {
            $data[$ref]['costs'][$idx] = (float)$row['actual_cost'];
            $data[$ref]['adv'][$idx] = (float)$row['advance_received'];
        }
    }
    
    // Recalculate statuses after all data is loaded
    foreach ($data as $ref => &$fileData) {
        $fileData['status'] = calculateStatus(
            $fileData['status'],
            $fileData['costs'],
            $fileData['adv']
        );
    }
    
    echo json_encode(['success' => true, 'data' => $data]);
}

// ============================================================================
// FUNCTION: Get Details for a Specific File
// ============================================================================
function getFileDetails($conn, $fileRef) {
    if (empty($fileRef)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'File reference required']);
        return;
    }
    
    // Get file info
    $stmtFile = $conn->prepare("
        SELECT * FROM view_cost_tracking_master 
        WHERE file_ref_no = ?
    ");
    $stmtFile->bind_param('s', $fileRef);
    $stmtFile->execute();
    $fileInfo = $stmtFile->get_result()->fetch_assoc();
    
    if (!$fileInfo) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'File not found']);
        return;
    }
    
    // Get cost breakdown
    $stmtCosts = $conn->prepare("
        SELECT 
            item_name,
            actual_cost,
            advance_received,
            notes,
            updated_at
        FROM view_cost_item_details
        WHERE file_ref_no = ?
        ORDER BY item_name
    ");
    $stmtCosts->bind_param('s', $fileRef);
    $stmtCosts->execute();
    $result = $stmtCosts->get_result();
    
    $costs = [];
    while ($row = $result->fetch_assoc()) {
        $costs[] = $row;
    }
    
    echo json_encode([
        'success' => true,
        'file' => $fileInfo,
        'costs' => $costs
    ]);
}

// ============================================================================
// FUNCTION: Save Cost Data
// ============================================================================
function saveCosts($conn, $input, $userId) {
    $fileRef = $input['file_ref_no'] ?? '';
    $costs = $input['costs'] ?? [];
    $advances = $input['advances'] ?? [];
    $manualStatus = $input['status'] ?? 'AUTO';
    
    // Validation
    if (empty($fileRef)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'File reference required']);
        return;
    }
    
    // Validate file exists and is SEA freight
    $stmtValidate = $conn->prepare("
        SELECT operations_file_reference 
        FROM operations_file_master 
        WHERE operations_file_reference = ?
        AND service_type IN (
            'SEA_FREIGHT_IMPORT',
            'SEA_FREIGHT_EXPORT',
            'END_TO_END_SEA_FREIGHT',
            'HINTERLAND_TRANSIT'
        )
    ");
    $stmtValidate->bind_param('s', $fileRef);
    $stmtValidate->execute();
    if ($stmtValidate->get_result()->num_rows === 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid file reference or not a SEA freight operation']);
        return;
    }
    
    // Normalize status value
    if ($manualStatus === 'ON HOLD') {
        $manualStatus = 'ON_HOLD';
    } elseif ($manualStatus !== 'AUTO' && $manualStatus !== 'ON_HOLD') {
        $manualStatus = 'AUTO';
    }
    
    // Start transaction
    $conn->begin_transaction();
    
    try {
        // 1. Get or create ledger entry
        $stmtLedger = $conn->prepare("
            INSERT INTO cost_tracking_ledger 
                (operations_file_reference, manual_status, created_by_user_id, updated_by_user_id)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                manual_status = VALUES(manual_status),
                updated_by_user_id = VALUES(updated_by_user_id),
                updated_at = CURRENT_TIMESTAMP
        ");
        $stmtLedger->bind_param('ssii', $fileRef, $manualStatus, $userId, $userId);
        $stmtLedger->execute();
        
        // Get ledger ID
        $ledgerId = $conn->insert_id;
        if ($ledgerId == 0) {
            $stmtGetId = $conn->prepare("
                SELECT ledger_id 
                FROM cost_tracking_ledger 
                WHERE operations_file_reference = ?
            ");
            $stmtGetId->bind_param('s', $fileRef);
            $stmtGetId->execute();
            $ledgerId = $stmtGetId->get_result()->fetch_column();
        }
        
        // 2. Update cost entries
        $stmtEntry = $conn->prepare("
            INSERT INTO cost_entries 
                (ledger_id, item_name, actual_cost, advance_received)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                actual_cost = VALUES(actual_cost),
                advance_received = VALUES(advance_received),
                updated_at = CURRENT_TIMESTAMP
        ");
        
        foreach (COST_ITEMS as $idx => $itemName) {
            $cost = (float)($costs[$idx] ?? 0);
            $advance = (float)($advances[$idx] ?? 0);
            
            $stmtEntry->bind_param('isdd', $ledgerId, $itemName, $cost, $advance);
            $stmtEntry->execute();
        }
        
        $conn->commit();
        
        echo json_encode([
            'success' => true,
            'message' => 'Cost data saved successfully',
            'ledger_id' => $ledgerId
        ]);
        
    } catch (Exception $e) {
        $conn->rollback();
        throw $e;
    }
}

// ============================================================================
// FUNCTION: Get KPIs
// ============================================================================
function getKPIs($conn) {
    $sql = "SELECT * FROM view_cost_tracking_kpis";
    $result = $conn->query($sql);
    $kpis = $result->fetch_assoc();
    
    // If no data, return zeros
    if (!$kpis) {
        $kpis = [
            'total_files_tracked' => 0,
            'files_auto_status' => 0,
            'files_on_hold' => 0,
            'total_costs_incurred' => 0,
            'total_advances_received' => 0,
            'total_balance_outstanding' => 0,
            'avg_cost_per_item' => 0,
            'avg_advance_per_item' => 0,
            'overall_coverage_pct' => 0
        ];
    }
    
    echo json_encode(['success' => true, 'kpis' => $kpis]);
}

// ============================================================================
// FUNCTION: Export to CSV
// ============================================================================
function exportToCSV($conn) {
    // Ensure no buffered output corrupts CSV
    while (ob_get_level() > 0) { ob_end_clean(); }

    $sql = "
        SELECT 
            v.file_ref_no,
            v.client_name,
            v.bl_number,
            v.arrival_date,
            v.destination,
            v.service_type,
            v.total_cost,
            v.total_advance,
            v.total_balance,
            v.calculated_status,
            v.coverage_percentage
        FROM view_cost_tracking_master v
        ORDER BY v.arrival_date DESC
    ";

    $result = $conn->query($sql);
    if (!$result) {
        throw new Exception('Export query failed: ' . $conn->error);
    }

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="cost_tracking_export_' . date('Y-m-d_His') . '.csv"');

    $output = fopen('php://output', 'w');

    // UTF-8 BOM for Excel
    fprintf($output, chr(0xEF) . chr(0xBB) . chr(0xBF));

    // Header row
    fputcsv($output, [
        'File Reference',
        'Client',
        'BL Number',
        'Arrival Date',
        'Destination',
        'Service Type',
        'Total Cost (XAF)',
        'Total Advance (XAF)',
        'Balance Due (XAF)',
        'Status',
        'Coverage %'
    ]);

    while ($row = $result->fetch_assoc()) {

        // ✅ FORCE numeric casting (CRITICAL FIX)
        $totalCost    = (float) $row['total_cost'];
        $totalAdvance = (float) $row['total_advance'];
        $totalBalance = (float) $row['total_balance'];
        $coveragePct  = (float) $row['coverage_percentage'];

        $serviceType = str_replace('_', ' ', (string)$row['service_type']);

        fputcsv($output, [
            (string)$row['file_ref_no'],
            (string)$row['client_name'],
            $row['bl_number'] ?: 'N/A',
            $row['arrival_date'] ? date('Y-m-d', strtotime($row['arrival_date'])) : 'TBD',
            $row['destination'] ?: 'N/A',
            ucwords(strtolower($serviceType)),
            number_format($totalCost, 2, '.', ''),
            number_format($totalAdvance, 2, '.', ''),
            number_format($totalBalance, 2, '.', ''),
            (string)$row['calculated_status'],
            number_format($coveragePct, 2, '.', '')
        ]);
    }

    fclose($output);
    exit;
}


// ============================================================================
// HELPER: Calculate Status
// ============================================================================
function calculateStatus($manualStatus, $costs, $advances) {
    // If manual status is "ON HOLD", respect it
    if ($manualStatus === 'ON HOLD' || $manualStatus === 'ON_HOLD') {
        return 'ON HOLD';
    }
    
    $totalCost = array_sum($costs);
    $totalAdvance = array_sum($advances);
    $balance = $totalCost - $totalAdvance;
    
    if ($totalCost == 0) {
        return 'NOT STARTED';
    } elseif ($balance <= 0) {
        return 'COMPLETED';
    } else {
        return 'IN PROGRESS';
    }
}

/**
 * Helper function to format currency
 */
function formatCurrency($amount) {
    return number_format($amount, 2, '.', ',') . ' XAF';
}