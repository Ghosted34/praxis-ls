<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - ERADICATION PROTOCOL API (FULL SUITE)
 * ======================================================================================
 * DESCRIPTION: Handles fetching records and executing hard deletes with JSON vaulting
 * across all 15 major system modules. Uses strict SQL transactions to prevent orphans.
 * ======================================================================================
 */

declare(strict_types=1);
require_once __DIR__ . '/../includes/init.php'; 
require_once __DIR__ . '/../includes/role_guard.php';

header('Content-Type: application/json');

// Extremely strict role guard.
require_role(['ADMIN', 'MANAGEMENT']);

$json_payload = json_decode(file_get_contents('php://input'), true);
$action = $_GET['action'] ?? ($json_payload['action'] ?? '');
$employeeId = $_SESSION['auth']['employee_id'] ?? 'UNKNOWN';
$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$userEmail = $_SESSION['auth']['email'] ?? 'unknown@smartls.cm';

$conn = db();

/**
 * Helper: Verifies the provided 6-character password against the current week's hash
 */
function verifyGodModePassword($conn, $inputPassword) {
    $weekNumber = (int)date('W');
    $year = (int)date('Y');
    
    $stmt = $conn->prepare("SELECT password_hash, expires_at FROM god_mode_passwords WHERE week_number = ? AND year = ? LIMIT 1");
    $stmt->bind_param('ii', $weekNumber, $year);
    $stmt->execute();
    $res = $stmt->get_result()->fetch_assoc();
    
    if (!$res) return false;
    if (strtotime($res['expires_at']) < time()) return false;
    return password_verify($inputPassword, $res['password_hash']);
}

try {
    switch ($action) {
        
        // ------------------------------------------------------------------
        // FETCH LOGS (Batches of 50)
        // ------------------------------------------------------------------
        case 'fetch_logs':
            $page = (int)($_GET['page'] ?? 1);
            $limit = 50;
            $offset = ($page - 1) * $limit;
            
            $logs = $conn->query("
                SELECT vault_id, module_name, primary_reference, deleted_by_email, deleted_at 
                FROM deleted_vault_ledger 
                ORDER BY deleted_at DESC 
                LIMIT $limit OFFSET $offset
            ")->fetch_all(MYSQLI_ASSOC);
            
            echo json_encode(['success' => true, 'logs' => $logs]);
            break;

        // ------------------------------------------------------------------
        // SEARCH RECORDS FOR DELETION
        // ------------------------------------------------------------------
        case 'search_records':
            $module = $json_payload['target_module'] ?? '';
            $query = $conn->real_escape_string('%' . ($json_payload['query'] ?? '') . '%');
            $results = [];

            switch($module) {
                // GROUP 1: CRM & PRE-SALES
                case 'LEAD':
                    $results = $conn->query("SELECT lead_id as id, company_name as ref, contact_person as details FROM smart_leads WHERE company_name LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'QUOTE_REQUEST':
                    $results = $conn->query("SELECT quote_request_id as id, public_quote_ref as ref, requester_company as details FROM quote_requests WHERE public_quote_ref LIKE '$query' OR requester_company LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;

                // GROUP 2: PRICING & COSTING
                case 'MARGIN_SIMULATION':
                    $results = $conn->query("SELECT id, simulation_ref as ref, client_name_cached as details FROM marginpricing_simulations WHERE simulation_ref LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'COSTING':
                    $results = $conn->query("SELECT costing_id as id, costing_ref as ref, client_name_cached as details FROM costing_master WHERE costing_ref LIKE '$query' OR operations_file_reference LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'OCR':
                    $results = $conn->query("SELECT ocr_id as id, ocr_id as ref, operations_file_reference as details FROM ocr_master WHERE ocr_id LIKE '$query' OR operations_file_reference LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;

                // GROUP 3: FINANCE & TREASURY
                case 'INVOICE':
                    $results = $conn->query("SELECT invoice_id as id, invoice_no as ref, CONCAT('Total: ', total_xaf) as details FROM invoice_master WHERE invoice_no LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'PROFORMA':
                    $results = $conn->query("SELECT invoice_id as id, invoice_no as ref, CONCAT('Total: ', total_xaf) as details FROM proforma_invoice WHERE invoice_no LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'CASH_REQUEST':
                    $results = $conn->query("SELECT pr_id as id, pr_id as ref, beneficiary as details FROM cash_request_master WHERE pr_id LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'PURCHASE_ORDER':
                    $results = $conn->query("SELECT po_id as id, po_id as ref, supplier_name as details FROM purchase_order_master WHERE po_id LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'DEBT':
                    $results = $conn->query("SELECT engagement_id as id, engagement_id as ref, financier_name as details FROM debt_engagements WHERE engagement_id LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;

                // GROUP 4: LOGISTICS OPERATIONS
                case 'OPS_FILE':
                    $results = $conn->query("SELECT operations_file_reference as id, operations_file_reference as ref, client_name as details FROM operations_file_master WHERE operations_file_reference LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'TRANSIT_ORDER':
                    $results = $conn->query("SELECT id, ot_number_full as ref, operation_file_ref as details FROM transit_orders WHERE ot_number_full LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'DELIVERY_NOTE':
                    $results = $conn->query("SELECT id, dn_number_full as ref, client_name as details FROM delivery_notes WHERE dn_number_full LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;

                // GROUP 5: MASTER REGISTRIES
                case 'CLIENT':
                    $results = $conn->query("SELECT client_id as id, client_id as ref, client_name as details FROM client_master WHERE client_name LIKE '$query' OR client_id LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
                case 'SUPPLIER':
                    $results = $conn->query("SELECT supplier_id as id, supplier_id as ref, supplier_name as details FROM supplier_master WHERE supplier_name LIKE '$query' OR supplier_id LIKE '$query' LIMIT 20")->fetch_all(MYSQLI_ASSOC);
                    break;
            }
            
            echo json_encode(['success' => true, 'results' => $results]);
            break;

        // ------------------------------------------------------------------
        // THE ERADICATION ENGINE
        // ------------------------------------------------------------------
        case 'execute_delete':
            $password = $json_payload['auth_token'] ?? '';
            $module = $json_payload['target_module'] ?? '';
            $targetId = $conn->real_escape_string((string)($json_payload['target_id'] ?? ''));

            // 1. Verify Password
            if (!verifyGodModePassword($conn, $password)) {
                throw new Exception("Invalid or expired authorization token.");
            }

            if ($targetId === '') throw new Exception("Invalid Target ID.");

            // 2. BEGIN TRANSACTION
            $conn->begin_transaction();
            
            $vaultPayload = [];
            $primaryRef = $targetId;

            try {
                // ==========================================
                // GROUP 1: CRM & PRE-SALES
                // ==========================================
                if ($module === 'LEAD') {
                    $lead = $conn->query("SELECT * FROM smart_leads WHERE lead_id = '$targetId'")->fetch_assoc();
                    if (!$lead) throw new Exception("Lead not found.");
                    $primaryRef = $lead['company_name'];
                    $proposals = $conn->query("SELECT * FROM smart_proposals WHERE lead_id = '$targetId'")->fetch_all(MYSQLI_ASSOC);
                    $proposalIds = array_column($proposals, 'proposal_id');
                    
                    $vaultPayload = json_encode(['lead' => $lead, 'proposals' => $proposals]);
                    
                    if (!empty($proposalIds)) {
                        $idString = implode(',', $proposalIds);
                        $conn->query("DELETE FROM smart_proposal_lines WHERE proposal_id IN ($idString)");
                        $conn->query("DELETE FROM smart_proposal_narratives WHERE proposal_id IN ($idString)");
                        $conn->query("DELETE FROM smart_proposals WHERE lead_id = '$targetId'");
                    }
                    $conn->query("DELETE FROM smart_leads WHERE lead_id = '$targetId'");
                }
                elseif ($module === 'QUOTE_REQUEST') {
                    $master = $conn->query("SELECT * FROM quote_requests WHERE quote_request_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Quote Request not found.");
                    $primaryRef = $master['public_quote_ref'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM quote_request_attachments WHERE quote_request_id = '$targetId'");
                    $conn->query("DELETE FROM quote_request_documents WHERE quote_request_id = '$targetId'");
                    $conn->query("DELETE FROM quote_request_history WHERE quote_request_id = '$targetId'");
                    $conn->query("DELETE FROM quote_request_upload_staging WHERE upload_token = '$targetId'"); // Assuming token match
                    $conn->query("DELETE FROM quote_requests WHERE quote_request_id = '$targetId'");
                }

                // ==========================================
                // GROUP 2: PRICING & COSTING
                // ==========================================
                elseif ($module === 'MARGIN_SIMULATION') {
                    $master = $conn->query("SELECT * FROM marginpricing_simulations WHERE id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Simulation not found.");
                    $primaryRef = $master['simulation_ref'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM marginpricing_simulation_lines WHERE marginpricing_simulation_id = '$targetId'");
                    $conn->query("DELETE FROM marginpricing_simulation_events WHERE marginpricing_simulation_id = '$targetId'");
                    $conn->query("DELETE FROM marginpricing_simulations WHERE id = '$targetId'");
                }
                elseif ($module === 'COSTING') {
                    $master = $conn->query("SELECT * FROM costing_master WHERE costing_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Costing not found.");
                    $primaryRef = $master['costing_ref'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM costing_line WHERE costing_id = '$targetId'");
                    $conn->query("DELETE FROM costing_master WHERE costing_id = '$targetId'");
                }
                elseif ($module === 'OCR') {
                    $master = $conn->query("SELECT * FROM ocr_master WHERE ocr_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("OCR not found.");
                    $primaryRef = $master['ocr_id'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM ocr_line WHERE ocr_id = '$targetId'");
                    $conn->query("DELETE FROM ocr_master WHERE ocr_id = '$targetId'");
                }

                // ==========================================
                // GROUP 3: FINANCE & TREASURY
                // ==========================================
                elseif ($module === 'INVOICE') {
                    $master = $conn->query("SELECT * FROM invoice_master WHERE invoice_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Invoice not found.");
                    $primaryRef = $master['invoice_no'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM invoice_lines WHERE invoice_id = '$targetId'");
                    $conn->query("DELETE FROM invoice_payment_history WHERE invoice_id = '$targetId'");
                    $conn->query("DELETE FROM invoice_master WHERE invoice_id = '$targetId'");
                    $conn->query("UPDATE operations_file_master SET final_invoice_id = NULL, final_invoice_amount = 0.00 WHERE final_invoice_id = '$targetId'");
                }
                elseif ($module === 'PROFORMA') {
                    $master = $conn->query("SELECT * FROM proforma_invoice WHERE invoice_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Proforma not found.");
                    $primaryRef = $master['invoice_no'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM proforma_invoice_lines WHERE invoice_id = '$targetId'");
                    $conn->query("DELETE FROM proforma_payment_history WHERE invoice_id = '$targetId'");
                    $conn->query("DELETE FROM proforma_invoice WHERE invoice_id = '$targetId'");
                    $conn->query("UPDATE operations_file_master SET proforma_invoice_id = NULL, proforma_invoice_amount = 0.00 WHERE proforma_invoice_id = '$targetId'");
                }
                elseif ($module === 'CASH_REQUEST') {
                    $master = $conn->query("SELECT * FROM cash_request_master WHERE pr_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Cash Request not found.");
                    $primaryRef = $master['pr_id'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM cash_request_lines WHERE pr_id = '$targetId'");
                    $conn->query("DELETE FROM cash_request_payments WHERE pr_id = '$targetId'");
                    $conn->query("DELETE FROM cash_request_master WHERE pr_id = '$targetId'");
                }
                elseif ($module === 'PURCHASE_ORDER') {
                    $master = $conn->query("SELECT * FROM purchase_order_master WHERE po_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Purchase Order not found.");
                    $primaryRef = $master['po_id'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM purchase_order_items WHERE po_id = '$targetId'");
                    $conn->query("DELETE FROM purchase_order_master WHERE po_id = '$targetId'");
                }
                elseif ($module === 'DEBT') {
                    $master = $conn->query("SELECT * FROM debt_engagements WHERE engagement_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Debt Engagement not found.");
                    $primaryRef = $master['engagement_id'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM debt_repayments WHERE engagement_id = '$targetId'");
                    $conn->query("DELETE FROM debt_engagements WHERE engagement_id = '$targetId'");
                }

                // ==========================================
                // GROUP 4: LOGISTICS OPERATIONS
                // ==========================================
                elseif ($module === 'OPS_FILE') {
                    $master = $conn->query("SELECT * FROM operations_file_master WHERE operations_file_reference = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Operations File not found.");
                    $primaryRef = $master['operations_file_reference'];
                    $vaultPayload = json_encode(['master' => $master]); 

                    // Wipe Cost Entries via Ledger
                    $ledger = $conn->query("SELECT ledger_id FROM cost_tracking_ledger WHERE operations_file_reference = '$targetId'")->fetch_assoc();
                    if ($ledger) {
                        $lId = $ledger['ledger_id'];
                        $conn->query("DELETE FROM cost_entries WHERE ledger_id = '$lId'");
                    }

                    $conn->query("DELETE FROM cost_tracking_ledger WHERE operations_file_reference = '$targetId'");
                    $conn->query("DELETE FROM ops_milestone_instance WHERE operations_file_reference = '$targetId'");
                    $conn->query("DELETE FROM ops_evidence_document WHERE operations_file_reference = '$targetId'");
                    $conn->query("DELETE FROM document_vault WHERE operations_file_reference = '$targetId'");
                    $conn->query("DELETE FROM operations_file_master WHERE operations_file_reference = '$targetId'");
                }
                elseif ($module === 'TRANSIT_ORDER') {
                    $master = $conn->query("SELECT * FROM transit_orders WHERE id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Transit Order not found.");
                    $primaryRef = $master['ot_number_full'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM transit_orders WHERE id = '$targetId'");
                }
                elseif ($module === 'DELIVERY_NOTE') {
                    $master = $conn->query("SELECT * FROM delivery_notes WHERE id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Delivery Note not found.");
                    $primaryRef = $master['dn_number_full'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM delivery_notes WHERE id = '$targetId'");
                }

                // ==========================================
                // GROUP 5: MASTER REGISTRIES
                // ==========================================
                elseif ($module === 'CLIENT') {
                    $master = $conn->query("SELECT * FROM client_master WHERE client_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Client not found.");
                    $primaryRef = $master['client_name'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM client_documents WHERE client_id = '$targetId'");
                    $conn->query("DELETE FROM client_master WHERE client_id = '$targetId'");
                }
                elseif ($module === 'SUPPLIER') {
                    $master = $conn->query("SELECT * FROM supplier_master WHERE supplier_id = '$targetId'")->fetch_assoc();
                    if (!$master) throw new Exception("Supplier not found.");
                    $primaryRef = $master['supplier_name'];
                    $vaultPayload = json_encode(['master' => $master]);

                    $conn->query("DELETE FROM supplier_documents WHERE supplier_id = '$targetId'");
                    $conn->query("DELETE FROM supplier_master WHERE supplier_id = '$targetId'");
                }
                else {
                    throw new Exception("Module cascading rules not defined.");
                }

                // ---------------------------------------------------------
                // LOG TO IMMUTABLE VAULT
                // ---------------------------------------------------------
                $stmtVault = $conn->prepare("INSERT INTO deleted_vault_ledger (module_name, primary_reference, deleted_by_user_id, deleted_by_email, json_payload) VALUES (?, ?, ?, ?, ?)");
                $stmtVault->bind_param('ssiss', $module, $primaryRef, $userId, $userEmail, $vaultPayload);
                $stmtVault->execute();

                // 3. COMMIT TRANSACTION
                $conn->commit();
                
                // Extra Security Audit Log
                $conn->query("INSERT INTO audit_log (user_id, action_type, details, severity) VALUES ($userId, 'HARD_DELETE', 'Deleted $module: $primaryRef', 'CRITICAL')");

                echo json_encode(['success' => true, 'message' => "Record [ $primaryRef ] completely eradicated and vaulted."]);

            } catch (Exception $innerE) {
                $conn->rollback();
                throw new Exception("Deletion failed: " . $innerE->getMessage());
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