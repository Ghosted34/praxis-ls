<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']); // adjust if FINANCE can also update

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => $ok], $extra));
  exit;
}

$conn = db();
$conn->set_charset('utf8mb4');

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) out(false, ['error' => 'Session invalid'], 401);

$supplierId = trim((string)($_GET['supplier_id'] ?? ''));
if ($supplierId === '') out(false, ['error' => 'Missing supplier_id'], 422);

$sql = "SELECT *
        FROM supplier_master
        WHERE supplier_id = ?
        LIMIT 1";
$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $supplierId);
$stmt->execute();

$row = $stmt->get_result()->fetch_assoc();
if (!$row) out(false, ['error' => 'Supplier not found'], 404);

out(true, ['supplier' => $row]);
