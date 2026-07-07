<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - PRAXIS COMMAND ENGINE (Phase 2)
 * ======================================================================================
 * MODULE: AI Command Middleware
 * DESCRIPTION: Intercepts natural language, fetches live context, queries Gemini 2.5 Flash,
 * enforces strict JSON schema, and stages the output in `praxis_ai_staging`.
 * ======================================================================================
 */
declare(strict_types=1);
require_once __DIR__ . '/../includes/init.php'; 
require_once __DIR__ . '/../includes/role_guard.php';

header('Content-Type: application/json');

// Ensure only operational staff and admins can run AI commands
require_role(['ADMIN', 'OPERATIONS', 'MANAGEMENT']);

$employeeId = $_SESSION['auth']['employee_id'] ?? '';
if (!$employeeId) {
    echo json_encode(['success' => false, 'error' => 'Authentication failed. Agent disconnected.']);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);
$command = $data['command'] ?? '';

if (empty($command)) {
    echo json_encode(['success' => false, 'error' => 'No command provided.']);
    exit;
}

$conn = db();

// ======================================================================================
// STEP 1: CONTEXT INJECTION (Retrieving Live Operations Data)
// ======================================================================================
// In production, you will replace these static lines with fast SELECT queries
// from your operations_file_master and quote_requests to build a real-time picture.
$live_context = "
LIVE OPERATIONAL DATA:
- Active Shipments: 12 (Sea: 3, Air: 2, Land: 7)
- Warehouse: Douala HQ at 78% capacity.
- Customs: Averaging 18h clearance.
- Weather: heavy rain forecast Littoral region.
";

// ======================================================================================
// STEP 2: BUILD THE GEMINI SYSTEM PROMPT
// ======================================================================================
$system_prompt = "
You are PRAXIS ERP Agent for Smart Logistics & Services Ltd, Douala, Cameroon.
Extract structured logistics order data from the natural language command.
Return ONLY raw JSON.

$live_context

Determine order type: FREIGHT_ORDER, CUSTOMS_REQUEST, WAREHOUSE_REQUEST, or PROCUREMENT_ORDER.

JSON schema:
{
  \"action\": \"[ORDER TYPE]\",
  \"order_number\": \"SLS-[YEAR]-[4 random digits]\",
  \"company\": \"Smart Logistics & Services Ltd\",
  \"branch\": \"Douala HQ — CEMAC Operations\",
  \"department\": \"[Freight Ops / Customs / Warehouse / Procurement]\",
  \"client\": { \"name\": \"[infer]\", \"type\": \"[infer]\", \"region\": \"[CEMAC country]\" },
  \"vendor_carrier\": { \"id\": null, \"name\": \"[infer carrier]\", \"type\": \"[infer]\", \"compliance_status\": \"VERIFIED\" },
  \"order_details\": { \"cargo_type\": \"[desc]\", \"mode\": \"[SEA/AIR/LAND]\", \"origin\": \"[city]\", \"destination\": \"[city]\" },
  \"line_items\": [{ \"item_code\": \"SLS-ITM-001\", \"description\": \"[item]\", \"quantity\": 1, \"unit\": \"[unit]\", \"unit_price\": 100, \"currency\": \"USD\", \"total\": 100 }],
  \"subtotal\": 100, \"tax_rate\": 19.25, \"tax_amount\": 19.25, \"total_amount\": 119.25,
  \"currency\": \"USD\",
  \"delivery_date\": \"[ISO date]\",
  \"priority\": \"[STANDARD or URGENT]\",
  \"status\": \"PENDING_APPROVAL\",
  \"poka_yoke_checks\": { \"vendor_compliance_verified\": true, \"route_risk_assessed\": true }
}

User Command: $command
";

// ======================================================================================
// STEP 3: CALL GEMINI API (Strict JSON Mode)
// ======================================================================================
$gemini_api_key = 'AIzaSyD5-sd_MX-feoIGhYdK4zdNfO8PnQbSFHU'; 
$url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . $gemini_api_key;

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30); 

// We enforce structured output via response_mime_type
$payload = [
    "contents" => [["parts" => [["text" => $system_prompt]]]],
    "generationConfig" => ["response_mime_type" => "application/json"]
];

curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
$response = curl_exec($ch);

// --- PREVENTING SILENT FAILS ---
if(curl_errno($ch)){
    echo json_encode(['success' => false, 'error' => 'Network Connection Error to Google AI: ' . curl_error($ch)]);
    curl_close($ch);
    exit;
}
curl_close($ch);

$responseData = json_decode($response, true);

if (isset($responseData['error'])) {
    echo json_encode(['success' => false, 'error' => 'Gemini API Error: ' . $responseData['error']['message']]);
    exit;
}

if (!isset($responseData['candidates'][0]['content']['parts'][0]['text'])) {
    echo json_encode(['success' => false, 'error' => 'Gemini returned an empty or unreadable structure.']);
    exit;
}

$raw_text = $responseData['candidates'][0]['content']['parts'][0]['text'];

// Clean markdown formatting if Gemini includes backticks
$clean_text = str_replace(['```json', '```JSON', '```'], '', $raw_text);
$ai_json = json_decode(trim($clean_text), true);

if (!$ai_json) {
    echo json_encode(['success' => false, 'error' => 'Gemini failed to generate a valid, parsable JSON.']);
    exit;
}
