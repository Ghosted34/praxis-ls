<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - PRE-SALES & LEADS API (Phase 4)
 * ======================================================================================
 * MODULE: CRM & Acquisition
 * DESCRIPTION: API backend for managing leads, generating proposal tokens, and 
 * handling the public fetching of proposal data for PDF rendering.
 * ======================================================================================
 */

declare(strict_types=1);
require_once __DIR__ . '/../includes/init.php'; 
require_once __DIR__ . '/../includes/role_guard.php';

header('Content-Type: application/json');

// Extract JSON payload if sent via JavaScript fetch
$json_payload = json_decode(file_get_contents('php://input'), true);

// Get the action robustly from GET, POST, or JSON
$action = $_GET['action'] ?? ($_POST['action'] ?? ($json_payload['action'] ?? ''));
$method = $_SERVER['REQUEST_METHOD'];

$conn = db();

// ======================================================================================
// 1. PUBLIC ENDPOINT (NO AUTH REQUIRED)
// ======================================================================================
if ($action === 'get_proposal_public') {
    $token = $_GET['token'] ?? '';
    
    if (empty($token)) {
        echo json_encode(['success' => false, 'error' => 'Token missing']);
        exit;
    }

    try {
        // Fetch Proposal, Lead, and Sales Rep data
        $sql = "SELECT p.*, l.company_name, l.contact_person, l.email_address, l.phone_number, l.address,
                       em.full_name AS rep_name, em.job_title AS rep_title
                FROM smart_proposals p
                JOIN smart_leads l ON p.lead_id = l.lead_id
                JOIN employee_master em ON p.created_by_employee_id = em.employee_id
                WHERE p.token = ?";
                
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('s', $token);
        $stmt->execute();
        $proposal = $stmt->get_result()->fetch_assoc();

        if (!$proposal) {
            throw new Exception("Invalid or expired proposal token.");
        }

        // Fetch Line Items
        $sqlLines = "SELECT description AS `desc`, quantity AS qty, unit_rate AS rate, total_amount AS total 
                     FROM smart_proposal_lines 
                     WHERE proposal_id = ? ORDER BY sort_order ASC";
        $stmtLines = $conn->prepare($sqlLines);
        $stmtLines->bind_param('i', $proposal['proposal_id']);
        $stmtLines->execute();
        $lines = $stmtLines->get_result()->fetch_all(MYSQLI_ASSOC);

        // Format data exactly as Phase 3 UI expects
        $payload = [
            'success' => true,
            'data' => [
                'proposal' => [
                    'ref' => $proposal['proposal_ref'],
                    'date' => date('Y-m-d', strtotime($proposal['created_at'])),
                    'language' => $proposal['language'],
                    'currency' => $proposal['currency'],
                    'service_category' => $proposal['service_category'],
                    'incoterm' => $proposal['incoterm'],
                    'origin' => $proposal['origin_location'],
                    'dest' => $proposal['destination_location'],
                    'desc' => $proposal['cargo_description'],
                    'customs_tgt' => $proposal['customs_clearance_target'],
                    'transit_tgt' => $proposal['transit_time_target'],
                    'free_days' => $proposal['free_days_demurrage'] . " Days",
                    'payment' => $proposal['payment_conditions'],
                    'validity' => $proposal['validity_days'] . " Days",
                    'rep_name' => $proposal['rep_name'],
                    'rep_title' => $proposal['rep_title']
                ],
                'client' => [
                    'company' => $proposal['company_name'],
                    'contact' => $proposal['contact_person'],
                    'email' => $proposal['email_address']
                ],
                'lines' => $lines
            ]
        ];

        echo json_encode($payload);
        exit;
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        exit;
    }
}

// ======================================================================================
// 2. SECURE ENDPOINTS (AUTH REQUIRED)
// ======================================================================================
require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

$employeeId = $_SESSION['auth']['employee_id'] ?? '';

try {
    switch ($action) {
        
        // --- FETCH KPIS ---
        case 'fetch_kpis':
            $res = $conn->query("
                SELECT 
                    COUNT(*) as total_leads,
                    SUM(CASE WHEN status = 'PROPOSAL_SENT' THEN 1 ELSE 0 END) as proposals_sent,
                    SUM(CASE WHEN status = 'QUALIFIED' THEN 1 ELSE 0 END) as qualified
                FROM smart_leads
            ")->fetch_assoc();
            
            $total = (int)$res['total_leads'];
            $qualified = (int)$res['qualified'];
            $convRate = $total > 0 ? round(($qualified / $total) * 100) : 0;

            echo json_encode(['success' => true, 'kpis' => [
                'total_leads' => $total,
                'proposals_sent' => (int)$res['proposals_sent'],
                'qualified' => $qualified,
                'conversion_rate' => $convRate . '%'
            ]]);
            break;
        
        // --- AI GENERATION ENGINE (GEMINI) ---
        case 'generate_ai_content':
            $data = json_decode(file_get_contents('php://input'), true);
            
            // NOTE: Ensure your valid Gemini API Key is here
            $gemini_api_key = 'AIzaSyD5-sd_MX-feoIGhYdK4zdNfO8PnQbSFHU...'; 
            $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . $gemini_api_key;

            $tone = $data['tone'] ?? 'Consultative/Advisory';
            $client_ops = $data['client_operations'] ?? '';
            $pain_points = $data['pain_points'] ?? '';
            $proposed_solution = $data['proposed_solution'] ?? '';

            // --- INJECT COMPANY DNA & PAST PROJECTS ---
            $company_context = "
            Smart Logistics & Services Ltd Company Facts:
            - Slogan: Going Beyond Your Expectations...
            - Core Regions: Cameroon and CEMAC subregion (Gateways: Douala & Kribi).
            - Infrastructure: A couple of 2000+ sqm secured warehousing; fleet of 150+ trucks and flatbeds.
            - Performance: Target 72-hour customs clearance; proven drastic transit time reductions and lean supply chain operations.
            - Specializations: Energy (heavy equipment/infrastructure), Pharmaceuticals (UNFPA/cold chain), Heavy Machinery (re-export/temporary admission), Large Scale International Distributors.
            - Network: WCA member, JCTrans network; alliances with Major Shipping Lines and Airlines.
            - Past Project 1 (Energy): L&T Interconnection. 250+ TEUs from India. 15 days transit reduction, 72h clearance.
            - Past Project 2 (Pharma): UNFPA. 100+ reefer cartons, complex suspensive UN customs regimes.
            - Past Project 3 (Heavy Duty): FMA Services. Re-exportation of heavy machinery under temporary admission.
            - Tech & Growth: Integration of the 'Smart-Track Platform' for 100% real-time visibility. Full digitization of our logistics system, streamlining internal processes which contributes to our rapid growth of over 800M+ FCFA turnover in a few coupled with cost-efficiency, strict compliance, and ethics.
            ";

            $prompt = "You are a Senior Logistics Consultant for 'Smart Logistics & Services Ltd'. 
            Tone: $tone, authoritative and /human.
            
            $company_context
            
            Based on the sales rep's rough notes below, generate a polished enterprise proposal text in BOTH English and French.
            Client Operations: $client_ops
            Pain Points: $pain_points
            Proposed Strategy: $proposed_solution
            
            RULES:
            1. client_context: 2 sharp paragraphs. P1: their current reality; P2: cost of inaction/challenges (Fairly around 1200 chars).
            2. operational_strategy: 2 authoritative paragraphs explaining our solution. Mention 'Smart Track Platform' on www.smartls.cm/smart-track. (Max 800 chars).
            3. slas: Generate exactly 4 custom Service Level Agreements tailored to the client's specific pain points, pulling either from our established capabilities or inventing perfect SLAs outside of our framework.- SLA 1 (Customs/Compliance): We can guarantee our \"Max 72-Hour Clearance\" benchmark or \"Exemption Docs obtention in limited Business Days (T&Cs)\". - SLA 2 (Visibility/Tracking): We should always highlight \"100% Real-Time Visibility\" utilizing our \"Smart Track Platform.\" - SLA 3 (Cost/Transit Optimization): We can focus on measurable savings, such as \"Proactive Demurrage Mitigation\" or routing optimizations that target \"Transit Reductions.\" - SLA 4 (Operations/Handling): Focus on specialized handling, such as \"Zero-Damage Heavy Lift\" or \"Cold-Chain Integrity (<5% Deviation).\" We could very subtly include Strategic Networks and Partnerships. Strict Formatting constraint: Keep titles under 30 chars (e.g., \"Customs Clearance Target\") and values under 40 chars (e.g., \"Guaranteed Max 72 Hours\").
            4. Write a custom 'Relevant Expertise' title and body. Tweak one of our Past Projects (Energy, Pharma, or Heavy Duty) to highlight the metrics THIS client cares about, or write a sanitized/blended version proving our capability. (Body Max 400 chars).: Select 'ENERGY', 'PHARMA', or 'HEAVY' based on the client's industry, or generate a 'SANITIZED' case study. You MUST adhere to these exact facts and never invent metrics: - If 'ENERGY' (Best for infrastructure/heavy equipment): Cite our work managing 250+ TEUs from India for a 225kV interconnection project. We achieved 150M+ FCFA in client savings (preferential freight/demurrage) and reduced transit times by 15 days.- If 'PHARMA' (Best for medical/NGO/perishables): Cite our UN project (PETVISIDAME) delivering 100+ reefer cartons worth 200M+ FCFA. Highlight our expertise in managing suspensive UN customs regimes and achieving 72-hour clearance despite 21-day franchises.- If 'HEAVY' (Best for re-export/machinery): Cite our success in temporary admission and complex re-exportation of heavy machinery to Ivory Coast and Mayotte, securing highly competitive freight rates and accelerated compliance certificates.- If 'SANITIZED' (For unique industries not covered above): Create a generic case study (e.g., \"Major CEMAC FMCG Distributor\" or \"Regional Telecom Provider\") but ONLY use our actual macro-metrics: 620M+ FCFA company turnover, utilization of our 150+ truck fleet, and our 1,000sqm Douala/Kribi warehouse infrastructure. Do not invent fake projects or fake financial values.
            
            Respond STRICTLY in JSON, NO MARKDOWN BACKTICKS:
            {
              \"client_context_en\": \"...\", \"client_context_fr\": \"...\",
              \"operational_strategy_en\": \"...\", \"operational_strategy_fr\": \"...\",
              \"slas_en\": [{\"title\": \"...\", \"value\": \"...\"}],
              \"slas_fr\": [{\"title\": \"...\", \"value\": \"...\"}],
              \"case_study_title_en\": \"...\", \"case_study_body_en\": \"...\",
              \"case_study_title_fr\": \"...\", \"case_study_body_fr\": \"...\"
            }";

            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_POST, true);
            // Increased timeout so it doesn't drop before Gemini finishes thinking
            curl_setopt($ch, CURLOPT_TIMEOUT, 30); 
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
                "contents" => [["parts" => [["text" => $prompt]]]],
                // Forcing JSON response structure at the API level
                "generationConfig" => ["response_mime_type" => "application/json"]
            ]));

            $response = curl_exec($ch);
            
            if(curl_errno($ch)){
                echo json_encode(['success' => false, 'error' => 'Server Network Error: ' . curl_error($ch)]);
                curl_close($ch);
                exit;
            }
            curl_close($ch);

            $responseData = json_decode($response, true);
            
            // Check if Gemini returned an API Error (e.g. invalid key)
            if (isset($responseData['error'])) {
                echo json_encode(['success' => false, 'error' => 'Google AI Error: ' . $responseData['error']['message']]);
                exit;
            }
            
            if (isset($responseData['candidates'][0]['content']['parts'][0]['text'])) {
                $raw_text = $responseData['candidates'][0]['content']['parts'][0]['text'];
                
                // CRITICAL FIX: Strip markdown backticks in case Gemini disobeys instructions
                $clean_text = preg_replace('/```(?:json)?|```/', '', $raw_text);
                
                $ai_json = json_decode(trim($clean_text), true);
                
                if ($ai_json) {
                    echo json_encode(['success' => true, 'ai_data' => $ai_json]);
                } else {
                    echo json_encode(['success' => false, 'error' => 'AI returned invalid formatting.']);
                }
            } else {
                echo json_encode(['success' => false, 'error' => 'Empty response from AI.']);
            }
            break;
        
        // --- FETCH EXISTING PROPOSAL ---
        case 'fetch_proposal':
            $data = json_decode(file_get_contents('php://input'), true);
            $leadId = (int)$data['lead_id'];
            
            // Get the latest proposal for this lead
            $prop = $conn->query("SELECT * FROM smart_proposals WHERE lead_id = $leadId ORDER BY created_at DESC LIMIT 1")->fetch_assoc();
            if (!$prop) {
                echo json_encode(['success' => false, 'error' => 'No proposal found']);
                break;
            }
            
            $propId = $prop['proposal_id'];
            $lines = $conn->query("SELECT description as `desc`, quantity as qty, unit_rate as rate, total_amount as total FROM smart_proposal_lines WHERE proposal_id = $propId ORDER BY sort_order ASC")->fetch_all(MYSQLI_ASSOC);
            $narrative = $conn->query("SELECT * FROM smart_proposal_narratives WHERE proposal_id = $propId")->fetch_assoc();
            
            echo json_encode(['success' => true, 'proposal' => $prop, 'lines' => $lines, 'narrative' => $narrative]);
            break;
        
        // --- FETCH LEADS ---
        case 'fetch_leads':
            // Added all columns so the Edit Modal can populate properly
            $sql = "SELECT lead_id as id, company_name as company, contact_person as contact, email_address as email, phone_number as phone, address, niu, rccm, country, status, DATE(created_at) as `date`, meeting_ops, meeting_pain, meeting_strategy 
                    FROM smart_leads ORDER BY created_at DESC";
            $leads = $conn->query($sql)->fetch_all(MYSQLI_ASSOC);
            echo json_encode(['success' => true, 'leads' => $leads]);
            break;
            
        // --- SAVE MEETING NOTES ---
        case 'save_meeting_notes':
            $data = json_decode(file_get_contents('php://input'), true);
            $leadId = (int)$data['lead_id'];
            
            $stmt = $conn->prepare("UPDATE smart_leads SET meeting_ops=?, meeting_pain=?, meeting_strategy=? WHERE lead_id=?");
            $stmt->bind_param('sssi', $data['ops'], $data['pain'], $data['strategy'], $leadId);
            
            if ($stmt->execute()) {
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => 'Database error']);
            }
            break;

        // --- UPDATE LEAD ---
        case 'update_lead':
            $data = json_decode(file_get_contents('php://input'), true);
            $stmt = $conn->prepare("UPDATE smart_leads SET company_name=?, contact_person=?, phone_number=?, email_address=?, country=?, address=?, niu=?, rccm=? WHERE lead_id=?");
            $stmt->bind_param('ssssssssi', $data['company'], $data['contact'], $data['phone'], $data['email'], $data['country'], $data['address'], $data['niu'], $data['rccm'], $data['lead_id']);
            $stmt->execute();
            
            echo json_encode(['success' => true]);
            break;

        // --- SAVE LEAD ---
        case 'save_lead':
            $data = json_decode(file_get_contents('php://input'), true);
            $stmt = $conn->prepare("INSERT INTO smart_leads (company_name, contact_person, phone_number, email_address, country, address, niu, rccm, created_by_employee_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->bind_param('sssssssss', $data['company'], $data['contact'], $data['phone'], $data['email'], $data['country'], $data['address'], $data['niu'], $data['rccm'], $employeeId);
            $stmt->execute();
            
            echo json_encode(['success' => true, 'lead_id' => $conn->insert_id]);
            break;

        // --- SAVE OR UPDATE PROPOSAL ---
        case 'save_proposal':
            $data = json_decode(file_get_contents('php://input'), true);
            $leadId = (int)$data['lead_id'];
            $proposalId = (int)($data['proposal_id'] ?? 0);
            $propStatus = $data['proposal_status'] ?? 'DRAFT';
            
            $conn->begin_transaction();
            
            if ($proposalId > 0) {
                // UPDATE EXISTING PROPOSAL
                $stmt = $conn->prepare("UPDATE smart_proposals SET language=?, currency=?, service_category=?, incoterm=?, origin_location=?, destination_location=?, cargo_description=?, estimated_weight=?, project_cargo_flag=?, customs_clearance_target=?, transit_time_target=?, free_days_demurrage=?, payment_conditions=?, validity_days=?, status=? WHERE proposal_id=?");
                $stmt->bind_param('ssssssssississsi', 
                    $data['language'], $data['currency'], $data['service_category'], $data['incoterm'], 
                    $data['origin'], $data['dest'], $data['desc'], $data['weight'], $data['project_flag'], 
                    $data['customs_tgt'], $data['transit_tgt'], $data['free_days'], $data['payment'], 
                    $data['validity'], $propStatus, $proposalId
                );
                $stmt->execute();
                
                // Clear old lines to replace them
                $conn->query("DELETE FROM smart_proposal_lines WHERE proposal_id = $proposalId");
                
                // Update Narrative
                $stmtNarrative = $conn->prepare("UPDATE smart_proposal_narratives SET raw_client_operations=?, raw_pain_points=?, raw_proposed_strategy=?, raw_tone=?, client_context_en=?, client_context_fr=?, case_study_title_en=?, case_study_body_en=?, case_study_title_fr=?, case_study_body_fr=?, operational_strategy_en=?, operational_strategy_fr=?, custom_slas_en=?, custom_slas_fr=? WHERE proposal_id=?");
                $slas_en_json = json_encode($data['ai_slas_en'] ?? []);
                $slas_fr_json = json_encode($data['ai_slas_fr'] ?? []);
                
                $stmtNarrative->bind_param('ssssssssssssssi', 
                    $data['ai_input_ops'], $data['ai_input_pain'], $data['ai_input_strategy'], $data['ai_tone'],
                    $data['ai_context_en'], $data['ai_context_fr'], $data['ai_case_title_en'], $data['ai_case_body_en'], 
                    $data['ai_case_title_fr'], $data['ai_case_body_fr'], $data['ai_strategy_en'], $data['ai_strategy_fr'], 
                    $slas_en_json, $slas_fr_json, $proposalId
                );
                $stmtNarrative->execute();
                
                // Grab existing token for the response
                $tokenRes = $conn->query("SELECT token, proposal_ref FROM smart_proposals WHERE proposal_id = $proposalId")->fetch_assoc();
                $token = $tokenRes['token'];
                $ref = $tokenRes['proposal_ref'];
                
            } else {
                // INSERT NEW PROPOSAL
                $token = 'SLAS-' . strtoupper(bin2hex(random_bytes(4)));
                $ref = 'QT-' . date('Ymd') . '-' . rand(100, 999);
                $signature_hash = hash('sha256', $token . $ref . time());
                
                $stmt = $conn->prepare("INSERT INTO smart_proposals (proposal_ref, lead_id, token, signature_hash, language, currency, service_category, incoterm, origin_location, destination_location, cargo_description, estimated_weight, project_cargo_flag, customs_clearance_target, transit_time_target, free_days_demurrage, payment_conditions, validity_days, status, created_by_employee_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $stmt->bind_param('sissssssssssississss', 
                    $ref, $leadId, $token, $signature_hash, $data['language'], $data['currency'], $data['service_category'], $data['incoterm'], $data['origin'], $data['dest'], $data['desc'], $data['weight'], $data['project_flag'], $data['customs_tgt'], $data['transit_tgt'], $data['free_days'], $data['payment'], $data['validity'], $propStatus, $employeeId
                );
                $stmt->execute();
                $proposalId = $conn->insert_id;
                
                // Insert Narrative
                $stmtNarrative = $conn->prepare("INSERT INTO smart_proposal_narratives (proposal_id, raw_client_operations, raw_pain_points, raw_proposed_strategy, raw_tone, client_context_en, client_context_fr, case_study_title_en, case_study_body_en, case_study_title_fr, case_study_body_fr, operational_strategy_en, operational_strategy_fr, custom_slas_en, custom_slas_fr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $slas_en_json = json_encode($data['ai_slas_en'] ?? []);
                $slas_fr_json = json_encode($data['ai_slas_fr'] ?? []);
                
                $stmtNarrative->bind_param('issssssssssssss', 
                    $proposalId, 
                    $data['ai_input_ops'], $data['ai_input_pain'], $data['ai_input_strategy'], $data['ai_tone'],
                    $data['ai_context_en'], $data['ai_context_fr'], $data['ai_case_title_en'], $data['ai_case_body_en'], 
                    $data['ai_case_title_fr'], $data['ai_case_body_fr'], $data['ai_strategy_en'], $data['ai_strategy_fr'], 
                    $slas_en_json, $slas_fr_json
                );
                $stmtNarrative->execute();
            }
            
            // Insert Lines (Applies to both Update and Insert)
            $stmtLines = $conn->prepare("INSERT INTO smart_proposal_lines (proposal_id, description, quantity, unit_rate, total_amount, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
            foreach ($data['lines'] as $index => $line) {
                $qty = (float)$line['qty'];
                $rate = (float)$line['rate'];
                $total = $qty * $rate;
                $stmtLines->bind_param('isdddi', $proposalId, $line['desc'], $qty, $rate, $total, $index);
                $stmtLines->execute();
            }

            if ($propStatus === 'SENT') {
                $conn->query("UPDATE smart_leads SET status = 'PROPOSAL_SENT' WHERE lead_id = $leadId");
            }

            $conn->commit();
            echo json_encode(['success' => true, 'token' => $token, 'ref' => $ref]);
            break;

        case 'convert_lead':
            $data = json_decode(file_get_contents('php://input'), true);
            $leadId = (int)$data['lead_id'];

            $conn->begin_transaction();

            try {
                // 1. Fetch Lead
                $lead = $conn->query("SELECT * FROM smart_leads WHERE lead_id = $leadId")->fetch_assoc();
                
                // 2. Fetch Latest Proposal
                $proposal = $conn->query("SELECT * FROM smart_proposals WHERE lead_id = $leadId ORDER BY created_at DESC LIMIT 1")->fetch_assoc();
                
                if (!$lead || !$proposal) {
                    throw new Exception("Lead or Proposal data missing for conversion.");
                }

                // --- ALIGNMENT FIX: Generate Client ID using your standalone API logic ---
                $clientId = str_pad((string)random_int(0, 99999), 5, '0', STR_PAD_LEFT) . '-SC'; 

                // 3. Insert into client_master (Aligned with your Client API)
                $stmtClient = $conn->prepare("INSERT INTO client_master (
                    client_id, client_name, client_type, contact_person, contact_email, 
                    contact_phone, niu, rccm, address, country, 
                    payment_terms_days, status, created_at, updated_at
                ) VALUES (?, ?, 'BOTH', ?, ?, ?, ?, ?, ?, ?, 30, 'ACTIVE', NOW(), NOW())");
                
                $stmtClient->bind_param('sssssssss', 
                    $clientId, $lead['company_name'], $lead['contact_person'], $lead['email_address'], 
                    $lead['phone_number'], $lead['niu'], $lead['rccm'], $lead['address'], $lead['country']
                );
                $stmtClient->execute();

                // 4. Generate Quote UUID
                $data = random_bytes(16);
                $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
                $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
                $quoteUuid = vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));

                // --- ALIGNMENT FIX: Generate Public Ref using your doc_sequences logic ---
                $year = (int)date('Y');
                $conn->query("INSERT INTO doc_sequences (module_key, year, seq) VALUES ('SMART_QUOTE', $year, 1) ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)");
                $seqRes = $conn->query("SELECT LAST_INSERT_ID() AS seq")->fetch_assoc();
                $publicQuoteRef = sprintf('SQ-%d-%06d', $year, (int)$seqRes['seq']);

                // 5. Insert into quote_requests (Aligned with your Quote API)
                // Note: Added 'STANDARD' as a default for service_type to satisfy your API requirement
                $stmtQuote = $conn->prepare("INSERT INTO quote_requests (
                    quote_request_id, public_quote_ref, intake_channel, requester_name, 
                    requester_company, requester_email, requester_phone, service_category, 
                    service_type, origin_location, destination_location, estimated_weight, 
                    project_cargo_flag, cargo_description, status, created_by_employee_id
                ) VALUES (?, ?, 'SMART_QUOTE', ?, ?, ?, ?, ?, 'STANDARD', ?, ?, ?, ?, ?, 'RECEIVED', ?)");
                
                $estimatedWeight = (float)$proposal['estimated_weight'];

                $stmtQuote->bind_param('ssssssssssdis', 
                    $quoteUuid, $publicQuoteRef, $lead['contact_person'], $lead['company_name'], 
                    $lead['email_address'], $lead['phone_number'], $proposal['service_category'], 
                    $proposal['origin_location'], $proposal['destination_location'], $estimatedWeight, 
                    $proposal['project_cargo_flag'], $proposal['cargo_description'], $employeeId
                );
                $stmtQuote->execute();

                // 6. Finalize Lead Status
                $conn->query("UPDATE smart_leads SET status = 'QUALIFIED' WHERE lead_id = $leadId");
                
                // Link proposal to the new IDs
                $stmtUpdateProp = $conn->prepare("UPDATE smart_proposals SET status = 'CONVERTED', converted_client_id = ?, converted_quote_id = ? WHERE lead_id = ?");
                $stmtUpdateProp->bind_param('ssi', $clientId, $quoteUuid, $leadId);
                $stmtUpdateProp->execute();

                $conn->commit();
                echo json_encode(['success' => true, 'message' => 'Successfully converted to Client ID: ' . $clientId]);

            } catch (Exception $e) {
                $conn->rollback();
                echo json_encode(['success' => false, 'error' => $e->getMessage()]);
            }
            break;
            
            // --- SPEECH TO TEXT (GROQ WHISPER) ---
        case 'transcribe_audio':
            $data = json_decode(file_get_contents('php://input'), true);
            $base64Audio = $data['audio_b64'] ?? '';
            
            if (empty($base64Audio)) {
                echo json_encode(['success' => false, 'error' => 'No audio data received.']);
                break;
            }

            // Clean the base64 string
            $audioData = base64_decode(preg_replace('#^data:audio/\w+;base64,#i', '', $base64Audio));
            
            // Write to system temp dir (ephemeral - does not go into your app storage)
            $tmpFilePath = sys_get_temp_dir() . '/' . uniqid('smart_audio_') . '.webm';
            file_put_contents($tmpFilePath, $audioData);

            // TODO: Insert your generated Groq API Key here
            $groq_api_key = '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'; 
            
            $cFile = new CURLFile($tmpFilePath, 'audio/webm', 'audio.webm');
            
            $ch = curl_init('https://api.groq.com/openai/v1/audio/transcriptions');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Authorization: Bearer ' . $groq_api_key
            ]);
            curl_setopt($ch, CURLOPT_POSTFIELDS, [
                'file' => $cFile,
                'model' => 'whisper-large-v3', // Groq's high-speed Whisper model
                'response_format' => 'json'
            ]);

            $response = curl_exec($ch);
            curl_close($ch);
            
            // Immediately delete the temp file (Ephemeral requirement met)
            @unlink($tmpFilePath);

            $result = json_decode($response, true);
            
            if (isset($result['text'])) {
                echo json_encode(['success' => true, 'text' => trim($result['text'])]);
            } else {
                echo json_encode(['success' => false, 'error' => 'Transcription failed from AI model.', 'details' => $result]);
            }
            break;
            
        default:
            echo json_encode(['success' => false, 'error' => 'Invalid action']);
    }
} catch (Exception $e) {
    if (isset($conn) && $conn->ping()) {
        $conn->rollback();
    }
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}