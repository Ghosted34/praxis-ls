<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','SALES','MANAGEMENT','FINANCE']);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
  http_response_code(405);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
  exit;
}


header('Content-Type: application/json; charset=utf-8');
$conn = db();

$simId = trim((string)($_GET['id'] ?? ''));
if ($simId === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => 'id is required']);
  exit;
}

$sql = "SELECT * FROM marginpricing_simulations WHERE id = ? LIMIT 1";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $simId);
$stmt->execute();
$sim = $stmt->get_result()->fetch_assoc();

if (!$sim) {
  http_response_code(404);
  echo json_encode(['ok' => false, 'message' => 'Simulation not found']);
  exit;
}

$sqlL = "
  SELECT *
  FROM marginpricing_simulation_lines
  WHERE marginpricing_simulation_id = ?
  ORDER BY line_no ASC, id ASC
";
$stmtL = $conn->prepare($sqlL);
$stmtL->bind_param('i', $simId);
$stmtL->execute();
$lines = $stmtL->get_result()->fetch_all(MYSQLI_ASSOC);

echo json_encode(['ok' => true, 'simulation' => $sim, 'lines' => $lines]);
