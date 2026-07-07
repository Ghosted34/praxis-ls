<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

// --- 1. Input Parameters ---
$q      = trim((string)($_GET['q'] ?? ''));
$page   = max(1, (int)($_GET['page'] ?? 1));
$limit  = 50; // Fixed page size as requested
$offset = ($page - 1) * $limit;

// Optional Filters
$typeFilter   = trim((string)($_GET['type'] ?? ''));
$statusFilter = trim((string)($_GET['status'] ?? ''));

try {
  // --- 2. Build Dynamic WHERE Clause ---
  $whereSQL = "1=1";
  $params   = [];
  $types    = "";

  // Search Logic (Ref, Client ID, Client Name)
  if ($q !== '') {
    $whereSQL .= " AND (
      m.operations_file_reference LIKE CONCAT('%', ?, '%')
      OR m.client_id LIKE CONCAT('%', ?, '%')
      OR c.client_name LIKE CONCAT('%', ?, '%')
    )";
    $types .= "sss";
    $params[] = $q;
    $params[] = $q;
    $params[] = $q;
  }

  if ($typeFilter !== '') {
    $whereSQL .= " AND m.service_type = ?";
    $types .= "s";
    $params[] = $typeFilter;
  }

  if ($statusFilter !== '') {
    $whereSQL .= " AND m.operations_status = ?";
    $types .= "s";
    $params[] = $statusFilter;
  }

  // --- 3. KPI / Summary Query (Runs across ALL data, ignoring pagination) ---
  // Calculates accurate totals and margins regardless of page size.
  $sqlSummary = "
    SELECT
      COUNT(*) as total_count,
      SUM(CASE WHEN m.operations_status IN ('OPEN','IN_PROGRESS','NOT_AWARDED') THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN m.operations_status IN ('FINANCIALLY_PENDING','OPERATIONALLY_COMPLETED') THEN 1 ELSE 0 END) as pending_count,
      SUM(
        COALESCE(m.final_invoice_amount, 0) - COALESCE(m.ocr_amount, 0)
      ) as total_margin_realized
    FROM operations_file_master m
    LEFT JOIN client_master c ON c.client_id = m.client_id
    WHERE $whereSQL
  ";

  $stmtSum = $conn->prepare($sqlSummary);
  if ($types !== '') {
    $stmtSum->bind_param($types, ...$params);
  }
  $stmtSum->execute();
  $resSum = $stmtSum->get_result()->fetch_assoc();
  $stmtSum->close();

  // --- 4. Main Data Query (With Pagination) ---
  $sqlData = "
    SELECT 
      m.operations_file_reference AS ref,
      m.client_id,
      COALESCE(c.client_name, m.client_name, m.client_id) AS client_name,
      m.service_type,
      m.service_territory,
      m.operations_status,
      m.created_at,
      m.expected_delivery_time,
      
      -- Margin Calculation
      (COALESCE(m.final_invoice_amount, 0) - COALESCE(m.ocr_amount, 0)) AS calculated_margin,
      
      -- Doc Count Subquery
      (
        SELECT COUNT(*) 
        FROM document_vault_master dvm
        WHERE dvm.file_context = 'OPS'
          AND dvm.folder_ref = m.operations_file_reference
          AND (dvm.status IS NULL OR dvm.status <> 'ARCHIVED')
      ) AS doc_count

    FROM operations_file_master m
    LEFT JOIN client_master c ON c.client_id = m.client_id
    WHERE $whereSQL
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  ";

  // Append limit/offset parameters
  $stmtData = $conn->prepare($sqlData);
  $typesData = $types . "ii"; 
  $paramsData = array_merge($params, [$limit, $offset]);

  // Bind dynamically
  $bindParams = [];
  $bindParams[] = $typesData;
  foreach ($paramsData as $k => $v) {
    $bindParams[] = &$paramsData[$k];
  }
  call_user_func_array([$stmtData, 'bind_param'], $bindParams);

  $stmtData->execute();
  $resData = $stmtData->get_result();

  $rows = [];
  while ($r = $resData->fetch_assoc()) {
    $rows[] = [
      'ref' => (string)$r['ref'],
      'client_id' => (string)$r['client_id'],
      'client_name' => (string)$r['client_name'],
      'service_type' => (string)$r['service_type'],
      'service_territory' => (string)$r['service_territory'],
      'operations_status' => (string)$r['operations_status'],
      'doc_count' => (int)$r['doc_count'],
      'created_at' => (string)$r['created_at'], // Needed for Traffic Light logic
      'expected_delivery_time' => $r['expected_delivery_time'] ? (string)$r['expected_delivery_time'] : null,
      'calculated_margin' => (float)$r['calculated_margin']
    ];
  }
  $stmtData->close();

  // --- 5. Output JSON ---
  echo json_encode([
    'ok' => true,
    'meta' => [
      'page' => $page,
      'limit' => $limit,
      'total_rows' => (int)$resSum['total_count']
    ],
    'summary' => [
      'total_active' => (int)$resSum['active_count'],
      'total_pending' => (int)$resSum['pending_count'],
      'total_margin' => (float)$resSum['total_margin_realized']
    ],
    'rows' => $rows
  ], JSON_UNESCAPED_UNICODE);
  exit;

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    'ok' => false,
    'error' => 'List failed',
    'detail' => $e->getMessage()
  ], JSON_UNESCAPED_UNICODE);
  exit;
}