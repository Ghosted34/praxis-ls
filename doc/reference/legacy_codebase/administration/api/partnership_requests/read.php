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

$id = trim((string)($_GET['id'] ?? ''));
if ($id === '') json_out(['ok' => false, 'error' => 'Missing id'], 422);

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
  WHERE partnership_request_id = ?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
if (!$stmt) json_out(['ok' => false, 'error' => 'Prepare failed'], 500);

$stmt->bind_param('s', $id);
$stmt->execute();
$r = $stmt->get_result()->fetch_assoc();

if (!$r) json_out(['ok' => false, 'error' => 'Not found'], 404);

$nets = [];
$rawNets = $r['network_memberships'];
if ($rawNets !== null && $rawNets !== '') {
  $decoded = json_decode((string)$rawNets, true);
  if (is_array($decoded)) $nets = array_values(array_filter(array_map('strval', $decoded)));
  else $nets = array_values(array_filter(array_map('trim', explode(',', (string)$rawNets))));
}

json_out([
  'ok' => true,
  'row' => [
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
  ]
]);
