<?php
require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'OPERATIONS']);

$conn = db();

try {
    $conn->begin_transaction();

    // 1. Lock the counter to prevent duplicates (Race Condition Proof)
    $stmt = $conn->prepare("SELECT current_value FROM system_sequences WHERE sequence_name = 'costing_ref' FOR UPDATE");
    $stmt->execute();
    $res = $stmt->get_result();

    if ($res->num_rows === 0) {
        // Auto-heal: If row missing, create it starting at 2300
        $conn->query("INSERT INTO system_sequences (sequence_name, current_value) VALUES ('costing_ref', 2300)");
        $nextNum = 2301;
    } else {
        $row = $res->fetch_assoc();
        $nextNum = $row['current_value'] + 1;
    }

    // 2. Increment the counter
    $update = $conn->prepare("UPDATE system_sequences SET current_value = ? WHERE sequence_name = 'costing_ref'");
    $update->bind_param('i', $nextNum);
    $update->execute();

    $conn->commit();

    // 3. Format: SLAS-COST-0002301
    $formattedId = 'SLAS-COST-' . str_pad((string)$nextNum, 7, '0', STR_PAD_LEFT);

    echo json_encode(['ok' => true, 'data' => ['next_id' => $formattedId]]);

} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}