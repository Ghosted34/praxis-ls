<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$conn->set_charset('utf8mb4');

// --- Input Parameters ---
$q        = trim((string)($_GET['q'] ?? ''));
$status   = trim((string)($_GET['status'] ?? ''));
$category = trim((string)($_GET['category'] ?? ''));
$month    = trim((string)($_GET['month'] ?? '')); // Format: 01 to 12
$year     = trim((string)($_GET['year'] ?? ''));  // Format: YYYY

$page     = max(1, (int)($_GET['page'] ?? 1));
$pageSize = min(50, max(5, (int)($_GET['pageSize'] ?? 10)));
$offset   = ($page - 1) * $pageSize;

// --- Filter Build ---
$where  = "1=1";
$types  = "";
$params = [];

// 1. Search Query
if ($q !== '') {
  $where .= " AND (
    qr.public_quote_ref LIKE CONCAT('%', ?, '%')
    OR qr.requester_name LIKE CONCAT('%', ?, '%')
    OR qr.requester_email LIKE CONCAT('%', ?, '%')
    OR qr.requester_company LIKE CONCAT('%', ?, '%')
    OR qr.origin_location LIKE CONCAT('%', ?, '%')
    OR qr.destination_location LIKE CONCAT('%', ?, '%')
    OR qr.cargo_description LIKE CONCAT('%', ?, '%')
  )";
  $types .= "sssssss";
  array_push($params, $q, $q, $q, $q, $q, $q, $q);
}

// 2. Status Filter
if ($status !== '') {
  $where .= " AND qr.status = ?";
  $types .= "s";
  $params[] = $status;
}

// 3. Category Filter
if ($category !== '') {
  $where .= " AND qr.service_category = ?";
  $types .= "s";
  $params[] = $category;
}

// 4. Date Filter (Month & Year)
if ($year !== '') {
    $where .= " AND YEAR(qr.submission_datetime) = ?";
    $types .= "s";
    $params[] = $year;
}
if ($month !== '') {
    $where .= " AND MONTH(qr.submission_datetime) = ?";
    $types .= "s";
    $params[] = $month;
}

/* -----------------------------
   Part A: Server-Side KPIs
   (Calculated using the SAME filters as the list, so they are context-aware)
------------------------------ */
// We remove the specific 'status' filter from the KPI WHERE clause 
// so the user can see distribution across all statuses while keeping other filters (like search/date).
// We have to rebuild the KPI where clause slightly.
$kpiWhere = str_replace("AND qr.status = ?", "", $where); 

// Remove the status param from the params array if it was added
$kpiParams = $params;
$kpiTypes = $types;

if ($status !== '') {
    // Find index of status param and remove it. 
    // This is tricky with bind_param arrays. 
    // Simpler approach: Rebuild params for KPI specifically.
    $kpiWhere = "1=1";
    $kpiTypes = "";
    $kpiParams = [];

    if ($q !== '') {
        $kpiWhere .= " AND (qr.public_quote_ref LIKE CONCAT('%', ?, '%') OR qr.requester_name LIKE CONCAT('%', ?, '%') OR qr.requester_email LIKE CONCAT('%', ?, '%') OR qr.requester_company LIKE CONCAT('%', ?, '%') OR qr.origin_location LIKE CONCAT('%', ?, '%') OR qr.destination_location LIKE CONCAT('%', ?, '%') OR qr.cargo_description LIKE CONCAT('%', ?, '%'))";
        $kpiTypes .= "sssssss";
        array_push($kpiParams, $q, $q, $q, $q, $q, $q, $q);
    }
    if ($category !== '') {
        $kpiWhere .= " AND qr.service_category = ?";
        $kpiTypes .= "s";
        $kpiParams[] = $category;
    }
    if ($year !== '') {
        $kpiWhere .= " AND YEAR(qr.submission_datetime) = ?";
        $kpiTypes .= "s";
        $kpiParams[] = $year;
    }
    if ($month !== '') {
        $kpiWhere .= " AND MONTH(qr.submission_datetime) = ?";
        $kpiTypes .= "s";
        $kpiParams[] = $month;
    }
} else {
    // If no status filter, kpi params are identical to main params
    $kpiWhere = $where;
    $kpiParams = $params;
    $kpiTypes = $types;
}

$kpiSql = "SELECT qr.status, COUNT(*) as count FROM quote_requests qr WHERE $kpiWhere GROUP BY qr.status";
$kpiStmt = $conn->prepare($kpiSql);
if ($kpiTypes) {
    $kpiStmt->bind_param($kpiTypes, ...$kpiParams);
}
$kpiStmt->execute();
$kpiResult = $kpiStmt->get_result()->fetch_all(MYSQLI_ASSOC);
$kpiStmt->close();

// Format KPIs for Frontend
$kpiStats = [
    'TOTAL' => 0,
    'RECEIVED' => 0,
    'UNDER_REVIEW' => 0,
    'QUOTED' => 0,
    'CONVERTED_TO_OPPORTUNITY' => 0
    // Add others if needed
];

foreach ($kpiResult as $k) {
    $s = $k['status'];
    $c = (int)$k['count'];
    $kpiStats['TOTAL'] += $c;
    if (isset($kpiStats[$s])) {
        $kpiStats[$s] = $c;
    } else {
        // dynamic statuses
        $kpiStats[$s] = $c;
    }
}


/* -----------------------------
   Part B: Total Count (For Pagination)
------------------------------ */
$countSql  = "SELECT COUNT(*) AS c FROM quote_requests qr WHERE $where";
$countStmt = $conn->prepare($countSql);
if ($types) $countStmt->bind_param($types, ...$params);
$countStmt->execute();
$total = (int)($countStmt->get_result()->fetch_assoc()['c'] ?? 0);
$countStmt->close();

/* -----------------------------
   Part C: Fetch Rows
------------------------------ */
$sql = "
  SELECT
    qr.quote_request_id,
    qr.public_quote_ref,
    qr.intake_channel,
    qr.requester_name,
    qr.requester_email,
    qr.requester_company,
    qr.service_category,
    qr.service_type,
    qr.origin_location,
    qr.destination_location,
    qr.warehouse_location,
    qr.estimated_weight,
    qr.status,
    qr.submission_datetime,
    qr.converted_opportunity_id,

    qr.attachment_original_name,
    qr.attachment_stored_name,
    qr.attachment_stored_path,
    qr.attachment_mime_type,
    qr.attachment_file_size,
    qr.attachment_uploaded_at

  FROM quote_requests qr
  WHERE $where
  ORDER BY qr.submission_datetime DESC
  LIMIT ? OFFSET ?
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'error' => 'Prepare failed (list): ' . $conn->error]);
  exit;
}

$types2     = $types . "ii";
$params2    = $params;
$params2[]  = $pageSize;
$params2[]  = $offset;

$stmt->bind_param($types2, ...$params2);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

/* -----------------------------
   Part D: Process Attachments URL (Fixed for Double Path)
------------------------------ */
foreach ($rows as &$r) {
  $storedPath = trim((string)($r['attachment_stored_path'] ?? ''));
  $storedName = trim((string)($r['attachment_stored_name'] ?? ''));

  if ($storedPath !== '') {
    // FIX: Check if path already starts with /administration/ or / (from website)
    if (strpos($storedPath, '/administration/') === 0) {
        $r['attachment_url'] = $storedPath; // Use as-is
    } elseif (strpos($storedPath, '/') === 0) {
        $r['attachment_url'] = $storedPath; // Use as-is (absolute)
    } else {
        $r['attachment_url'] = "/administration/" . $storedPath; // Prepend for relative admin uploads
    }
  } elseif ($storedName !== '') {
    $r['attachment_url'] = "/administration/uploads/quote_requests/" . rawurlencode($storedName);
  } else {
    $r['attachment_url'] = null;
  }
}
unset($r);

/* -----------------------------
   Part E: Fetch Documents (Multi-doc support)
------------------------------ */
$documentsByRequest = [];
$ids = array_values(array_filter(array_map(fn($x) => (string)($x['quote_request_id'] ?? ''), $rows)));

if (count($ids) > 0) {
  $placeholders = implode(',', array_fill(0, count($ids), '?'));
  $docSql = "
    SELECT
      id,
      quote_request_id,
      document_type,
      original_name,
      stored_name,
      stored_path,
      mime_type,
      file_size_bytes,
      uploaded_at
    FROM quote_request_documents
    WHERE quote_request_id IN ($placeholders)
    ORDER BY uploaded_at DESC, id DESC
  ";

  $docStmt = $conn->prepare($docSql);
  if ($docStmt) {
    $docTypes = str_repeat('s', count($ids));
    $docStmt->bind_param($docTypes, ...$ids);
    $docStmt->execute();
    $docs = $docStmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $docStmt->close();

    foreach ($docs as $d) {
      $qid = (string)($d['quote_request_id'] ?? '');
      if ($qid === '') continue;

      $storedPath = trim((string)($d['stored_path'] ?? ''));
      $url = $storedPath !== ''
        ? $storedPath
        : ("/administration/api/admin/quote-requests/download-document.php?document_id=" . (int)$d['id']);

      $d['url'] = $url;
      if (!isset($documentsByRequest[$qid])) $documentsByRequest[$qid] = [];
      $documentsByRequest[$qid][] = $d;
    }
  }
}

// Return combined response
echo json_encode([
  'ok'       => true,
  'page'     => $page,
  'pageSize' => $pageSize,
  'total'    => $total,
  'kpi'      => $kpiStats, // Server-side KPIs
  'rows'     => $rows,
  'documents_by_request_id' => $documentsByRequest
], JSON_UNESCAPED_SLASHES);

exit;
?>