<?php
declare(strict_types=1);
require_once __DIR__ . '/_common.php';

$id = trim((string)($_GET['id'] ?? ''));
if ($id === '') jexit(['ok'=>false,'error'=>'Missing id'], 400);

$sql = "
  SELECT
    quote_request_id,
    public_quote_ref,
    intake_channel,
    requester_name,
    requester_company,
    requester_email,
    requester_phone,
    service_category,
    service_type,
    origin_location,
    destination_location,
    warehouse_location,
    warehouse_duration,
    estimated_weight,
    estimated_value_xaf,
    project_cargo_flag,
    cargo_description,
    additional_notes,
    status,
    converted_opportunity_id,
    submission_datetime,
    updated_at
  FROM quote_requests
  WHERE quote_request_id = ?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $id);
$stmt->execute();
$r = $stmt->get_result()->fetch_assoc();
if (!$r) jexit(['ok'=>false,'error'=>'Not found'], 404);

$r['stage'] = stage_from_status($r['status'] ?? null);
$r['estimated_value_xaf'] = (float)($r['estimated_value_xaf'] ?? 0);
$r['project_cargo_flag'] = (int)($r['project_cargo_flag'] ?? 0);

jexit(['ok'=>true,'data'=>$r]);
