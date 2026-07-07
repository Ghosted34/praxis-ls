<?php
/*
 * ======================================================================================
 * PUBLIC PROPOSAL API (For Client-Facing PDF Portal)
 * ======================================================================================
 * This API is strictly public (no role_guard.php) and relies securely on the unique Token.
 */

declare(strict_types=1);
require_once __DIR__ . '/../includes/init.php'; 

header('Content-Type: application/json');

$token = $_GET['token'] ?? '';

if (empty($token)) {
    echo json_encode(['success' => false, 'error' => 'Token missing']);
    exit;
}

try {
    $conn = db();
    
    // Fetch Proposal, Lead, Sales Rep data, AND AI Narrative
    $sql = "SELECT p.*, l.company_name, l.contact_person, l.email_address, l.phone_number, l.address,
                   em.full_name AS rep_name, em.job_title AS rep_title,
                   n.client_context_en, n.client_context_fr, n.case_study_title_en, n.case_study_body_en,
                   n.case_study_title_fr, n.case_study_body_fr,
                   n.operational_strategy_en, n.operational_strategy_fr,
                   n.custom_slas_en, n.custom_slas_fr
            FROM smart_proposals p
            JOIN smart_leads l ON p.lead_id = l.lead_id
            JOIN employee_master em ON p.created_by_employee_id = em.employee_id
            LEFT JOIN smart_proposal_narratives n ON p.proposal_id = n.proposal_id
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

    // Structure the JSON output
    echo json_encode([
        'success' => true,
        'data' => [
            'proposal' => [
                'ref' => $proposal['proposal_ref'],
                'date' => date('Y-m-d', strtotime($proposal['created_at'])),
                'timestamp' => date('Y-m-d H:i:s T', strtotime($proposal['created_at'])),
                'hash' => $proposal['signature_hash'] ?? 'Pending',
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
            'lines' => $lines,
            'narrative' => [
                'context_en' => $proposal['client_context_en'] ?? '',
                'context_fr' => $proposal['client_context_fr'] ?? '',
                'strategy_en' => $proposal['operational_strategy_en'] ?? '',
                'strategy_fr' => $proposal['operational_strategy_fr'] ?? '',
                'case_title_en' => $proposal['case_study_title_en'] ?? '',
                'case_body_en' => $proposal['case_study_body_en'] ?? '',
                'case_title_fr' => $proposal['case_study_title_fr'] ?? '',
                'case_body_fr' => $proposal['case_study_body_fr'] ?? '',
                // Decode the JSON strings back into arrays for the frontend to loop through easily
                'slas_en' => json_decode($proposal['custom_slas_en'] ?? '[]', true),
                'slas_fr' => json_decode($proposal['custom_slas_fr'] ?? '[]', true)
            ]
        ]
    ]);
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}