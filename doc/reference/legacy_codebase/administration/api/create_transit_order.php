<?php
declare(strict_types=1);

// Adjust paths to match your folder structure
require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';

// Only authorized roles can create documents
require_role(['ADMIN','OPERATIONS','MANAGEMENT']);

header('Content-Type: application/json');

// 1. Get POST Data
$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    echo json_encode(['ok' => false, 'error' => 'No data received']);
    exit;
}

$conn = db();

try {
    // 2. Validate Essential Data
    $fileId = (int)($input['file_id'] ?? 0);
    if ($fileId <= 0) {
        throw new Exception("No valid Operation File selected.");
    }

    $createdBy = (int)($_SESSION['auth']['user_id'] ?? 0);
    
    // Start Transaction to safely generate number
    $conn->begin_transaction();

    // 3. Generate Next Sequence Number (Atomic Lock)
    // We select the highest current sequence number for update
    $sqlSeq = "SELECT MAX(ot_number_sequence) as max_seq FROM transit_orders FOR UPDATE";
    $resSeq = $conn->query($sqlSeq);
    $rowSeq = $resSeq->fetch_assoc();
    
    $nextSeq = ($rowSeq['max_seq'] ?? 99) + 1; // Start at 100 if table is empty
    $fullOtNumber = 'SLAS/OT/' . str_pad((string)$nextSeq, 5, '0', STR_PAD_LEFT);

    // 4. Prepare Data for Insertion
    $val        = (float)($input['declared_value'] ?? 0);
    $direction  = $conn->real_escape_string($input['service_direction'] ?? 'IMPORT');
    $regime     = $conn->real_escape_string($input['customs_regime'] ?? 'IM4');
    $insurance  = $conn->real_escape_string($input['insurance_type'] ?? 'CLIENT');
    $deptDate   = !empty($input['transit_departure_date']) ? $input['transit_departure_date'] : null;
    
    // JSON encode the checkbox array
    $docsJson   = json_encode($input['submitted_docs'] ?? []);

    // 5. Insert Record
    $sqlInsert = "INSERT INTO transit_orders 
        (operation_file_id, ot_number_sequence, ot_number_full, declared_value, service_direction, customs_regime, insurance_type, transit_departure_date, submitted_docs, created_by_user_id)
        VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    $stmt = $conn->prepare($sqlInsert);
    $stmt->bind_param('iisdsssssi', 
        $fileId, 
        $nextSeq, 
        $fullOtNumber, 
        $val, 
        $direction, 
        $regime, 
        $insurance, 
        $deptDate, 
        $docsJson, 
        $createdBy
    );

    if (!$stmt->execute()) {
        throw new Exception("Database Error: " . $stmt->error);
    }

    $newId = $stmt->insert_id;

    // Commit the transaction
    $conn->commit();

    // 6. Return Success
    echo json_encode([
        'ok' => true,
        'id' => $newId,
        'ot_number' => $fullOtNumber
    ]);

} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}