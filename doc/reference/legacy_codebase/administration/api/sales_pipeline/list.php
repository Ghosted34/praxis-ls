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
    // 1. Handshake Logic: Map DB status to Pipeline Stage
    // If status is 'CONVERTED_TO_OPPORTUNITY', UI sees it as 'NEW'
    $rawStatus = $r['status'] ?? 'NEW';
    $stage = ($rawStatus === 'CONVERTED_TO_OPPORTUNITY') ? 'NEW' : strtoupper($rawStatus);

    // 2. Build the UI-ready row object
    $rows[] = [
        'id'        => (string)$r['quote_request_id'],                 // Internal UUID for API calls
        'ref'       => (string)($r['public_quote_ref'] ?? ''),         // Display reference (e.g., OPP-2025-XXXX)
        'title'     => (string)($r['requester_company'] ?: $r['requester_name'] ?: 'Opportunity'),
        'client'    => (string)($r['requester_company'] ?: $r['requester_name'] ?: ''),
        'value'     => (float)($r['estimated_value_xaf'] ?? 0),        // Numeric for JS calculations
        'stage'     => $stage,                                         // Corrected mapping for Kanban columns
        'source'    => (string)($r['intake_channel'] ?? 'MANUAL_ENTRY'),
        'sourceRef' => (string)($r['public_quote_ref'] ?? ''),
        'campaign'  => 'N/A',                                          // Placeholder for ROI tracking
        'scope'     => (string)($r['additional_notes'] ?? ''),         // Service scope / description
        'updatedAt' => (string)($r['updated_at'] ?? ''),
    ];
}

jexit(['ok'=>true,'data'=>$rows]);
