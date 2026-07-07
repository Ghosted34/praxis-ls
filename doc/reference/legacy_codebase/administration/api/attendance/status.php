<?php
// /administration/api/attendance/status.php
declare(strict_types=1);
date_default_timezone_set('Africa/Lagos');

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/auth_guard.php';

// Helper for JSON response
function send_json($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) send_json(['ok' => false, 'message' => 'Unauthorized'], 401);

$conn = db();
$today = date('Y-m-d');

// Fetch today's log
$q = $conn->prepare("SELECT id, clock_in, clock_out, status, duration_minutes FROM attendance_logs WHERE user_id = ? AND date = ? LIMIT 1");
$q->bind_param('is', $userId, $today);
$q->execute();
$row = $q->get_result()->fetch_assoc();

// Return null data if no record exists (User sees "Clock In")
send_json([
  'ok' => true,
  'data' => $row ?: null
], 200);