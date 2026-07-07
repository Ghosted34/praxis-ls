<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'FINANCE']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function json_out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload);
  exit;
}

$q = trim((string)($_GET['q'] ?? ''));
$type = trim((string)($_GET['type'] ?? ''));
$status = trim((string)($_GET['status'] ?? ''));

$sql = "
  SELECT
    partnership_request_id,
    company_name,
    country_of_origin,
    network_memberships,
    contact_person,
    contact_title,
    contact_email,
    proposal_type,
    corporate_profile_ref,
    submission_datetime,
    status,
    internal_notes
  FROM partnership_requests
  WHERE 1=1
";
$types = '';
$params = [];

if ($q !== '') {
  $sql .= " AND (
    company_name LIKE CONCAT('%', ?, '%')
    OR country_of_origin LIKE CONCAT('%', ?, '%')
    OR contact_person LIKE CONCAT('%', ?, '%')
    OR contact_email LIKE CONCAT('%', ?, '%')
  )";
  $types .= 'ssss';
  $params[] = $q; $params[] = $q; $params[] = $q; $params[] = $q;
}

if ($type !== '') {
  $sql .= " AND proposal_type = ?";
  $types .= 's';
  $params[] = $type;
}

if ($status !== '') {
  $sql .= " AND status = ?";
  $types .= 's';
  $params[] = $status;
}

$sql .= " ORDER BY submission_datetime DESC";

$stmt = $conn->prepare($sql);
if (!$stmt) json_out(['ok' => false, 'error' => 'Prepare failed'], 500);

if ($types !== '') {
  $stmt->bind_param($types, ...$params);
}

$stmt->execute();
$res = $stmt->get_result();

$rows = [];
$kpis = ['total' => 0, 'agency' => 0, 'vendor' => 0, 'pending' => 0];

while ($r = $res->fetch_assoc()) {
  $kpis['total']++;

  if ($r['proposal_type'] === 'AGENCY_PARTNERSHIP') $kpis['agency']++;
  if ($r['proposal_type'] === 'VENDOR_REGISTRATION') $kpis['vendor']++;
  if (in_array($r['status'], ['NEW','UNDER_REVIEW'], true)) $kpis['pending']++;

  // Parse memberships
  $nets = [];
  $rawNets = $r['network_memberships'];

  if ($rawNets !== null && $rawNets !== '') {
    $decoded = json_decode((string)$rawNets, true);
    if (is_array($decoded)) {
      $nets = array_values(array_filter(array_map('strval', $decoded)));
    } else {
      // fallback: comma-separated
      $nets = array_values(array_filter(array_map('trim', explode(',', (string)$rawNets))));
    }
  }

  $rows[] = [
    'partnership_request_id' => $r['partnership_request_id'],
    'company_name' => $r['company_name'],
    'country_of_origin' => $r['country_of_origin'],
    'network_memberships' => $nets,
    'contact_person' => $r['contact_person'],
    'contact_title' => $r['contact_title'],
    'contact_email' => $r['contact_email'],
    'proposal_type' => $r['proposal_type'],
    'corporate_profile_ref' => $r['corporate_profile_ref'],
    'submission_datetime' => $r['submission_datetime'],
    'status' => $r['status'],
    'internal_notes' => $r['internal_notes'],
  ];
}

json_out(['ok' => true, 'kpis' => $kpis, 'rows' => $rows]);
