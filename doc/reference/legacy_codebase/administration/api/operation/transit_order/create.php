<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';

// ... (Security checks remain the same) ...
if (empty($_SESSION['auth']['user_id'])) {
    json_response(['ok' => false, 'error' => 'Not logged in'], 401);
}

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    json_response(['ok' => false, 'error' => 'No data received'], 400);
}

try {
    $conn = db();
    
    // --- CHANGE 1: Validate Reference String instead of ID ---
    $fileRef = trim((string)($input['file_ref'] ?? ''));
    if ($fileRef === '') {
        throw new Exception("No valid Operation File Reference provided.");
    }

    $createdBy = (int)$_SESSION['auth']['user_id'];

    $conn->begin_transaction();

    // Generate Sequence (Same as before)
    $sqlSeq = "SELECT MAX(ot_number_sequence) as max_seq FROM transit_orders FOR UPDATE";
    $resSeq = $conn->query($sqlSeq);
    $rowSeq = $resSeq->fetch_assoc();
    $nextSeq = ($rowSeq['max_seq'] ?? 99) + 1;
    $fullOtNumber = 'SLAS/OT/' . str_pad((string)$nextSeq, 5, '0', STR_PAD_LEFT);

    // Prepare Data
    $val        = (float)($input['declared_value'] ?? 0);
    $direction  = $conn->real_escape_string($input['service_direction'] ?? 'IMPORT');
    $regime     = $conn->real_escape_string($input['customs_regime'] ?? 'IM4');
    $insurance  = $conn->real_escape_string($input['insurance_type'] ?? 'CLIENT');
    $deptDate   = !empty($input['transit_departure_date']) ? $input['transit_departure_date'] : null;
    $docsJson   = json_encode($input['submitted_docs'] ?? []);

    // --- CHANGE 2: Insert using operation_file_ref ---
    $sqlInsert = "INSERT INTO transit_orders 
        (operation_file_ref, ot_number_sequence, ot_number_full, declared_value, service_direction, customs_regime, insurance_type, transit_departure_date, submitted_docs, created_by_user_id)
        VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    $stmt = $conn->prepare($sqlInsert);
    // Note the first type char is 's' (string) now, not 'i' (integer)
    $stmt->bind_param('sisdsssssi', 
        $fileRef,       // The string "SL1916449SM"
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
        throw new Exception("Execute failed: " . $stmt->error);
    }

    $newId = $stmt->insert_id;
    $conn->commit();

    json_response([
        'ok' => true,
        'id' => $newId,
        'ot_number' => $fullOtNumber
    ]);

} catch (Exception $e) {
    if (isset($conn)) $conn->rollback();
    json_response(['ok' => false, 'error' => $e->getMessage()], 500);
}