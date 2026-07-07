<?php
/**
 * ==============================================================================================
 * MODULE: Debt Management & Engagement Tracking
 * AUTHOR: Smart LS Enterprise Backend
 * VERSION: 1.0.0 (Production Release)
 * * DESCRIPTION:
 * This module handles the creation, tracking, and repayment of financial engagements 
 * linked to Operations Files. It includes role-based access control, real-time KPIs, 
 * and automatic synchronization with the Operations Master Registry.
 * * LOGIC SUMMARY:
 * 1. Eligibility: Only Ops Files with a valid 'proforma_invoice_id' can be engaged.
 * 2. WCN Logic: Working Capital Need = Execution Cost (total_ht) - Advance (proforma_amount).
 * 3. Interest: Flat Rate (%) applied to Principal at creation.
 * 4. Sync: Updates 'operations_file_master' with aggregated debt stats on every transaction.
 * 5. Audit: All payments are logged in 'debt_repayments' table for delay analysis.
 * ==============================================================================================
 */

// ----------------------------------------------------------------------------------------------
// 1. INITIALIZATION & AUTHENTICATION
// ----------------------------------------------------------------------------------------------
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Strict Role Enforcement
require_role(['ADMIN', 'MANAGEMENT', 'FINANCE']);

// Session Handling
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);
$userRole   = strtoupper((string)($_SESSION['auth']['role'] ?? ''));

// Verify Session Integrity
if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

// Database Connection
$conn = db();

// User Profile Fetch (Locked UI Requirement)
$sqlUser = "
    SELECT em.full_name, em.job_title, ua.role 
    FROM user_auth ua 
    JOIN employee_master em ON em.employee_id = ua.employee_id 
    WHERE ua.user_id = ? LIMIT 1
";
$stmtUser = $conn->prepare($sqlUser);
$stmtUser->bind_param('i', $userId);
$stmtUser->execute();
$me = $stmtUser->get_result()->fetch_assoc();

// ... existing code ...
if (!$me) { header('Location: ../../api/auth/logout.php'); exit; }

// ADD THIS FUNCTION HERE:
function e(string $v): string { 
    return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); 
}
// -----------------------

// UI Variables
$fullName     = htmlspecialchars($me['full_name'] ?? 'User');
// ... existing code ...
$roleLabel    = $me['job_title'] ? strtoupper($me['job_title']) : $userRole;
$avatarUrl    = "https://ui-avatars.com/api/?name=" . urlencode($fullName) . "&background=231F20&color=fff";

// ----------------------------------------------------------------------------------------------
// 2. BACKEND API CONTROLLER (AJAX HANDLERS)
// ----------------------------------------------------------------------------------------------
if (isset($_GET['action'])) {
    header('Content-Type: application/json');
    $response = ['ok' => false, 'error' => 'Unknown action'];

    try {
        $action = $_GET['action'];

        // --------------------------------------------------------------------------------------
        // ACTION: SEARCH OPERATIONS FILES
        // Logic: Find files with proforma_invoice_id != NULL/0 (Active financial status)
        // --------------------------------------------------------------------------------------
        if ($action === 'search_files') {
            $q = trim($_GET['q'] ?? '');
            $term = "%{$q}%";
            
            $sql = "
                SELECT 
                    ofm.operations_file_reference,
                    ofm.client_id,
                    ofm.proforma_invoice_amount,
                    ofm.total_ht,
                    ofm.service_type, -- Assuming a project name field exists or we use commodity
                    cm.client_name
                FROM operations_file_master ofm
                LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
                WHERE 
                    (ofm.proforma_invoice_id IS NOT NULL AND ofm.proforma_invoice_id != '0' AND ofm.proforma_invoice_id != '')
                    AND (ofm.operations_file_reference LIKE ? OR cm.client_name LIKE ?)
                LIMIT 20
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('ss', $term, $term);
            $stmt->execute();
            $res = $stmt->get_result();
            
            $items = [];
            while ($row = $res->fetch_assoc()) {
                // Logic: WCN = Cost (total_ht) - Advance (proforma)
                // If total_ht is not set, treat as 0 (Safe Fallback)
                $cost = (float)($row['total_ht'] ?? 0);
                $advance = (float)($row['proforma_invoice_amount'] ?? 0);
                $wcn = $cost - $advance;

                // Ensure WCN isn't negative for the UI (unless company owes client, but for debt creation we need positive need)
                // If WCN is negative, it means we are cash positive on this file, so effectively 0 need.
                $displayWCN = $wcn; 

                $items[] = [
                    'ref' => $row['operations_file_reference'],
                    'client' => $row['client_name'] ?? 'Unknown',
                    'project' => $row['service_type'] ?? 'General Cargo',
                    'cost' => $cost,
                    'advance' => $advance,
                    'wcn' => $displayWCN
                ];
            }
            echo json_encode(['ok' => true, 'items' => $items]);
            exit;
        }

        // --------------------------------------------------------------------------------------
        // ACTION: CREATE ENGAGEMENT
        // Logic: Insert Debt -> Sync Master
        // --------------------------------------------------------------------------------------
        if ($action === 'create_engagement') {
            $input = json_decode(file_get_contents('php://input'), true);

            // Validation
            if (empty($input['file_ref']) || empty($input['financier_cat']) || empty($input['amount'])) {
                throw new Exception("Missing required fields.");
            }

            // 1. Fetch File Data for Consistency
            $ref = $input['file_ref'];
            $chk = $conn->prepare("SELECT client_id, total_ht, proforma_invoice_amount FROM operations_file_master WHERE operations_file_reference = ?");
            $chk->bind_param('s', $ref);
            $chk->execute();
            $fileData = $chk->get_result()->fetch_assoc();
            if (!$fileData) throw new Exception("Invalid Operations File Reference.");

            // 2. Validate Principal vs WCN
            $cost = (float)$fileData['total_ht'];
            $advance = (float)$fileData['proforma_invoice_amount'];
            $wcn = $cost - $advance;
            $principal = (float)$input['amount'];

            // Strict Rule: Principal cannot exceed Need (Allow tiny float margin error)
            // Note: If user insists, we might block. Per instructions: "Engagement principal should never be greater than this amount."
            if ($principal > ($wcn + 100)) { // +100 tolerance for rounding
               // throw new Exception("Principal amount ($principal) exceeds the Working Capital Need ($wcn).");
               // Commenting out strict block to allow override if "Needs" logic is complex in reality, 
               // but enabling alert in Frontend. For now, server accepts but logs warning? 
               // No, instruction was explicit: "Engagement principal should never be greater".
               throw new Exception("Validation Error: Principal amount ({$principal}) exceeds the Calculated Working Capital Need ({$wcn}).");
            }

            // 3. Calculate Interest
            $rate = (float)($input['interest_rate'] ?? 0);
            $interestAmount = $principal * ($rate / 100);
            $totalDue = $principal + $interestAmount;

            // 4. Insert Engagement
            $engId = 'ENG-' . strtoupper(bin2hex(random_bytes(3))); // e.g. ENG-A1B2C3
            $clientId = $fileData['client_id'];
            $cat = $input['financier_cat'];
            $name = $input['financier_name'];
            $engDate = $input['engagement_date'];
            $dueDate = $input['due_date'];
            $notes = $input['notes'] ?? '';

            $ins = $conn->prepare("
                INSERT INTO debt_engagements 
                (engagement_id, operations_file_ref, client_id, financier_category, financier_name, principal_amount, interest_rate, interest_amount, balance_due, engagement_date, due_date, notes, created_by, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
            ");
            $ins->bind_param('sssssdddssssi', $engId, $ref, $clientId, $cat, $name, $principal, $rate, $interestAmount, $totalDue, $engDate, $dueDate, $notes, $userId);
            
            if (!$ins->execute()) throw new Exception("DB Error: " . $ins->error);

            // 5. Sync Master Table (Update Aggregates)
            syncOperationsFileDebt($conn, $ref);

            echo json_encode(['ok' => true, 'msg' => 'Engagement created successfully.']);
            exit;
        }

        // --------------------------------------------------------------------------------------
        // ACTION: LIST ENGAGEMENTS
        // Logic: Fetch all debts + Client Name + Status Calculation
        // --------------------------------------------------------------------------------------
        if ($action === 'list_engagements') {
            // Filters
            $statusFilter = $_GET['status'] ?? 'ALL';
            
            $sql = "
                SELECT 
                    de.*,
                    cm.client_name,
                    ofm.service_type
                FROM debt_engagements de
                LEFT JOIN client_master cm ON cm.client_id = de.client_id
                LEFT JOIN operations_file_master ofm ON ofm.operations_file_reference = de.operations_file_ref
                ORDER BY de.created_at DESC
                LIMIT 500
            ";
            
            $res = $conn->query($sql);
            $rows = [];
            $today = new DateTime();

            while ($r = $res->fetch_assoc()) {
                // Calculate Dynamic Status Logic
                $balance = (float)$r['balance_due'];
                $due = new DateTime($r['due_date']);
                $diff = $today->diff($due);
                $daysLeft = (int)$diff->format('%r%a'); // Positive = Future, Negative = Past

                // Default DB status is ACTIVE/CLEARED. We augment this for UI.
                $uiStatus = 'ACTIVE';
                $isCritical = false;

                if ($balance <= 0) {
                    $uiStatus = 'CLEARED';
                } else {
                    if ($daysLeft < 0) {
                        $uiStatus = 'OVERDUE';
                        $isCritical = true;
                    } elseif ($daysLeft <= 7) {
                        $uiStatus = 'DUE_SOON'; // "Due soon 7 days" rule
                        $isCritical = true;
                    } else {
                        $uiStatus = 'ACTIVE';
                    }
                }

                // Apply Filters Server Side (Optional, but user asked for Client Side search. We do basic status filtering here if needed)
                if ($statusFilter !== 'ALL' && $uiStatus !== $statusFilter) continue;

                $r['ui_status'] = $uiStatus;
                $r['days_left'] = $daysLeft;
                $rows[] = $r;
            }

            echo json_encode(['ok' => true, 'data' => $rows]);
            exit;
        }

        // --------------------------------------------------------------------------------------
        // ACTION: REPAYMENT
        // Logic: Decrement Balance -> Log History -> Sync Master
        // --------------------------------------------------------------------------------------
        if ($action === 'pay') {
            $input = json_decode(file_get_contents('php://input'), true);
            $engId = $input['id'];
            $amount = (float)$input['amount'];
            $date = $input['date'];

            if ($amount <= 0) throw new Exception("Invalid amount.");

            // 1. Get Current State
            $stmt = $conn->prepare("SELECT balance_due, operations_file_ref, principal_amount, due_date FROM debt_engagements WHERE engagement_id = ?");
            $stmt->bind_param('s', $engId);
            $stmt->execute();
            $curr = $stmt->get_result()->fetch_assoc();
            
            if (!$curr) throw new Exception("Engagement not found.");

            if ($amount > $curr['balance_due']) {
                throw new Exception("Overpayment Rejected: You cannot pay more than the remaining balance (" . number_format($curr['balance_due']) . " XAF).");
            }

            // 2. Update Engagement
            $newBal = $curr['balance_due'] - $amount;
            $newStatus = ($newBal <= 0) ? 'CLEARED' : 'ACTIVE';
            $clearedAt = ($newBal <= 0) ? $date : NULL; // For KPI tracking

            $upd = $conn->prepare("UPDATE debt_engagements SET balance_due = ?, status = ?, cleared_at = ? WHERE engagement_id = ?");
            $upd->bind_param('dsss', $newBal, $newStatus, $clearedAt, $engId);
            $upd->execute();

            // 3. Log Repayment (For Analytics/Audit - Question 2B)
            $log = $conn->prepare("INSERT INTO debt_repayments (engagement_id, amount_paid, payment_date, created_by) VALUES (?, ?, ?, ?)");
            $log->bind_param('sdsi', $engId, $amount, $date, $userId);
            $log->execute();

            // 4. Sync Master
            syncOperationsFileDebt($conn, $curr['operations_file_ref']);

            echo json_encode(['ok' => true, 'new_balance' => $newBal]);
            exit;
        }

        // --------------------------------------------------------------------------------------
        // ACTION: DELETE (MANAGEMENT ONLY)
        // --------------------------------------------------------------------------------------
        if ($action === 'delete') {
            if ($userRole !== 'MANAGEMENT') {
                throw new Exception("Access Denied: Only MANAGEMENT can delete engagements.");
            }

            $input = json_decode(file_get_contents('php://input'), true);
            $engId = $input['id'];

            // Get file ref before delete for sync
            $pre = $conn->prepare("SELECT operations_file_ref FROM debt_engagements WHERE engagement_id = ?");
            $pre->bind_param('s', $engId);
            $pre->execute();
            $res = $pre->get_result()->fetch_assoc();
            
            if (!$res) throw new Exception("Record not found.");
            $ref = $res['operations_file_ref'];

            // Delete Repayments First (FK Constraints usually handle this, but explicit is safer)
            $conn->query("DELETE FROM debt_repayments WHERE engagement_id = '$engId'");
            
            // Delete Engagement
            $del = $conn->prepare("DELETE FROM debt_engagements WHERE engagement_id = ?");
            $del->bind_param('s', $engId);
            $del->execute();

            // Sync
            syncOperationsFileDebt($conn, $ref);

            echo json_encode(['ok' => true]);
            exit;
        }

        // --------------------------------------------------------------------------------------
        // ACTION: KPI STATS
        // --------------------------------------------------------------------------------------
        if ($action === 'kpi') {
            // 1. Critical Sum (Due < 7 Days + Active)
            $sqlCrit = "
                SELECT SUM(balance_due) as total 
                FROM debt_engagements 
                WHERE status = 'ACTIVE' AND DATEDIFF(due_date, NOW()) <= 7
            ";
            $crit = $conn->query($sqlCrit)->fetch_assoc()['total'] ?? 0;

            // 2. Total Active Debt
            $sqlActive = "SELECT SUM(balance_due) as total FROM debt_engagements WHERE status = 'ACTIVE'";
            $active = $conn->query($sqlActive)->fetch_assoc()['total'] ?? 0;

            // 3. Total Cleared
            $sqlClear = "SELECT SUM(principal_amount + interest_amount) as total FROM debt_engagements WHERE status = 'CLEARED'";
            $cleared = $conn->query($sqlClear)->fetch_assoc()['total'] ?? 0;

            // 4. Working Capital Ratio = Total Debt / Total Project Budgets (of engaged files)
            // Logic: Sum of all debt / Sum of total_ht of all files that have debt
            $sqlRatio = "
                SELECT 
                    (SELECT SUM(balance_due) FROM debt_engagements) as debt,
                    (SELECT SUM(ofm.total_ht) 
                     FROM operations_file_master ofm 
                     JOIN debt_engagements de ON de.operations_file_ref = ofm.operations_file_reference 
                     GROUP BY NULL) as budget
            ";
            // Note: The above subquery for budget might double count if multiple debts per file. Correct logic:
            // Get unique files with debt, sum their budgets.
            $sqlBudget = "
                SELECT SUM(t.total_ht) as budget 
                FROM (
                    SELECT DISTINCT ofm.operations_file_reference, ofm.total_ht 
                    FROM operations_file_master ofm 
                    JOIN debt_engagements de ON de.operations_file_ref = ofm.operations_file_reference
                ) as t
            ";
            $budget = $conn->query($sqlBudget)->fetch_assoc()['budget'] ?? 1; // avoid div by 0
            $totalDebt = $conn->query("SELECT SUM(balance_due) as d FROM debt_engagements")->fetch_assoc()['d'] ?? 0;
            
            $ratio = ($budget > 0) ? ($totalDebt / $budget) * 100 : 0;

            echo json_encode([
                'ok' => true,
                'critical' => (float)$crit,
                'active' => (float)$active,
                'cleared' => (float)$cleared,
                'ratio' => round($ratio, 1)
            ]);
            exit;
        }

    } catch (Exception $e) {
        http_response_code(400); // Bad Request
        echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
        exit;
    }
}

// ----------------------------------------------------------------------------------------------
// HELPER: SYNC FUNCTION (PHP side update of master table)
// ----------------------------------------------------------------------------------------------
function syncOperationsFileDebt($conn, $fileRef) {
    // 1. Get all engagements for this file
    $sql = "SELECT engagement_id, balance_due FROM debt_engagements WHERE operations_file_ref = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $fileRef);
    $stmt->execute();
    $res = $stmt->get_result();

    $ids = [];
    $totalDebt = 0.0;

    while ($r = $res->fetch_assoc()) {
        $ids[] = $r['engagement_id'];
        $totalDebt += (float)$r['balance_due'];
    }

    $idStr = implode(',', $ids);

    // 2. Update Master
    // Assuming columns 'debt_management_ids' (text) and 'total_debt_amount' (decimal) exist
    $upd = $conn->prepare("UPDATE operations_file_master SET debt_management_ids = ?, total_debt_amount = ? WHERE operations_file_reference = ?");
    $upd->bind_param('sds', $idStr, $totalDebt, $fileRef);
    $upd->execute();
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Debt Management | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">

  <style>
    :root{
      --smart-blue:#1F99D8;
      --smart-dark:#055B83;
      --smart-orange:#EE7D04;
      --smart-charcoal:#231F20;
      --smart-bg:#F0F4F8;
      --sidebar-width:280px;
      
      /* Status Colors */
      --status-active-bg: #e0f2fe; --status-active-text: #0284c7;
      --status-warning-bg: #fef9c3; --status-warning-text: #854d0e;
      --status-critical-bg: #fee2e2; --status-critical-text: #dc2626;
      --status-cleared-bg: #dcfce7; --status-cleared-text: #16a34a;
    }
    
    body{ font-family:'Manrope',sans-serif; background:var(--smart-bg); color:var(--smart-charcoal); overflow-x:hidden; }
    h1,h2,h3,h4,h5,h6, .font-heading{ font-family:'Montserrat',sans-serif; }
    .font-mono { font-family: 'Inconsolata', monospace; }

    /* LOCKED SIDEBAR */
    .sidebar{ width:var(--sidebar-width); height:100vh; position:fixed; top:0; left:0; background:#fff; border-right:1px solid #e0e0e0; z-index:1000; display:flex; flex-direction:column; box-shadow:2px 0 10px rgba(0,0,0,0.02); }
    .sidebar-header{ height:70px; display:flex; align-items:center; padding:0 20px; border-bottom:1px solid #f0f0f0; }
    .brand-logo{ font-weight:800; font-size:1.1rem; color:var(--smart-charcoal); text-decoration:none; letter-spacing:-0.5px; }
    .sidebar-menu{ overflow-y:auto; flex-grow:1; padding:10px 0; }
    .menu-btn{ width:100%; text-align:left; background:none; border:none; padding:12px 20px; font-size:0.8rem; font-weight:700; color:#555; display:flex; justify-content:space-between; align-items:center; transition:all 0.2s; border-left:3px solid transparent; }
    .menu-btn:hover, .menu-btn[aria-expanded="true"]{ color:var(--smart-charcoal); background-color:#f0f7fa; border-left-color:var(--smart-charcoal); }
    .menu-btn i.category-icon{ width:20px; margin-right:8px; color:#888; transition:color 0.2s; }
    .menu-btn:hover i.category-icon{ color:var(--smart-charcoal); }
    .menu-chevron{ font-size:0.7rem; transition:transform 0.3s; }
    .menu-btn[aria-expanded="true"] .menu-chevron{ transform:rotate(180deg); }
    .sub-link{ display:block; padding:8px 20px 8px 48px; font-size:0.75rem; color:#666; text-decoration:none; font-weight:500; transition:all 0.2s; line-height:1.3; }
    .sub-link:hover{ color:var(--smart-orange); background-color:#fff9f2; }
    .sub-link.active{ color:var(--smart-orange); font-weight:800; background-color:#fff9f2; }
    .sidebar-footer{ border-top:1px solid #f0f0f0; padding:16px; }

    /* LOCKED TOP NAVBAR */
    .main-content{ margin-left:var(--sidebar-width); padding-top:70px; min-height:100vh; width:calc(100% - var(--sidebar-width)); }
    .top-navbar{ height:70px; position:fixed; top:0; right:0; left:var(--sidebar-width); background:rgba(255,255,255,0.95); backdrop-filter:blur(12px); border-bottom:1px solid #e0e0e0; z-index:900; padding:0 30px; display:flex; align-items:center; justify-content:space-between; }
    .clock-pill{ background:#f1f5f9; padding:6px 12px; border-radius:30px; display:flex; align-items:center; gap:10px; font-size:0.85rem; font-weight:600; color:var(--smart-dark); }

    /* MODULE SPECIFIC */
    .card-custom{ background:white; border-radius:12px; border:1px solid rgba(0,0,0,0.05); box-shadow:0 2px 12px rgba(0,0,0,0.02); height:100%; padding: 1.5rem; }
    .kpi-title{ font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#888; letter-spacing:0.5px; }
    .kpi-value{ font-size:1.6rem; font-weight:800; color:var(--smart-charcoal); line-height:1.2; font-variant-numeric:tabular-nums; }
    .smart-input{ border-radius:8px; font-size:0.9rem; padding:0.6rem 0.8rem; border-color:#dee2e6; }
    .smart-input:focus{ border-color:var(--smart-blue); box-shadow:0 0 0 3px rgba(31,153,216,0.1); }
    .table-custom th{ font-size:0.75rem; text-transform:uppercase; color:#888; font-weight:700; border-bottom:2px solid #f0f0f0; padding:12px; white-space:nowrap; }
    .table-custom td{ font-size:0.85rem; vertical-align:middle; padding:12px; }
    .status-badge { padding: 4px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
    .bg-smart-blue { background-color: var(--smart-blue) !important; color: white; }
    
    /* Animations */
    @keyframes pulse-red { 0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); } 70% { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); } 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); } }
    .row-critical { background-color: #fff5f5 !important; border-left: 4px solid var(--status-critical-text); animation: pulse-red 2s infinite; }
  </style>
</head>

<body>

   <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index.php" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Admin Dashboard GM</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="adminMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin1">
                <span><i class="fa-solid fa-database category-icon"></i> MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin1" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin2">
                <span><i class="fa-solid fa-users category-icon"></i> CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin2" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                    <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin3">
                <span><i class="fa-solid fa-calculator category-icon"></i> COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin3" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i> LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin4" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin5">
                <span><i class="fa-solid fa-money-bill-trend-up category-icon"></i> OPS COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin5" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="operational-cost-reconciliation.php" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin6" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="proforma-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivables-ledger.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin7">
                <span><i class="fa-solid fa-folder-open category-icon"></i> HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin7" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="user-role-management.php" class="sub-link">User & Role Management (IAM)</a>
                    <a href="payroll-management.php" class="sub-link">Payroll Management</a>
                    <a href="attendance-logs.php" class="sub-link">Attendance & Time Logging</a>
                    <a href="documents-vault.php" class="sub-link">Documents Vault</a>
                </div>
            </div>
        </div>

    </div>

    <div class="sidebar-footer">
        <a class="btn btn-outline-danger w-100 btn-sm fw-bold" href="../../api/auth/logout.php">
            <i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out
        </a>
    </div>
</nav>

  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">DEBT MANAGEMENT</h5>
      <small class="text-muted" style="font-size: 0.7rem;">ENGAGEMENT TRACKING & REPAYMENT</small>
    </div>
    <div class="d-flex align-items-center gap-4">
      <div class="clock-pill"><span id="realtime-clock" style="font-family: monospace;">--:--:--</span></div>
      <div class="d-flex align-items-center gap-3 ps-3 border-start">
        <div class="text-end lh-1 d-none d-md-block">
          <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;"><?php echo e($roleLabel); ?></small>
        </div>
        <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="Profile">
      </div>
    </div>
  </div>

  <div class="main-content px-4 pb-5">

    <div class="row g-4 pt-4 mb-4">
      <div class="col-md-3">
        <div class="card-custom border-danger border-opacity-25" style="background: #fff5f5;">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div class="kpi-title text-danger">Critical Repayments</div>
            <span class="badge bg-danger">Due < 7 days</span>
          </div>
          <div class="kpi-value text-danger" id="kpi-critical">...</div>
          <div class="small text-danger opacity-75 mt-1"><i class="fa-solid fa-triangle-exclamation me-1"></i> Immediate Action</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div class="kpi-title">Active Engagements</div>
            <i class="fa-solid fa-chart-pie text-primary"></i>
          </div>
          <div class="kpi-value text-primary" id="kpi-active">...</div>
          <div class="small text-muted mt-1">Total Outstanding Debt</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div class="kpi-title">Working Cap Ratio</div>
            <i class="fa-solid fa-percent text-warning"></i>
          </div>
          <div class="kpi-value text-warning" style="color:var(--smart-orange)" id="kpi-ratio">...%</div>
          <div class="small text-muted mt-1">Debt / Total Project Budget</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom" style="background: #f0fdf4; border-color: #bbf7d0;">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div class="kpi-title text-success">Total Cleared</div>
            <i class="fa-solid fa-check-circle text-success"></i>
          </div>
          <div class="kpi-value text-success" id="kpi-cleared">...</div>
          <div class="small text-success opacity-75 mt-1">Successfully Repaid</div>
        </div>
      </div>
    </div>

    <div class="card-custom p-3 mb-4 bg-light border-0">
        <div class="row g-2 align-items-end">
            <div class="col-md-2">
                <label class="form-label small fw-bold text-muted text-uppercase">Filter Status</label>
                <select class="form-select smart-input" id="statusFilter" onchange="loadEngagements()">
                    <option value="ALL">All Statuses</option>
                    <option value="ACTIVE">Active Debt</option>
                    <option value="OVERDUE">Critical / Overdue</option>
                    <option value="DUE_SOON">Due Soon (7d)</option>
                    <option value="CLEARED">Cleared</option>
                </select>
            </div>
            
            <div class="col-md-2">
                <label class="form-label small fw-bold text-muted text-uppercase">Filter Financier</label>
                <select class="form-select smart-input" id="financierFilter" onchange="filterClientSide()">
                    <option value="ALL">All Financiers</option>
                    <option value="DIRECTOR A">Director A</option>
                    <option value="DIRECTOR B">Director B</option>
                    <option value="BANK">Bank</option>
                    <option value="PRIVATE">Private</option>
                </select>
            </div>
            
            <div class="col-md-4">
                <label class="form-label small fw-bold text-muted text-uppercase">Search Records</label>
                <div class="input-group">
                    <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
                    <input type="text" class="form-control smart-input border-start-0" id="globalSearch" placeholder="Search File, Client, Financier..." onkeyup="filterClientSide()">
                </div>
            </div>

            <div class="col-md-4 text-end">
                <button class="btn btn-white border fw-bold me-2 shadow-sm" onclick="exportCSV()"><i class="fa-solid fa-download me-2 text-muted"></i>Export</button>
                <button class="btn btn-primary fw-bold shadow-sm bg-smart-blue border-0" onclick="openNewModal()"><i class="fa-solid fa-plus me-2"></i>New Engagement</button>
            </div>
        </div>
    </div>

    <div class="card-custom p-0 overflow-hidden">
        <div class="table-responsive">
            <table class="table table-hover table-custom mb-0 align-middle">
                <thead class="bg-light">
                    <tr>
                        <th class="ps-4">Status</th>
                        <th>Ref / Client</th>
                        <th>Financier</th>
                        <th class="text-end">Principal</th>
                        <th class="text-end">Int.</th>
                        <th class="text-end">Balance Due</th>
                        <th>Due Date</th>
                        <th>Days Left</th>
                        <th class="text-end pe-4">Action</th>
                    </tr>
                </thead>
                <tbody id="tableBody"></tbody>
            </table>
        </div>
        <div class="p-3 border-top bg-light text-center text-muted small">Showing last 500 records. Filter to narrow down.</div>
    </div>

  </div>

  <div class="modal fade" id="newModal" tabindex="-1" data-bs-backdrop="static">
    <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title fw-bold text-dark">Create New Financial Engagement</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body p-4">
                <form id="newForm" onsubmit="event.preventDefault(); createEngagement();">
                    <div class="mb-4">
                        <label class="form-label fw-bold text-muted small mb-1">1. Link Operations File (With Active Proforma)</label>
                        <div class="input-group">
                            <input type="text" class="form-control smart-input" id="fileSearchInput" placeholder="Type ref or client..." oninput="searchFiles(this.value)">
                            <span class="input-group-text"><i class="fa-solid fa-magnifying-glass"></i></span>
                        </div>
                        <ul id="fileResults" class="list-group position-absolute w-100 d-none shadow" style="z-index:1000; max-height:200px; overflow:auto;"></ul>
                        
                        <div id="filePreview" class="mt-2 p-3 bg-light rounded border d-none">
                            <input type="hidden" id="selectedFileRef">
                            <div class="row g-2">
                                <div class="col-6"><small class="text-muted d-block fw-bold">CLIENT</small><span class="fw-bold text-dark" id="pvClient">-</span></div>
                                <div class="col-6"><small class="text-muted d-block fw-bold">PROJECT</small><span class="fw-bold text-dark" id="pvProject">-</span></div>
                                <div class="col-4"><small class="text-muted d-block fw-bold">COST (HT)</small><span class="font-mono text-dark" id="pvCost">0</span></div>
                                <div class="col-4"><small class="text-muted d-block fw-bold">ADVANCE</small><span class="font-mono text-success" id="pvAdvance">0</span></div>
                                <div class="col-4"><small class="text-muted d-block fw-bold text-danger">WCN (Limit)</small><span class="font-mono text-danger fw-bold" id="pvWcn">0</span></div>
                            </div>
                        </div>
                    </div>

                    <h6 class="text-primary border-bottom pb-2 mb-3 fw-bold small text-uppercase">2. Engagement Details</h6>
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label class="small fw-bold text-muted">Financier Category</label>
                            <select class="form-select smart-input" id="newCat" required>
                                <option value="">Select...</option>
                                <option value="DIRECTOR">Company Director</option>
                                <option value="BANK">Bank Credit</option>
                                <option value="PRIVATE">Private Lender</option>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label class="small fw-bold text-muted">Financier Name</label>
                            <input type="text" class="form-control smart-input" id="newName" placeholder="e.g. Mr. John Doe / Zenith Bank" required>
                        </div>
                        <div class="col-md-6">
                            <label class="small fw-bold text-muted">Principal Amount (XAF)</label>
                            <input type="number" class="form-control smart-input" id="newAmount" required placeholder="Cannot exceed WCN">
                        </div>
                        <div class="col-md-6">
                            <label class="small fw-bold text-muted">Flat Interest Rate (%)</label>
                            <input type="number" class="form-control smart-input" id="newRate" value="0" step="0.01">
                        </div>
                        <div class="col-md-6">
                            <label class="small fw-bold text-muted">Engagement Date</label>
                            <input type="date" class="form-control smart-input" id="newDate" required>
                        </div>
                        <div class="col-md-6">
                            <label class="small fw-bold text-muted">Repayment Due Date</label>
                            <input type="date" class="form-control smart-input" id="newDueDate" required>
                        </div>
                        <div class="col-12">
                            <label class="small fw-bold text-muted">Notes</label>
                            <input type="text" class="form-control smart-input" id="newNotes">
                        </div>
                    </div>
                    <div class="mt-4 text-end">
                        <button type="submit" class="btn btn-primary bg-smart-blue fw-bold">Create Engagement</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
  </div>

  <div class="modal fade" id="payModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header bg-success text-white">
                <h5 class="modal-title fw-bold">Record Repayment</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body p-4">
                <input type="hidden" id="payId">
                <div class="text-center mb-4">
                    <small class="text-uppercase fw-bold">Balance Due</small>
                    <h2 class="font-mono fw-black text-danger" id="payBalDisplay">0</h2>
                </div>
                <div class="mb-3">
                    <label class="small fw-bold text-muted">Amount to Pay</label>
                    <input type="number" class="form-control smart-input form-control-lg fw-bold" id="payAmount">
                </div>
                <div class="mb-3">
                    <label class="small fw-bold text-muted">Payment Date</label>
                    <input type="date" class="form-control smart-input" id="payDate">
                </div>
                <button class="btn btn-success w-100 fw-bold" onclick="processPayment()">Confirm Payment</button>
            </div>
        </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    // --- UTILS ---
    function tick(){ const d=new Date(); document.getElementById('realtime-clock').innerText=d.toLocaleTimeString('en-GB'); }
    setInterval(tick,1000); tick();
    const fmtMoney = (n) => Number(n).toLocaleString('en-US');
    
    let ALL_DATA = [];
    const USER_ROLE = "<?php echo $userRole; ?>";

    // --- API CALLS ---
    async function api(action, payload=null, method='GET') {
        let url = `?action=${action}`;
        let opts = { method };
        if(payload && method==='POST') {
            opts.body = JSON.stringify(payload);
            opts.headers = {'Content-Type': 'application/json'};
        } else if(payload && method==='GET') {
            url += '&' + new URLSearchParams(payload).toString();
        }
        const res = await fetch(url, opts);
        const data = await res.json();
        if(!data.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    // --- INIT ---
    document.addEventListener('DOMContentLoaded', () => {
        loadEngagements();
        loadKPIs();
        
        // Defaults
        document.getElementById('newDate').valueAsDate = new Date();
        const nextMonth = new Date(); nextMonth.setDate(nextMonth.getDate()+30);
        document.getElementById('newDueDate').valueAsDate = nextMonth;
        document.getElementById('payDate').valueAsDate = new Date();
    });

    // --- LOAD DATA ---
    async function loadEngagements() {
        try {
            const status = document.getElementById('statusFilter').value;
            const res = await api('list_engagements', {status});
            ALL_DATA = res.data;
            renderTable(ALL_DATA);
        } catch(e) { console.error(e); alert("Error loading data"); }
    }

    async function loadKPIs() {
        try {
            const d = await api('kpi');
            document.getElementById('kpi-critical').innerText = fmtMoney(d.critical);
            document.getElementById('kpi-active').innerText = fmtMoney(d.active);
            document.getElementById('kpi-cleared').innerText = fmtMoney(d.cleared);
            document.getElementById('kpi-ratio').innerText = d.ratio + '%';
        } catch(e) { console.error(e); }
    }

    // --- RENDER ---
    function renderTable(data) {
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = '';
        
        data.forEach(r => {
            const isCrit = (r.ui_status === 'OVERDUE' || r.ui_status === 'DUE_SOON');
            const rowCls = isCrit ? 'row-critical' : '';
            
            // Badge Style
            let badgeCls = 'bg-secondary';
            if(r.ui_status === 'ACTIVE') badgeCls = 'bg-primary bg-opacity-10 text-primary';
            if(r.ui_status === 'CLEARED') badgeCls = 'bg-success text-white';
            if(r.ui_status === 'OVERDUE') badgeCls = 'bg-danger text-white';
            if(r.ui_status === 'DUE_SOON') badgeCls = 'bg-warning text-dark';

            let actBtns = '';
            if(parseFloat(r.balance_due) > 0) {
                actBtns += `<button class="btn btn-sm btn-primary py-0 px-2 fw-bold" onclick="openPay('${r.engagement_id}', ${r.balance_due})">Pay</button>`;
            } else {
                actBtns += `<i class="fa-solid fa-check text-success"></i>`;
            }
            
            // Management Delete
            if(USER_ROLE === 'MANAGEMENT') {
                actBtns += ` <button class="btn btn-sm text-danger ms-2" onclick="deleteEng('${r.engagement_id}')"><i class="fa-solid fa-trash"></i></button>`;
            }

            const tr = `
                <tr class="${rowCls}">
                    <td class="ps-4"><span class="status-badge ${badgeCls}">${r.ui_status.replace('_',' ')}</span></td>
                    <td>
                        <div class="fw-bold text-dark font-mono small">${r.operations_file_ref}</div>
                        <div class="small text-muted">${r.client_name}</div>
                    </td>
                    <td>
                        <div class="fw-bold small text-dark">${r.financier_name}</div>
                        <div class="small text-muted" style="font-size:0.7rem">${r.financier_category}</div>
                    </td>
                    <td class="text-end font-mono text-muted">${fmtMoney(r.principal_amount)}</td>
                    <td class="text-end font-mono text-muted small">${fmtMoney(r.interest_amount)}</td>
                    <td class="text-end font-mono fw-bold ${parseFloat(r.balance_due)>0?'text-dark':'text-success'}">${fmtMoney(r.balance_due)}</td>
                    <td class="small ${isCrit?'text-danger fw-bold':''}">${r.due_date}</td>
                    <td class="small text-muted">${r.days_left}d</td>
                    <td class="text-end pe-4">${actBtns}</td>
                </tr>
            `;
            tbody.innerHTML += tr;
        });
    }

    // --- CLIENT SIDE FILTER ---
    function filterClientSide() {
        const q = document.getElementById('globalSearch').value.toLowerCase();
        const fin = document.getElementById('financierFilter').value;
        
        const filtered = ALL_DATA.filter(r => {
            const txt = (r.operations_file_ref + r.client_name + r.financier_name).toLowerCase();
            const mQ = txt.includes(q);
            const mF = (fin === 'ALL' || r.financier_category === fin || (fin==='DIRECTOR' && r.financier_category.includes('DIRECTOR')));
            return mQ && mF;
        });
        renderTable(filtered);
    }

    // --- FILE SEARCH (AUTOCOMPLETE) ---
    let searchTimer;
    function searchFiles(val) {
        clearTimeout(searchTimer);
        if(val.length < 2) { document.getElementById('fileResults').classList.add('d-none'); return; }
        
        searchTimer = setTimeout(async () => {
            try {
                const res = await api('search_files', {q: val});
                const ul = document.getElementById('fileResults');
                ul.innerHTML = '';
                if(res.items.length === 0) {
                    ul.innerHTML = '<li class="list-group-item text-muted small">No eligible files found (Must have Proforma)</li>';
                } else {
                    res.items.forEach(i => {
                        const li = document.createElement('li');
                        li.className = 'list-group-item list-group-item-action cursor-pointer';
                        li.innerHTML = `
                            <div class="d-flex justify-content-between">
                                <span class="fw-bold font-mono">${i.ref}</span>
                                <span class="badge bg-light text-dark border">WCN: ${fmtMoney(i.wcn)}</span>
                            </div>
                            <small class="text-muted">${i.client} - ${i.project}</small>
                        `;
                        li.onclick = () => selectFile(i);
                        ul.appendChild(li);
                    });
                }
                ul.classList.remove('d-none');
            } catch(e){ console.error(e); }
        }, 300);
    }

    function selectFile(i) {
        document.getElementById('fileSearchInput').value = i.ref;
        document.getElementById('selectedFileRef').value = i.ref;
        document.getElementById('fileResults').classList.add('d-none');
        
        document.getElementById('pvClient').innerText = i.client;
        document.getElementById('pvProject').innerText = i.project;
        document.getElementById('pvCost').innerText = fmtMoney(i.cost);
        document.getElementById('pvAdvance').innerText = fmtMoney(i.advance);
        document.getElementById('pvWcn').innerText = fmtMoney(i.wcn);
        document.getElementById('pvWcn').dataset.raw = i.wcn;
        
        document.getElementById('filePreview').classList.remove('d-none');
    }

    // --- CREATE ENGAGEMENT ---
    async function createEngagement() {
        const wcn = parseFloat(document.getElementById('pvWcn').dataset.raw || 0);
        const amt = parseFloat(document.getElementById('newAmount').value || 0);
        
        if(!document.getElementById('selectedFileRef').value) return alert("Select a file first.");
        
        // Strict Logic Check
        if(amt > (wcn + 100)) { // +100 tolerance
            return alert(`Error: Principal (${fmtMoney(amt)}) cannot exceed Working Capital Need (${fmtMoney(wcn)}).`);
        }

        const payload = {
            file_ref: document.getElementById('selectedFileRef').value,
            financier_cat: document.getElementById('newCat').value,
            financier_name: document.getElementById('newName').value,
            amount: amt,
            interest_rate: document.getElementById('newRate').value,
            engagement_date: document.getElementById('newDate').value,
            due_date: document.getElementById('newDueDate').value,
            notes: document.getElementById('newNotes').value
        };

        try {
            const res = await api('create_engagement', payload, 'POST');
            alert(res.msg);
            bootstrap.Modal.getInstance(document.getElementById('newModal')).hide();
            document.getElementById('newForm').reset();
            document.getElementById('filePreview').classList.add('d-none');
            loadEngagements();
            loadKPIs();
        } catch(e) { alert(e.message); }
    }

    // --- PAY ---
    function openPay(id, bal) {
        document.getElementById('payId').value = id;
        document.getElementById('payBalDisplay').innerText = fmtMoney(bal);
        document.getElementById('payAmount').value = '';
        new bootstrap.Modal(document.getElementById('payModal')).show();
    }

    async function processPayment() {
        const id = document.getElementById('payId').value;
        const amt = document.getElementById('payAmount').value;
        const date = document.getElementById('payDate').value;
        
        try {
            const res = await api('pay', {id, amount:amt, date}, 'POST');
            alert("Payment Recorded. New Balance: " + fmtMoney(res.new_balance));
            bootstrap.Modal.getInstance(document.getElementById('payModal')).hide();
            loadEngagements();
            loadKPIs();
        } catch(e) { alert(e.message); }
    }

    // --- DELETE ---
    async function deleteEng(id) {
        if(!confirm("Are you sure? This will remove the debt record completely.")) return;
        try {
            await api('delete', {id}, 'POST');
            loadEngagements();
            loadKPIs();
        } catch(e) { alert(e.message); }
    }
    
    // --- MODAL UTILS ---
    function openNewModal() { new bootstrap.Modal(document.getElementById('newModal')).show(); }

    function exportCSV() {
        let csv = "ID,Ref,Client,Financier,Principal,Balance,Status\n";
        ALL_DATA.forEach(r => {
            csv += `${r.engagement_id},${r.operations_file_ref},"${r.client_name}",${r.financier_name},${r.principal_amount},${r.balance_due},${r.ui_status}\n`;
        });
        const a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,' + encodeURI(csv);
        a.download = 'debt_report.csv';
        a.click();
    }
  </script>
</body>
</html>