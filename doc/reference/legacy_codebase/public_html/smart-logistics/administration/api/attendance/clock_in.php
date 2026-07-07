<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/auth_guard.php';

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) json_response(['ok' => false, 'message' => 'Unauthorized'], 401);

$conn = db();

// Use server date/time (consistent for enterprise). If you want Africa/Lagos explicitly:
// date_default_timezone_set('Africa/Lagos');

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
  // Check if record exists for today
  $q = $conn->prepare("SELECT id, clock_in, clock_out, status FROM attendance_logs WHERE user_id = ? AND date = ? LIMIT 1");
  $q->bind_param('is', $userId, $today);
  $q->execute();
  $existing = $q->get_result()->fetch_assoc();

  if ($existing) {
    // Already clocked in today: return existing (idempotent)
    json_response([
      'ok' => true,
      'message' => 'Already clocked in today.',
      'data' => $existing
    ], 200);
  }

  // Insert first and only clock-in for today
  $ins = $conn->prepare("
    INSERT INTO attendance_logs (user_id, date, clock_in, clock_out, duration_minutes, status, ip_in, user_agent_in, device_in)
    VALUES (?, ?, ?, NULL, 0, 'OPEN', ?, ?, ?)
  ");
  $ins->bind_param('isssss', $userId, $today, $now, $ip, $ua, $device);
  $ins->execute();

  json_response([
    'ok' => true,
    'message' => 'Clock-in recorded.',
    'data' => [
      'id' => $conn->insert_id,
      'date' => $today,
      'clock_in' => $now,
      'clock_out' => null,
      'status' => 'OPEN'
    ]
  ], 201);

} catch (mysqli_sql_exception $e) {
  // If double-click races, UNIQUE constraint may throw duplicate; treat as success.
  if (str_contains($e->getMessage(), 'Duplicate')) {
    json_response(['ok' => true, 'message' => 'Already clocked in today.'], 200);
  }
  json_response(['ok' => false, 'message' => 'Server error'], 500);
}
