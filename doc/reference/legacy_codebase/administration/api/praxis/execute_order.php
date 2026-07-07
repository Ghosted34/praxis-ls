<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - PRAXIS EXECUTION PIPELINE (Phase 4)
 * ======================================================================================
 * MODULE: AI Command Execution Pipeline
 * DESCRIPTION: Reads approved AI JSON payloads from `praxis_ai_staging`, parses the structured
 * data, and injects it securely into the core ERP modules (Operations, Procurement).
 * ======================================================================================
 */
declare(strict_types=1);
require_once __DIR__ . '/../includes/init.php'; 
require_once __DIR__ . '/../includes/role_guard.php';

header('Content-Type: application/json');

// Only authorized personnel can execute staged commands
require_role(['ADMIN', 'OPERATIONS', 'MANAGEMENT']);

$employeeId = $_SESSION['auth']['employee_id'] ?? '';
$data = json_decode(file_get_contents('php://input'), true);
$stagingId = (int)($data['staging_id'] ?? 0);

if ($stagingId <= 0) {
    echo json_encode(['success' => false, 'error' => 'Invalid Staging ID provided.']);
    exit;
}

$conn = db();

try {
    $conn->begin_transaction();

    // 1. Fetch the Staged Record
    $stmtFetch = $conn->prepare("SELECT module_type, raw_json_payload, status FROM praxis_ai_staging WHERE staging_id = ? FOR UPDATE");
    $stmtFetch->bind_param('i', $stagingId);
    $stmtFetch->execute();
    $stagedRecord = $stmtFetch->get_result()->fetch_assoc();

    if (!$stagedRecord) {
        throw new Exception("Staged record not found.");
    }
    if ($stagedRecord['status'] !== 'PENDING') {
        throw new Exception("This command has already been processed or rejected.");
    }

    $payload = json_decode($stagedRecord['raw_json_payload'], true);
    if (!$payload) {
        throw new Exception("Corrupted JSON payload in staging buffer.");
    }

    $moduleType = $stagedRecord['module_type'];
    $year = (int)date('Y');
    $generatedReference = '';

    // ======================================================================================
    // ROUTE 1: FREIGHT & TRANSIT ORDERS
    // ======================================================================================
    if ($moduleType === 'FREIGHT_ORDER' || $moduleType === 'CUSTOMS_REQUEST') {
        
        // Generate Official Transit Order (OT) Reference using your doc_sequences logic
        $conn->query("INSERT INTO doc_sequences (module_key, year, seq) VALUES ('TRANSIT_ORDER', $year, 1) ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)");
        $seqRes = $conn->query("SELECT LAST_INSERT_ID() AS seq")->fetch_assoc();
        $generatedReference = sprintf('OT-%d-%06d', $year, (int)$seqRes['seq']);
        
        $cargoDesc = $payload['order_details']['cargo_type'] ?? 'General Cargo';
        $mode = $payload['order_details']['mode'] ?? 'SEA';
        $origin = $payload['order_details']['origin'] ?? 'UNKNOWN';
        $dest = $payload['order_details']['destination'] ?? 'UNKNOWN';
        $vendorName = $payload['vendor_carrier']['name'] ?? 'PENDING ALLOCATION';
        
        // Insert into operations_file_master (or transit_order table depending on your exact schema)
        $stmtOps = $conn->prepare("INSERT INTO operations_file_master (
            operations_file_reference, type_of_operation, transport_mode, origin_location, 
            destination_location, cargo_description, carrier_vendor_name, status, created_by_employee_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)");
        
        $stmtOps->bind_param('ssssssss', 
            $generatedReference, $moduleType, $mode, $origin, $dest, 
            $cargoDesc, $vendorName, $employeeId
        );
        $stmtOps->execute();

    // ======================================================================================
    // ROUTE 2: PROCUREMENT / PURCHASE ORDERS
    // ======================================================================================
    } elseif ($moduleType === 'PROCUREMENT_ORDER') {
        
        // Generate Official Purchase Order (PO) Reference
        $conn->query("INSERT INTO doc_sequences (module_key, year, seq) VALUES ('PURCHASE_ORDER', $year, 1) ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)");
        $seqRes = $conn->query("SELECT LAST_INSERT_ID() AS seq")->fetch_assoc();
        $generatedReference = sprintf('PO-%d-%06d', $year, (int)$seqRes['seq']);

        $vendorName = $payload['vendor_carrier']['name'] ?? 'UNKNOWN VENDOR';
        $totalAmount = (float)($payload['total_amount'] ?? 0);
        $currency = $payload['currency'] ?? 'XAF';

        $stmtPo = $conn->prepare("INSERT INTO purchase_orders (
            po_reference, vendor_name, currency, total_amount, status, created_by_employee_id
        ) VALUES (?, ?, ?, ?, 'DRAFT', ?)");
        $stmtPo->bind_param('sssds', $generatedReference, $vendorName, $currency, $totalAmount, $employeeId);
        $stmtPo->execute();

    // ======================================================================================
    // ROUTE 3: WAREHOUSING
    // ======================================================================================
    } elseif ($moduleType === 'WAREHOUSE_REQUEST') {
        
        $conn->query("INSERT INTO doc_sequences (module_key, year, seq) VALUES ('WAREHOUSE_REQ', $year, 1) ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)");
        $seqRes = $conn->query("SELECT LAST_INSERT_ID() AS seq")->fetch_assoc();
        $generatedReference = sprintf('WR-%d-%06d', $year, (int)$seqRes['seq']);
        
        // Assuming an inventory or warehouse_requests table
        $stmtWh = $conn->prepare("INSERT INTO warehouse_requests (
            warehouse_req_reference, client_name, expected_volume_cbm, status, created_by_employee_id
        ) VALUES (?, ?, ?, 'PENDING_SPACE', ?)");
        
        $clientName = $payload['client']['name'] ?? 'INTERNAL';
        $volume = (float)($payload['order_details']['volume_cbm'] ?? 0);
        
        $stmtWh->bind_param('ssds', $generatedReference, $clientName, $volume, $employeeId);
        $stmtWh->execute();

    } else {
        throw new Exception("Unrecognized module_type: " . $moduleType);
    }

    // ======================================================================================
    // FINALIZE: UPDATE STAGING RECORD
    // ======================================================================================
    $stmtUpdateStaging = $conn->prepare("UPDATE praxis_ai_staging SET status = 'APPROVED', target_reference_id = ?, processed_at = NOW() WHERE staging_id = ?");
    $stmtUpdateStaging->bind_param('si', $generatedReference, $stagingId);
    $stmtUpdateStaging->execute();

    $conn->commit();
    
    echo json_encode([
        'success' => true, 
        'message' => 'Command successfully executed and recorded.',
        'reference_id' => $generatedReference
    ]);

} catch (Exception $e) {
    if (isset($conn) && $conn->ping()) {
        $conn->rollback();
    }
    
    // If the execution fails, mark it in the staging table so it doesn't get stuck
    if (isset($conn) && $conn->ping() && $stagingId > 0) {
        $conn->query("UPDATE praxis_ai_staging SET status = 'FAILED', processed_at = NOW() WHERE staging_id = $stagingId");
    }
    
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}