<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Allow only roles that can change status (align with your RBAC intent)
require_role(['ADMIN','SALES']);

header('Content-Type: application/json; charset=utf-8');

function json_exit(array $p, int $code = 200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

$conn = db();

// Read JSON body
$raw = file_get_contents('php://input');
$payload = json_decode($raw ?: '', true);
if (!is_array($payload)) json_exit(['ok' => false, 'error' => 'Invalid JSON body'], 400);

$quoteRequestId = trim((string)($payload['quote_request_id'] ?? ''));
$status         = strtoupper(trim((string)($payload['status'] ?? '')));

if ($quoteRequestId === '') json_exit(['ok' => false, 'error' => 'quote_request_id is required'], 400);
if ($status === '') json_exit(['ok' => false, 'error' => 'status is required'], 400);

// Whitelist statuses (must match what your UI sends)
$allowed = [
  'RECEIVED',
  'UNDER_REVIEW',
  'CLARIFICATION_REQUIRED',
  'QUOTED',
  'CONVERTED_TO_OPPORTUNITY',
  'CLOSED_NO_ACTION'
];

if (!in_array($status, $allowed, true)) {
  json_exit(['ok' => false, 'error' => 'Invalid status'], 400);
}

/**
 * IMPORTANT:
 * Adjust these identifiers to match your smart_quotes schema:
 * - If smart_quotes uses quote_request_id as CHAR(36) -> keep as is.
 * - If it uses id (AUTO_INCREMENT) -> change WHERE to id = ? and pass int.
 */
$keyColumn = 'quote_request_id'; // <-- change if your table uses a different key

// Optional: prevent changing status after conversion/closure (recommended control)
$sqlGet = "SELECT status FROM smart_quotes WHERE {$keyColumn} = ? LIMIT 1";
$stmt = $conn->prepare($sqlGet);
if (!$stmt) json_exit(['ok' => false, 'error' => 'DB prepare failed (select)'], 500);
$stmt->bind_param('s', $quoteRequestId);
$stmt->execute();
$cur = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$cur) json_exit(['ok' => false, 'error' => 'Record not found'], 404);

$currentStatus = strtoupper((string)$cur['status']);
if (in_array($currentStatus, ['CONVERTED_TO_OPPORTUNITY','CLOSED_NO_ACTION'], true)) {
  json_exit(['ok' => false, 'error' => 'Record is locked; status cannot be changed'], 409);
}

// Update status
$sqlUpd = "
  UPDATE smart_quotes
  SET status = ?, updated_at = NOW()
  WHERE {$keyColumn} = ?
  LIMIT 1
";
$stmt = $conn->prepare($sqlUpd);
if (!$stmt) json_exit(['ok' => false, 'error' => 'DB prepare failed (update)'], 500);

$stmt->bind_param('ss', $status, $quoteRequestId);
$stmt->execute();

if ($stmt->affected_rows < 0) {
  $stmt->close();
  json_exit(['ok' => false, 'error' => 'Update failed'], 500);
}
$stmt->close();

json_exit(['ok' => true, 'quote_request_id' => $quoteRequestId, 'status' => $status]);
