<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

$q      = trim((string)($_GET['q'] ?? ''));
$type   = trim((string)($_GET['type'] ?? ''));
$status = trim((string)($_GET['status'] ?? ''));
$limit  = (int)($_GET['limit'] ?? 200);

if ($limit < 1) $limit = 200;
if ($limit > 500) $limit = 500;

$sql = "
  SELECT
    enquiry_id,
    full_name,
    company_name,
    email,
    phone,
    enquiry_type,
    message,
    status,
    internal_notes,
    submission_datetime
  FROM contact_enquiries
  WHERE 1=1
";

$types = '';
$params = [];

if ($q !== '') {
  $sql .= " AND (
      full_name LIKE CONCAT('%', ?, '%')
      OR email LIKE CONCAT('%', ?, '%')
      OR company_name LIKE CONCAT('%', ?, '%')
      OR enquiry_id LIKE CONCAT('%', ?, '%')
    )";
  $types .= 'ssss';
  $params[] = $q; $params[] = $q; $params[] = $q; $params[] = $q;
}

if ($type !== '') {
  $sql .= " AND enquiry_type = ?";
  $types .= 's';
  $params[] = $type;
}

if ($status !== '') {
  $sql .= " AND status = ?";
  $types .= 's';
  $params[] = $status;
}

$sql .= " ORDER BY submission_datetime DESC LIMIT " . (int)$limit;

$stmt = $conn->prepare($sql);
if ($types !== '') {
  $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$res = $stmt->get_result();

$rows = [];
$kpis = ['total'=>0,'new'=>0,'responded'=>0,'closed'=>0];

while ($r = $res->fetch_assoc()) {
  $kpis['total']++;
  if ($r['status'] === 'NEW') $kpis['new']++;
  if ($r['status'] === 'RESPONDED') $kpis['responded']++;
  if ($r['status'] === 'CLOSED') $kpis['closed']++;

  $rows[] = $r;
}

echo json_encode(['ok'=>true, 'kpis'=>$kpis, 'rows'=>$rows], JSON_UNESCAPED_SLASHES);
