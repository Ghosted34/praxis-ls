<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/auth_guard.php';

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) json_response(['ok' => false, 'message' => 'Unauthorized'], 401);

$conn = db();
$today = date('Y-m-d');

$q = $conn->prepare("SELECT id, clock_in, clock_out, status, duration_minutes FROM attendance_logs WHERE user_id = ? AND date = ? LIMIT 1");
$q->bind_param('is', $userId, $today);
$q->execute();
$row = $q->get_result()->fetch_assoc();

json_response([
  'ok' => true,
  'data' => $row ?: null
], 200);
