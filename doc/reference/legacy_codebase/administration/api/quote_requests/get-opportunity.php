<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Allow roles that can create ops files
require_role(['ADMIN','SALES','OPERATIONS','MANAGEMENT','FINANCE']);

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function out(int $code, array $payload): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}

$conn = db();
$conn->set_charset('utf8mb4');

try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    out(405, ['ok' => false, 'error' => 'Method not allowed']);
  }

  // Optional search term from the frontend input
  $q = trim((string)($_GET['q'] ?? ''));

  // Base Logic: 
  // 1. Must have an Opportunity ID
  // 2. That ID must NOT exist in the operations_file_master table (prevents duplicates)
  $where = "
    qr.converted_opportunity_id IS NOT NULL 
    AND TRIM(qr.converted_opportunity_id) <> ''
    AND qr.converted_opportunity_id NOT IN (
        SELECT opportunity_id 
        FROM operations_file_master 
        WHERE opportunity_id IS NOT NULL
    )
  ";
  
  $types = "";
  $params = [];

  // Add Search Filter
  if ($q !== '') {
    $where .= " AND (qr.converted_opportunity_id LIKE CONCAT('%', ?, '%') OR qr.requester_company LIKE CONCAT('%', ?, '%'))";
    $types .= "ss";
    $params[] = $q;
    $params[] = $q;
  }

  // Query: Updated to fetch Name and Date
  // Note: Added fields to GROUP BY to ensure SQL Strict compliance
  $sql = "
    SELECT 
      qr.converted_opportunity_id, 
      qr.requester_company,
      qr.requester_name,
      qr.submission_datetime
    FROM quote_requests qr
    WHERE $where
    GROUP BY 
      qr.converted_opportunity_id, 
      qr.requester_company, 
      qr.requester_name, 
      qr.submission_datetime
    ORDER BY MAX(qr.id) DESC
    LIMIT 50
  ";

  $stmt = $conn->prepare($sql);
  if ($types !== '') {
    $stmt->bind_param($types, ...$params);
  }
  
  $stmt->execute();
  $res = $stmt->get_result();

  $rows = [];
  while ($r = $res->fetch_assoc()) {
    $rows[] = [
      'converted_opportunity_id' => (string)$r['converted_opportunity_id'],
      'requester_company'        => (string)($r['requester_company'] ?? ''),
      // New fields added for the frontend UI:
      'requester_name'           => (string)($r['requester_name'] ?? 'Unknown Client'),
      'submission_datetime'      => (string)($r['submission_datetime'] ?? ''),
    ];
  }
  $stmt->close();

  out(200, [
    'ok' => true,
    'count' => count($rows),
    'rows' => $rows,
  ]);

} catch (Throwable $e) {
  error_log("get-opportunity.php error: " . $e->getMessage());
  out(500, ['ok' => false, 'error' => 'Server error']);
}