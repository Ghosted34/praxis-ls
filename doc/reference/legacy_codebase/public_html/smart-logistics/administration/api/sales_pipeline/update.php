<?php
declare(strict_types=1);
require_once __DIR__ . '/_common.php';

$employeeId = require_employee_id();

$id = trim((string)post('quote_request_id',''));
if ($id === '') jexit(['ok'=>false,'error'=>'Missing quote_request_id'], 400);

// Editable fields (match your UI + schema)
$requester_name    = trim((string)post('requester_name',''));
$requester_company = trim((string)post('requester_company',''));
$requester_email   = trim((string)post('requester_email',''));
$requester_phone   = trim((string)post('requester_phone',''));

$service_category = trim((string)post('service_category',''));
$service_type     = trim((string)post('service_type',''));

$origin_location = trim((string)post('origin_location',''));
$destination_location = trim((string)post('destination_location',''));
$warehouse_location = trim((string)post('warehouse_location',''));
$warehouse_duration = trim((string)post('warehouse_duration','UNKNOWN'));

$estimated_weight = post('estimated_weight', null);
$estimated_weight = ($estimated_weight === null || $estimated_weight === '') ? null : (float)$estimated_weight;

$estimated_value_xaf = post('estimated_value_xaf', null);
$estimated_value_xaf = ($estimated_value_xaf === null || $estimated_value_xaf === '') ? null : (float)$estimated_value_xaf;

$project_cargo_flag = (int)(post('project_cargo_flag', 0) ? 1 : 0);
$cargo_description  = (string)post('cargo_description', '');
$additional_notes   = (string)post('additional_notes', '');

$status = stage_from_status((string)post('status','NEW'));

$sql = "
  UPDATE quote_requests
  SET
    requester_name=?,
    requester_company=?,
    requester_email=?,
    requester_phone=?,
    service_category=?,
    service_type=?,
    origin_location=?,
    destination_location=?,
    warehouse_location=?,
    warehouse_duration=?,
    estimated_weight=?,
    estimated_value_xaf=?,
    project_cargo_flag=?,
    cargo_description=?,
    additional_notes=?,
    status=?,
    updated_by_employee_id=?
  WHERE quote_request_id=?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
if (!$stmt) jexit(['ok'=>false,'error'=>'Prepare failed: '.$conn->error], 500);

$stmt->bind_param(
  'ssssssssssddisssss',
  $requester_name,
  $requester_company,
  $requester_email,
  $requester_phone,
  $service_category,
  $service_type,
  $origin_location,
  $destination_location,
  $warehouse_location,
  $warehouse_duration,
  $estimated_weight,
  $estimated_value_xaf,
  $project_cargo_flag,
  $cargo_description,
  $additional_notes,
  $status,
  $employeeId,
  $id
);

$ok = $stmt->execute();
if (!$ok) jexit(['ok'=>false,'error'=>'Update failed: '.$stmt->error], 500);

jexit(['ok'=>true]);
