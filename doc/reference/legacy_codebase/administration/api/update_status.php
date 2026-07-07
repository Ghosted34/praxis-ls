<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? null);

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$id = trim((string)($body['quote_request_id'] ?? ''));
$status = trim((string)($body['status'] ?? ''));

$allowed = ["RECEIVED","UNDER_REVIEW","CLARIFICATION_REQUIRED","QUOTED","CONVERTED_TO_OPPORTUNITY","CLOSED_NO_ACTION"];
if ($id === '' || !in_array($status, $allowed, true)) { http_response_code(400); echo json_encode(['ok'=>false]); exit; }

$stmt = $conn->prepare("UPDATE quote_requests SET status=?, updated_by_employee_id=? WHERE quote_request_id=? LIMIT 1");
$stmt->bind_param('sss', $status, $employeeId, $id);
$stmt->execute();

echo json_encode(['ok'=>true], JSON_UNESCAPED_SLASHES);
