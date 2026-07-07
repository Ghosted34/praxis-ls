<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

// OPTIMIZATION 1: Probabilistic Garbage Collection
// Only run the DELETE query 5% of the time to reduce database locking on read operations.
if (rand(1, 100) <= 5) {
    $conn->query("DELETE FROM active_sessions WHERE last_activity < (NOW() - INTERVAL 24 HOUR)");
}

$sql = "
    SELECT 
        s.session_id, s.ip_address, s.user_agent, s.login_time, s.last_activity,
        u.username, em.full_name, em.department, em.employee_id
    FROM active_sessions s
    JOIN user_auth u ON u.user_id = s.user_id
    JOIN employee_master em ON em.employee_id = u.employee_id
    ORDER BY s.last_activity DESC
";

$res = $conn->query($sql);
$rows = [];

// Helper to make the "Device" column readable
function get_simple_device(string $ua): string {
    if (str_contains($ua, 'Windows')) return 'Windows PC';
    if (str_contains($ua, 'Macintosh')) return 'Mac';
    if (str_contains($ua, 'iPhone')) return 'iPhone';
    if (str_contains($ua, 'Android')) return 'Android';
    if (str_contains($ua, 'Linux')) return 'Linux';
    return 'Other Device';
}

while ($r = $res->fetch_assoc()) {
    // 15 minutes inactivity threshold
    $secondsAgo = time() - strtotime($r['last_activity']);
    $status = ($secondsAgo < 900) ? 'ACTIVE' : 'IDLE';

    // Robust Local/Remote check (handles 127.0.0.1, ::1, and 192.168.x.x)
    $isRemote = !preg_match('/^(127\.0\.0\.1|::1|192\.168\.|10\.)/', $r['ip_address']);

    $rows[] = [
        'session_id' => $r['session_id'], 
        'user'       => $r['full_name'],
        'id'         => $r['employee_id'],
        'dept'       => $r['department'],
        'ip'         => $r['ip_address'],
        'login'      => $r['login_time'],
        'last_active'=> $r['last_activity'],
        'status'     => $status,
        'is_remote'  => $isRemote,
        // OPTIMIZATION 2: Send clean device name, not the huge UA string
        'device'     => get_simple_device($r['user_agent']) 
    ];
}

echo json_encode(['ok' => true, 'rows' => $rows]);