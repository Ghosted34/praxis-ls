<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Only operational roles can save milestones
require_role(['ADMIN','OPERATIONS','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

function out(bool $ok, string $msg = '', int $code = 200): void {
    http_response_code($code);
    echo json_encode(['ok' => $ok, 'error' => $ok ? null : $msg, 'message' => $ok ? $msg : null]);
    exit;
}

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) out(false, 'Unauthorized', 401);

// Get POST data
$ref = trim((string)($_POST['operations_file_reference'] ?? ''));
$idx = (string)($_POST['stage_index'] ?? ''); // Keep as string first to check "0"
$loc = trim((string)($_POST['location'] ?? ''));
$refNum = trim((string)($_POST['reference'] ?? ''));
$notes = trim((string)($_POST['notes'] ?? ''));
$completedAt = trim((string)($_POST['completed_at'] ?? ''));
$markCompleted = (int)($_POST['mark_completed'] ?? 0); // 1 = Complete, 0 = Update Only

// Validation
if ($ref === '') out(false, 'Missing Reference', 400);
if ($idx === '' || !is_numeric($idx)) out(false, 'Missing Stage Index', 400);

$idxInt = (int)$idx;
if ($idxInt < 0 || $idxInt > 13) out(false, 'Invalid Stage Index (0-13)', 400);

$conn = db();

// 1. Check if file exists and get current state
$stmt = $conn->prepare("SELECT operations_status, current_stage_index FROM operations_file_master WHERE operations_file_reference = ? LIMIT 1");
$stmt->bind_param('s', $ref);
$stmt->execute();
$res = $stmt->get_result();
$file = $res->fetch_assoc();
$stmt->close();

if (!$file) out(false, 'File not found', 404);

// 2. Prepare Update Logic
$sql = "";
$params = [];
$types = "";

if ($markCompleted === 1) {
    // --- COMPLETION LOGIC ---
    
    // Use User-Provided Date (Retroactive) or Default to NOW()
    // Validation: Ensure the format is MySQL compatible 'YYYY-MM-DD HH:MM:SS'
    $finalDate = date('Y-m-d H:i:s'); // Default
    if ($completedAt !== '') {
        // Basic sanity check, or try to format it
        $ts = strtotime($completedAt);
        if ($ts !== false) {
            $finalDate = date('Y-m-d H:i:s', $ts);
        }
    }

    $colDate = "m{$idxInt}_completed_at";
    $colLoc  = "m{$idxInt}_location";
    $colRef  = "m{$idxInt}_reference";
    $colNote = "m{$idxInt}_notes";

    $sql = "UPDATE operations_file_master SET 
            $colDate = ?, 
            $colLoc = ?, 
            $colRef = ?, 
            $colNote = ?,
            current_stage_updated_at = NOW(),
            current_stage_updated_by_user_id = ?
            ";
    
    $params[] = $finalDate;
    $params[] = $loc;
    $params[] = $refNum;
    $params[] = $notes;
    $params[] = $userId;
    $types .= "ssssi";

    // Advance 'current_stage_index' ONLY if we are moving forward
    // e.g. If current is 3, and we complete 3, move to 4.
    // If we go back and fix 1, stay at 3.
    $currentIdx = (int)$file['current_stage_index'];
    if ($idxInt >= $currentIdx) {
        $sql .= ", current_stage_index = ?";
        // Cap at 13
        $nextIdx = min(13, $idxInt + 1);
        $params[] = $nextIdx;
        $types .= "i";
    }

    // Auto-update Status
    // If currently OPEN, move to IN_PROGRESS
    if ($file['operations_status'] === 'OPEN') {
        $sql .= ", operations_status = 'IN_PROGRESS'";
    }
    // If completing the LAST stage (13), Close the file
    if ($idxInt === 13) {
        $sql .= ", operations_status = 'CLOSED'";
    }

} else {
    // --- POST UPDATE (Interim) LOGIC ---
    // Only update Notes and Timestamp. Leave Status/Date alone.
    
    $colLoc  = "m{$idxInt}_location"; // User might update location while active
    $colRef  = "m{$idxInt}_reference"; // Or reference
    $colNote = "m{$idxInt}_notes";

    $sql = "UPDATE operations_file_master SET 
            $colLoc = ?,
            $colRef = ?,
            $colNote = ?,
            current_stage_updated_at = NOW(),
            current_stage_updated_by_user_id = ?
            ";
            
    $params[] = $loc;
    $params[] = $refNum;
    $params[] = $notes;
    $params[] = $userId;
    $types .= "sssi";
}

// Common WHERE clause
$sql .= " WHERE operations_file_reference = ?";
$params[] = $ref;
$types .= "s";

// 3. Execute
try {
    $upd = $conn->prepare($sql);
    $upd->bind_param($types, ...$params);
    
    if ($upd->execute()) {
        out(true, 'Saved successfully');
    } else {
        out(false, 'Database update failed: ' . $conn->error, 500);
    }
} catch (Throwable $e) {
    out(false, 'Server error: ' . $e->getMessage(), 500);
}