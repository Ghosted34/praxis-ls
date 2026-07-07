<?php
declare(strict_types=1);
require_once __DIR__ . '/_common.php';

$employeeId = require_employee_id();

// Filter: converted_opportunity_id IS NOT NULL (your rule)
$sql = "
  SELECT
    quote_request_id,
    public_quote_ref,
    requester_name,
    requester_company,
    intake_channel,
    status,
    converted_opportunity_id,
    estimated_value_xaf,
    additional_notes,
    submission_datetime,
    updated_at
  FROM quote_requests
  WHERE converted_opportunity_id IS NOT NULL
  ORDER BY updated_at DESC
  LIMIT 1000
";

$res = $conn->query($sql);
if (!$res) jexit(['ok'=>false,'error'=>'DB error: '.$conn->error], 500);

$rows = [];
while ($r = $res->fetch_assoc()) {
  $stage = stage_from_status($r['status'] ?? null);

  // UI fields mapping
  $rows[] = [
    'id'        => (string)$r['quote_request_id'],                 // use quote_request_id as the card id
    'ref'       => (string)($r['public_quote_ref'] ?? ''),
    'title'     => (string)($r['requester_company'] ?: $r['requester_name'] ?: 'Opportunity'),
    'client'    => (string)($r['requester_company'] ?: $r['requester_name'] ?: ''),
    'value'     => (float)($r['estimated_value_xaf'] ?? 0),
    'stage'     => $stage,
    'source'    => (string)($r['intake_channel'] ?? 'MANUAL_ENTRY'),
    'sourceRef' => (string)($r['public_quote_ref'] ?? ''),
    'campaign'  => 'N/A', // per your instruction: leave attribution for now
    'scope'     => (string)($r['additional_notes'] ?? ''),
    'updatedAt' => (string)($r['updated_at'] ?? ''),
  ];
}

jexit(['ok'=>true,'data'=>$rows]);
