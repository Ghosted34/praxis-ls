<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/auth_guard.php';

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) {
    json_response(['ok' => false, 'message' => 'Unauthorized'], 401);
}

$conn = db();

// 1. FIX: Set Timezone to Lagos to match Clock-In time
date_default_timezone_set('Africa/Lagos');

$today = date('Y-m-d');
$now   = date('Y-m-d H:i:s');

$ip = $_SERVER['REMOTE_ADDR'] ?? null;
$ua = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);

function detect_device(string $ua): string {
    $u = strtolower($ua);
    if (str_contains($u, 'mobile') || str_contains($u, 'android') || str_contains($u, 'iphone')) return 'MOBILE';
    if (str_contains($u, 'ipad') || str_contains($u, 'tablet')) return 'TABLET';
    return 'DESKTOP';
}
$device = detect_device($ua);

try {
    // Check for an open session
    $q = $conn->prepare("SELECT id, clock_in, clock_out, status FROM attendance_logs WHERE user_id = ? AND date = ? LIMIT 1");
    $q->bind_param('is', $userId, $today);
    $q->execute();
    $row = $q->get_result()->fetch_assoc();

    if (!$row) {
        json_response(['ok' => false, 'message' => 'No clock-in found for today. Please clock in first.'], 409);
    }

    if (!empty($row['clock_out'])) {
        // Already clocked out: return existing data
        json_response(['ok' => true, 'message' => 'Already clocked out today.', 'data' => $row], 200);
    }

    // 2. FIX: SQL calculation now works because $now matches the timezone of clock_in
    $upd = $conn->prepare("
        UPDATE attendance_logs
        SET
          clock_out = ?,
          duration_minutes = TIMESTAMPDIFF(MINUTE, clock_in, ?),
          status = 'CLOSED',
          ip_out = ?,
          user_agent_out = ?,
          device_out = ?
        WHERE id = ? AND clock_out IS NULL
    ");
    
    $id = (int)$row['id'];
    // Bind parameters: s=string (dates/ip/ua/dev), i=integer (id)
    $upd->bind_param('sssssi', $now, $now, $ip, $ua, $device, $id);
    $upd->execute();

    // Re-read updated record
    $r = $conn->prepare("SELECT id, clock_in, clock_out, duration_minutes, status FROM attendance_logs WHERE id = ? LIMIT 1");
    $r->bind_param('i', $id);
    $r->execute();
    $updated = $r->get_result()->fetch_assoc();

    json_response(['ok' => true, 'message' => 'Clock-out recorded.', 'data' => $updated], 200);

} catch (mysqli_sql_exception $e) {
    // Log error internally if needed, but return generic message
    json_response(['ok' => false, 'message' => 'Server error'], 500);
}