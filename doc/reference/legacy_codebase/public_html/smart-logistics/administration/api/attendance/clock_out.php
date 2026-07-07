<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/auth_guard.php';

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) json_response(['ok' => false, 'message' => 'Unauthorized'], 401);

$conn = db();

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
  $q = $conn->prepare("SELECT id, clock_in, clock_out, status FROM attendance_logs WHERE user_id = ? AND date = ? LIMIT 1");
  $q->bind_param('is', $userId, $today);
  $q->execute();
  $row = $q->get_result()->fetch_assoc();

  if (!$row) {
    json_response(['ok' => false, 'message' => 'No clock-in found for today. Please clock in first.'], 409);
  }

  if (!empty($row['clock_out'])) {
    // Already clocked out: return existing (idempotent)
    json_response(['ok' => true, 'message' => 'Already clocked out today.', 'data' => $row], 200);
  }

  // Compute duration using DB (authoritative, avoids client time errors)
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
  $upd->bind_param('sssssi', $now, $now, $ip, $ua, $device, $id);
  $upd->execute();

  // Re-read
  $r = $conn->prepare("SELECT id, clock_in, clock_out, duration_minutes, status FROM attendance_logs WHERE id = ? LIMIT 1");
  $r->bind_param('i', $id);
  $r->execute();
  $updated = $r->get_result()->fetch_assoc();

  json_response(['ok' => true, 'message' => 'Clock-out recorded.', 'data' => $updated], 200);

} catch (mysqli_sql_exception $e) {
  json_response(['ok' => false, 'message' => 'Server error'], 500);
}
