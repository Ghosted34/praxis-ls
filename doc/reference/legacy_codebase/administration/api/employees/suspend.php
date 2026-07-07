<?php
declare(strict_types=1);
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'MANAGEMENT']);

header('Content-Type: application/json');
$conn = db();
$data = json_decode(file_get_contents('php://input'), true);

$userId = (int)($data['user_id'] ?? 0);
$reason = trim((string)($data['reason'] ?? ''));
$adminId = (int)($_SESSION['auth']['user_id'] ?? 0); // Who is doing this?

if ($userId <= 0) {
    http_response_code(422);
    echo json_encode(['ok'=>false, 'message'=>'Invalid User ID']);
    exit;
}
if (empty($reason)) {
    http_response_code(422);
    echo json_encode(['ok'=>false, 'message'=>'Suspension reason is required']);
    exit;
}

try {
    $conn->begin_transaction();

    // 1. Get Username for Logging (Before we suspend them)
    $stmtUser = $conn->prepare("SELECT username FROM user_auth WHERE user_id = ?");
    $stmtUser->bind_param('i', $userId);
    $stmtUser->execute();
    $targetUser = $stmtUser->get_result()->fetch_assoc()['username'] ?? "Unknown User $userId";
    $stmtUser->close();

    // 2. Revoke Login Access
    $stmt1 = $conn->prepare("UPDATE user_auth SET is_active = 0 WHERE user_id = ?");
    $stmt1->bind_param('i', $userId);
    $stmt1->execute();
    $stmt1->close();

    // 3. Update HR Status & Save Reason
    $stmt2 = $conn->prepare("
        UPDATE employee_master em
        JOIN user_auth ua ON ua.employee_id = em.employee_id
        SET em.status = 'SUSPENDED', em.suspension_reason = ?
        WHERE ua.user_id = ?
    ");
    $stmt2->bind_param('si', $reason, $userId);
    $stmt2->execute();
    $stmt2->close();

    // 4. --- AUDIT LOGGING ---
    $action = 'SUSPEND_USER';
    $details = "Suspended user '$targetUser'. Reason: $reason";
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

    $stmtLog = $conn->prepare("INSERT INTO audit_log (user_id, action_type, details, ip_address, severity) VALUES (?, ?, ?, ?, 'CRITICAL')");
    $stmtLog->bind_param('isss', $adminId, $action, $details, $ip);
    $stmtLog->execute();
    $stmtLog->close();

    $conn->commit();
    echo json_encode(['ok'=>true]);

} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(['ok'=>false, 'message'=>$e->getMessage()]);
}