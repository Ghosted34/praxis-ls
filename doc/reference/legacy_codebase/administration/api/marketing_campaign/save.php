<?php
/**
 * Marketing Campaign Save API - SMART LS
 * Handles Create/Update with Management Approval & Rejection Logic
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Only Admin, Management, and Sales can interact with this endpoint
require_role(['ADMIN', 'MANAGEMENT', 'SALES']);

$data = json_decode(file_get_contents('php://input'), true);

if (!$data) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON payload received.']);
    exit;
}

$conn = db();
$userRole = $_SESSION['auth']['role'] ?? 'SALES';
$currentUserId = (int)($_SESSION['auth']['user_id'] ?? 0);

// --- 1. Sanitize & Prepare Inputs ---
$id               = $data['id'] ?? '';
$name             = trim((string)($data['name'] ?? ''));
$remarks          = trim((string)($data['remarks'] ?? '')); 
$rejection_reason = isset($data['rejection_reason']) ? trim((string)$data['rejection_reason']) : null;
$platform         = $data['platform'] ?? 'OTHER';
$status           = strtoupper((string)($data['status'] ?? 'PLANNED'));
$startDate        = $data['start_date'] ?? null;
$endDate          = !empty($data['end_date']) ? $data['end_date'] : null;
$budget           = (float)($data['budget_amount'] ?? 0);
$targetService    = $data['target_service'] ?? 'ALL';
$ownerName        = trim((string)($data['owner_name'] ?? 'Admin'));

// --- 2. Targets (The L.O.W. Plan) ---
$target_leads = (int)($data['target_leads'] ?? 0);
$target_ops   = (int)($data['target_opportunities'] ?? 0);
$target_won   = (int)($data['target_won'] ?? 0);

// --- 3. Actuals (The Real Results) ---
$actual_leads = (int)($data['leads'] ?? 0);
$actual_ops   = (int)($data['opportunities'] ?? 0);
$actual_won   = (int)($data['won'] ?? 0);

// --- 4. Validation Gate ---
if (empty($id) || empty($name) || empty($startDate)) {
    echo json_encode(['ok' => false, 'error' => 'Missing required fields: Campaign Name and Start Date are mandatory.']);
    exit;
}

// --- 5. Check Existence & Status Guards ---
$stmt = $conn->prepare("SELECT id, status, created_by_user_id FROM marketing_campaigns WHERE id = ?");
$stmt->bind_param('s', $id);
$stmt->execute();
$existing = $stmt->get_result()->fetch_assoc();

if ($existing) {
    // Role-based Guard: If PENDING_APPROVAL and not ADMIN/MANAGEMENT, lock the save
    if ($existing['status'] === 'PENDING_APPROVAL' && $userRole === 'SALES') {
        echo json_encode(['ok' => false, 'error' => 'Campaign is currently under management review and cannot be edited.']);
        exit;
    }

    // --- UPDATE PATH ---
    $sql = "UPDATE marketing_campaigns SET 
            name = ?, 
            remarks = ?, 
            rejection_reason = ?, 
            platform = ?, 
            status = ?, 
            start_date = ?, 
            end_date = ?, 
            budget_amount = ?, 
            target_service = ?, 
            owner_name = ?,
            target_leads = ?, 
            target_opportunities = ?, 
            target_won = ?,
            leads = ?, 
            opportunities = ?, 
            won = ?
            WHERE id = ?";
            
    $stmt = $conn->prepare($sql);
    
    // Binding Types: s(7) d(1) s(2) i(6) s(1) -> 17 total
    $stmt->bind_param(
        'sssssssdssiiiiiis',
        $name, 
        $remarks, 
        $rejection_reason, 
        $platform, 
        $status, 
        $startDate, 
        $endDate, 
        $budget, 
        $targetService, 
        $ownerName, 
        $target_leads, 
        $target_ops, 
        $target_won,
        $actual_leads, 
        $actual_ops, 
        $actual_won,
        $id
    );
} else {
    // --- INSERT PATH ---
    $sql = "INSERT INTO marketing_campaigns 
            (id, name, remarks, rejection_reason, platform, status, start_date, end_date, budget_amount, target_service, owner_name, created_by_user_id, target_leads, target_opportunities, target_won, leads, opportunities, won)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
            
    $stmt = $conn->prepare($sql);
    
    // Binding Types: s(8) d(1) s(2) i(7) -> 18 total
    $stmt->bind_param(
        'ssssssssdssiiiiiii',
        $id, 
        $name, 
        $remarks, 
        $rejection_reason, 
        $platform, 
        $status, 
        $startDate, 
        $endDate, 
        $budget, 
        $targetService, 
        $ownerName, 
        $currentUserId,
        $target_leads, 
        $target_ops, 
        $target_won,
        $actual_leads, 
        $actual_ops, 
        $actual_won
    );
}

// --- 6. Final Execution ---
if ($stmt->execute()) {
    echo json_encode([
        'ok' => true, 
        'id' => $id, 
        'message' => ($status === 'ACTIVE') ? 'Campaign approved and live.' : 'Campaign details saved successfully.'
    ]);
} else {
    error_log("Horizon Campaign Save Error: " . $stmt->error);
    echo json_encode(['ok' => false, 'error' => 'A database error occurred while saving.']);
}

$stmt->close();
$conn->close();