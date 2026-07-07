<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function json_out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload);
  exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw ?: '', true);
if (!is_array($data)) json_out(['ok' => false, 'error' => 'Invalid JSON body'], 400);

$id = trim((string)($data['id'] ?? ''));
$status = strtoupper(trim((string)($data['status'] ?? '')));
$notes = (string)($data['internal_notes'] ?? '');

if ($id === '' || $status === '') json_out(['ok' => false, 'error' => 'Missing id/status'], 422);

$allowed = ['NEW','IN_REVIEW','APPROVED','REJECTED'];
if (!in_array($status, $allowed, true)) json_out(['ok' => false, 'error' => 'Invalid status'], 422);

$sql = "
  UPDATE partnership_requests
  SET status = ?, internal_notes = ?
  WHERE partnership_request_id = ?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
if (!$stmt) json_out(['ok' => false, 'error' => 'Prepare failed'], 500);

$stmt->bind_param('sss', $status, $notes, $id);
$ok = $stmt->execute();

if (!$ok) json_out(['ok' => false, 'error' => 'DB update failed'], 500);
if ($stmt->affected_rows < 0) json_out(['ok' => false, 'error' => 'Update failed'], 500);

json_out(['ok' => true]);
