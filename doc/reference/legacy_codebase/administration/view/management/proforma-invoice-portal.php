<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - PROFORMA INVOICE PORTAL v4.1 (Production Release)
 * ======================================================================================
 * * MODULE: Finance & Billing / Proforma Invoices
 * * AUTHOR: Smart LS IT Department
 * * DATE:   2026-01-10
 * * UPDATE: 2026-01-19 (UI/UX Optimization & Print Logic)
 * * * DESCRIPTION:
 * This module manages the lifecycle of Proforma Invoices (PIs) from creation (draft)
 * to issuance and payment tracking. It integrates with the Client Master for CRM data
 * and the Operations Registry for file references.
 * * * KEY FEATURES:
 * 1. Role-Based Access Control (RBAC):
 * - FINANCE: Create, Edit, Submit PIs.
 * - MANAGEMENT: Approve/Reject PIs.
 * - ADMIN: Full access.
 * - OPERATIONS/SALES: View only (if permitted).
 * * 2. Workflow States:
 * - DRAFT: Initial creation, editable. Auto-saved to LocalStorage.
 * - SUBMITTED: Pending management approval.
 * - APPROVED: Locked, ready for issuance.
 * - ISSUED: Sent to client (Immutable).
 * - PAID: Payment confirmed.
 * - REJECTED: Returned to draft with reason.
 * * 3. Integration Points:
 * - Quotation Intake (Import line items).
 * - Financial Dictionary (Rich Autocomplete for line codes).
 * - CRM (Client details).
 * - Operations Registry (Shipment Data).
 * * * ======================================================================================
 */

declare(strict_types=1);

// --- System Initialization ---
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// --- RBAC Enforcement ---
// Only Admin, Finance, and Management can actively manage PIs.
// Operations may have read-only access depending on specific sub-policies.
require_role(['MANAGEMENT']);

// --- Authenticated User Profile Fetching ---
// Using the authoritative session data to retrieve full employee details.
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

// Security Guard: Ensure valid session
if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

// --- Database Connection & User Profile ---
$conn = db();
$sql = "
  SELECT 
    em.employee_id,
    em.full_name,
    em.email, 
    em.department,
    em.job_title,
    ua.username,
    ua.role,
    ua.authority_capabilities,
    ua.last_login
  FROM user_auth ua
  JOIN employee_master em ON em.employee_id = ua.employee_id
  WHERE ua.user_id = ? AND em.employee_id = ?
  LIMIT 1
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
    die("Database Error: Failed to prepare user profile query.");
}
$stmt->bind_param('is', $userId, $employeeId);
$stmt->execute();
$me = $stmt->get_result()->fetch_assoc();

if (!$me) {
    // If user exists in session but not DB, force logout
    header('Location: ../../api/auth/logout.php');
    exit;
}

// --- View Helpers ---
function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

// --- User Display Data ---
$fullName  = trim((string)($me['full_name'] ?? 'User'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

// Map system roles to display labels
$role = strtoupper((string)($me['role'] ?? 'GUEST'));
$roleLabelMap = [
    'ADMIN'      => 'SYSTEM ADMIN',
    'FINANCE'    => 'FINANCE',
    'SALES'      => 'SALES',
    'OPERATIONS' => 'OPERATIONS',
    'MANAGEMENT' => 'MANAGEMENT',
    'LEAD'       => 'LEAD',
];
$roleLabel = $roleLabelMap[$role] ?? ($role !== '' ? $role : 'USER');

$jobTitle = trim((string)($me['job_title'] ?? ''));
$topRoleLabel = ($jobTitle !== '') ? strtoupper($jobTitle) : $roleLabel;

// Avatar generation
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// Time-based greeting
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

// Export variables to JS for RBAC in frontend logic
$jsUserRole = json_encode($role);
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proforma Invoice Portal | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@400;600;700;800;900&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">

  <style>
    <style>
    /* IMPORT NEW FONT (INTER) */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    /* ==========================================================================
       SMART LS DESIGN SYSTEM V2 (Unified Theme)
       ========================================================================== */
    :root {
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
    }

    body {
       font-family: 'Manrope', sans-serif;
       background: var(--brand-bg);
       color: var(--brand-text);
       font-size: 0.85rem; /* RESTORED: Compact Text */
       overflow-x: hidden;
    }

    /* --- LAYOUT: SIDEBAR & TOPBAR (Standard) --- */
    .sidebar {
      width: var(--sidebar-width);
      height: 100vh;
      position: fixed; top: 0; left: 0;
      background: #fff;
      border-right: 1px solid #e0e0e0;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      box-shadow: 2px 0 10px rgba(0,0,0,0.02);
    }
    .sidebar-header {
      height: 70px;
      display: flex;
      align-items: center;
      padding: 0 20px;
      border-bottom: 1px solid #f0f0f0;
    }
    .brand-logo {
      font-weight: 800; font-size: 1.1rem; color: var(--smart-charcoal);
      text-decoration: none; letter-spacing: -0.5px;
    }
    .sidebar-menu { overflow-y: auto; flex-grow: 1; padding: 10px 0; }

    .menu-btn {
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      padding: 12px 20px;
      font-size: 0.8rem;
      font-weight: 700;
      color: #555;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.2s;
      border-left: 3px solid transparent;
    }
    .menu-btn:hover, .menu-btn[aria-expanded="true"] {
      color: var(--smart-charcoal);
      background-color: #f0f7fa;
      border-left-color: var(--smart-charcoal);
    }
    .menu-btn i.category-icon { width: 20px; margin-right: 8px; color: #888; transition: color 0.2s; }
    .menu-btn:hover i.category-icon { color: var(--smart-charcoal); }
    .menu-chevron { font-size: 0.7rem; transition: transform 0.3s; }
    .menu-btn[aria-expanded="true"] .menu-chevron { transform: rotate(180deg); }
    
    .sub-link {
      display: block;
      padding: 8px 20px 8px 48px;
      font-size: 0.75rem;
      color: #666;
      text-decoration: none;
      font-weight: 500;
      transition: all 0.2s;
      line-height: 1.3;
    }
    .sub-link:hover { color: var(--smart-orange); background-color: #fff9f2; }
    .sub-link.active { color: var(--smart-orange); font-weight: 800; background-color: #fff9f2; }

    .sidebar-footer { border-top: 1px solid #f0f0f0; padding: 16px; }

    .main-content {
      margin-left: var(--sidebar-width);
      padding-top: 70px;
      min-height: 100vh;
      width: calc(100% - var(--sidebar-width));
    }
    
    .top-navbar {
      height: 70px;
      position: fixed;
      top: 0;
      right: 0;
      left: var(--sidebar-width);
      background: rgba(255,255,255,0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid #e0e0e0;
      z-index: 900;
      padding: 0 30px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .clock-pill {
      background: #f1f5f9;
      padding: 6px 12px;
      border-radius: 30px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--smart-dark);
    }

    /* --- COMPONENTS: CARDS & KPIS --- */
    .card-custom {
      background: white;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.05);
      box-shadow: 0 2px 12px rgba(0,0,0,0.02);
      height: 100%;
    }

    .kpi-title {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      color: #888;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .kpi-value {
      font-size: 1.6rem;
      font-weight: 800;
      color: var(--smart-charcoal);
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
    }

    /* --- COMPONENTS: TABLES --- */
    .table-custom th {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: #888;
      font-weight: 700;
      border-bottom: 2px solid #f0f0f0;
      padding: 12px;
      white-space: nowrap;
      background-color: #f8fafc;
    }
    .table-custom td {
      font-size: 0.85rem;
      vertical-align: middle;
      padding: 12px;
    }
    .table-hover tbody tr:hover {
        background-color: #f8fafc;
        cursor: pointer;
    }

    /* --- COMPONENTS: STATUS PILLS --- */
    .status-pill {
      font-size: 0.65rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 5px 10px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .status-draft { background: #e2e8f0; color: #475569; }
    .status-submitted { background: #e0f2fe; color: #0369a1; }
    .status-approved { background: #dcfce7; color: #15803d; }
    .status-issued { background: #ffedd5; color: #c2410c; }
    .status-paid { background: #231F20; color: #fff; border: 1px solid #000; }
    .status-rejected { background: #fee2e2; color: #991b1b; }

    /* --- COMPONENTS: FORMS & INPUTS --- */
    .smart-input { 
        border-radius: 6px; 
        font-size: 0.9rem; 
        padding: 0.5rem 0.7rem; 
        border: 1px solid #dee2e6;
        transition: all 0.2s ease;
    }
    .smart-input:focus { 
        border-color: var(--smart-blue); 
        box-shadow: 0 0 0 3px rgba(31,153,216,0.1); 
        outline: none;
    }
    .form-label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        color: #64748B;
        letter-spacing: 0.5px;
        margin-bottom: 0.4rem;
    }

    /* --- EDITOR OFFCANVAS --- */
    .offcanvas-header { background-color: #f8fafc; border-bottom: 1px solid #e0e0e0; }
    .offcanvas-title { font-family: 'Montserrat', sans-serif; font-weight: 700; }
    
    /* Layout for Editor */
    .editor-layout { display: flex; height: 100%; }
    .editor-sidebar {
        width: 320px;
        border-right: 1px solid #e0e0e0;
        background: #fff;
        padding: 20px;
        overflow-y: auto;
    }
    .editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #fff;
    overflow-y: auto; /* Scroll moved here */
    overflow-x: hidden;
}
    .editor-table-container { 
    flex: none; /* Don't restrict height */
    overflow: visible; /* Allow dropdown to overflow */
    padding: 25px 40px; 
}
    .editor-footer {
        background: #f8fafc;
        border-top: 1px solid #e0e0e0;
        padding: 15px 40px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 30px;
    }

    /* --- RICH EDITOR TABLE STYLING --- */
    .editor-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
    }
    .editor-table th {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--smart-dark);
        border-bottom: 2px solid var(--smart-blue);
        padding: 10px;
        background: #fff;
    }
    .editor-table td {
        padding: 8px 5px;
        border-bottom: 1px solid #f0f0f0;
        vertical-align: top;
    }
    .editor-table tr:hover td {
        background-color: #fcfcfc;
    }
    .editor-table input {
        border: 1px solid transparent;
        border-radius: 4px;
        padding: 6px;
        width: 100%;
        font-family: var(--font-ui);
        font-size: 0.9rem;
        background: transparent;
        transition: all 0.2s;
    }
    .editor-table input:focus, .editor-table input:hover {
        background: #fff;
        border-color: #ddd;
    }
    .editor-table input:focus {
        border-color: var(--smart-blue);
        box-shadow: 0 0 0 2px rgba(31,153,216,0.1);
    }
    .cell-qty input, .cell-price input, .cell-total input {
        font-family: 'Courier New', monospace;
        font-weight: 600;
    }
    .col-num { width: 40px; text-align: center; color: #ccc; font-size: 0.8rem; padding-top: 14px !important; }
    .col-code { width: 90px; }
    .col-desc { width: auto; /* Flexible width */ } 
    .col-qty { width: 70px; }
    .col-price { width: 130px; }
    .col-total { width: 130px; }
    .col-vat { width: 50px; text-align: center; padding-top: 12px !important; }
    .col-del { width: 40px; text-align: center; padding-top: 12px !important; }

    /* --- RICH AUTOCOMPLETE DROPDOWN --- */
    .autocomplete-wrapper { position: relative; width: 100%; }
    .suggestion-box {
        position: absolute;
        top: 100%;
        left: 0;
        width: 150%; /* Wider than input to show details */
        max-height: 250px;
        overflow-y: auto;
        background: white;
        border: 1px solid #dcdcdc;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        z-index: 1050;
        display: none;
    }
    .suggestion-header {
        display: grid;
        grid-template-columns: 80px 1fr 50px;
        padding: 8px 12px;
        background: #f8fafc;
        border-bottom: 1px solid #eee;
        font-size: 0.7rem;
        font-weight: 700;
        color: #888;
        text-transform: uppercase;
    }
    .suggestion-item {
        display: grid;
        grid-template-columns: 80px 1fr 50px;
        padding: 8px 12px;
        cursor: pointer;
        border-bottom: 1px solid #f9f9f9;
        font-size: 0.85rem;
    }
    .suggestion-item:hover { background-color: #f0f7fa; color: var(--smart-dark); }
    .s-code { font-family: monospace; font-weight: 600; color: var(--smart-blue); }
    .s-desc { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 10px; }
    .s-vat { text-align: center; font-size: 0.75rem; color: #aaa; }
    .s-vat.active { color: var(--smart-orange); font-weight: 700; }

    /* --- PRINT & PREVIEW STYLES --- */
    @media screen {
        .print-only { display: none !important; }
    }

    #printPreviewModal .modal-body {
        background: #525659;
        padding: 20px;
        display: flex;
        justify-content: center;
        overflow-y: auto;
    }
    #previewCanvas {
        background: #fff;
        width: 210mm;
        min-height: 297mm;
        box-shadow: 0 0 15px rgba(0,0,0,0.5);
        box-sizing: border-box;
        position: relative;
    }

    @media print {
        @page { size: A4; margin: 0; }
        body * { visibility: hidden; }
        #print-container { 
            display: block !important; 
            visibility: visible !important;
            position: absolute;
            left: 0; top: 0; width: 100%; height: 100%;
            background: #fff;
        }
        #print-container * { visibility: visible !important; }
        .sidebar, .top-navbar, .main-content, .toast-container, .modal, .offcanvas { display: none !important; }
    }

    /* --- FINAL LEGACY INVOICE DESIGN --- */
    .legacy-invoice {
        width: 100%;
        height: 100%; 
        min-height: 296mm; /* Full A4 Height */
        padding: 10mm 10mm 0 10mm; /* Zero bottom padding, footer handles it */
        box-sizing: border-box;
        font-family: var(--font-print);
        font-size: 8.5pt;
        line-height: 1.25;
        color: #000;
        display: flex;
        flex-direction: column;
    }

    /* Header */
    .legacy-header { 
        display: flex; 
        justify-content: space-between; 
        align-items: flex-start;
        padding-bottom: 10px;
        border-bottom: 3px solid var(--smart-orange);
        margin-bottom: 15px; 
    }
    .legacy-logo img { max-width: 160px; height: auto; }
    .legacy-company { text-align: right; font-size: 8pt; color: #231F20; }
    .legacy-company h1 { font-size: 11pt; font-weight: 800; margin: 0 0 3px 0; text-transform: uppercase; color: #000; letter-spacing: -0.5px; }

    /* Content Area (DOES NOT GROW - KEEPS COMPACT) */
    .invoice-content {
        flex-grow: 0; 
        display: flex;
        flex-direction: column;
    }

    /* Box Titles */
    .legacy-box-title { 
        font-size: 8pt; 
        font-weight: 700; 
        text-transform: uppercase; 
        border-bottom: 2px solid #000; 
        margin-bottom: 3px; 
        padding-bottom: 1px;
        color: #000;
    }

    /* Top Grid */
    .legacy-row { display: flex; gap: 20px; margin-bottom: 12px; }
    .legacy-col-6 { flex: 1; }
    .legacy-col-4 { width: 35%; }

    .legacy-kv-row { display: flex; margin-bottom: 2px; font-size: 8.5pt; }
    .legacy-key { font-weight: 600; width: 65px; }
    .legacy-val { flex: 1; }

    /* Shipment Details */
    .ship-grid { display: flex; font-size: 8.5pt; gap: 10px; }
    .ship-col { flex: 1; }

    /* Table */
    .legacy-table { 
        width: 100%; 
        border-collapse: collapse; 
        margin-bottom: 10px; 
        font-size: 8pt; 
        margin-top: 10px;
    }
    .legacy-table th { 
        border: 1px solid #000; 
        background: #eee; 
        padding: 4px 3px; 
        text-align: center; 
        font-weight: 700; 
        text-transform: uppercase; 
    }
    .legacy-table td { 
        border: 1px solid #000; 
        padding: 3px 3px; 
        vertical-align: middle; 
    }
    .col-code { width: 10%; text-align: left; }
    .col-desc { width: 42%; text-align: left; }
    .col-qty { width: 6%; text-align: center; }
    .col-curr { text-align: right; white-space: nowrap; }

    /* Footer Wrapper - THIS IS THE FLEX CONTAINER THAT GROWS */
    .footer-wrapper { 
        flex-grow: 1; /* Takes all remaining height */
        display: flex;
        flex-direction: column; 
        margin-top: 5px;
    }

    .footer-split { display: flex; gap: 20px; align-items: flex-start; margin-bottom: 10px; }
    
    .footer-left { flex: 1; display: flex; flex-direction: column; gap: 15px; }
    .footer-right { width: 300px; }

    /* Words Box (4-Sided Border) */
    .amount-words-box { 
        font-size: 8.5pt; 
        font-weight: 700; 
        border: 1px solid #000; 
        padding: 8px 6px; 
        text-align: center;
        background: #f9f9f9;
    }

    /* Remarks Box (4-Sided Border) */
    .remarks-box { 
        font-size: 8pt; 
        border: 1px solid #000; 
        padding: 8px;
        min-height: 80px; 
    }
    .remarks-box .legacy-box-title { border-bottom: none; margin-bottom: 5px; }
    .remarks-content { white-space: pre-wrap; line-height: 1.3; }

    /* Totals */
    .totals-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; border: 1px solid #000; }
    .totals-table td { padding: 4px; border-bottom: 1px solid #ccc; }
    .totals-table tr:last-child td { border-bottom: none; }
    .total-label { font-weight: 700; }
    .total-val { text-align: right; font-weight: 700; font-family: 'Courier New', monospace; letter-spacing: -0.5px; }
    .grand-total-row { background: #eee; border-top: 2px solid #000; }

    /* Signature */
    .sig-area { text-align: center; margin-top: 15px; }
    .sig-label { font-weight: 700; text-decoration: underline; margin-bottom: 5px; font-size: 8pt; text-transform: uppercase; }
    .sig-img { max-width: 140px; height: auto; display: block; margin: 0 auto; }

    /* THE INVISIBLE SPACER - The Spring */
    .spacer {
        flex-grow: 1;
        min-height: 20px;
    }

    /* Page Bottom */
    .page-footer { 
        padding-top: 5px;
        padding-bottom: 10mm; /* Add bottom margin here since body has 0 */
        border-top: 2px solid #EE7D04;
        font-size: 7.5pt; 
        display: flex; 
        justify-content: space-between; 
        align-items: flex-end;
        line-height: 1.3;
    }
    .page-num {
        color: #666;
        font-weight: 600;
        font-size: 7.5pt;
        margin-bottom: 2px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
</style>
</head>

<body>
<div class="toast-container" id="toastContainer"></div>
    <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index.php" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Management Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="mgmtMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt1">
                <span><i class="fa-solid fa-database category-icon"></i> MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt1" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt2">
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt2" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
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
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt3">
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt3" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt4" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt5">
                <span><i class="fa-solid fa-chart-line category-icon"></i>JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt5" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="operational-cost-reconciliation.php" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt6" class="accordion-collapse collapse show" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="proforma-invoice-portal.php" class="sub-link active">Proforma Invoice Portal</a>
                    <a href="final-invoice.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivables-ledger.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt7">
                <span><i class="fa-solid fa-folder-open category-icon"></i>HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt7" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
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
      <h5 class="mb-0 fw-bold text-dark">Proforma Portal</h5>
      <small class="text-muted" style="font-size: 0.7rem;">MANAGE ADVANCE PAYMENTS/DEPOSITS</small>
    </div>

    <div class="d-flex align-items-center gap-4">
      <div class="clock-pill">
        <span id="realtime-clock" style="font-family: monospace;">12:00:00</span>
        <button class="btn-clock" id="btn-clock" onclick="toggleClock()">
          <i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>
        </button>
      </div>

      <div class="d-flex align-items-center gap-3 ps-3 border-start">
        <div class="text-end lh-1 d-none d-md-block">
          <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
            <?php echo e($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
      </div>
    </div>
    </div>
  <div class="main-content px-4 pb-5">

    <div class="row g-3 mb-4 mt-2">
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Total Quotes (MTD)</div>
                <div class="kpi-value" id="kpi-quotes">-</div>
                <small class="text-muted" style="font-size:0.75rem;">Based on <span id="kpi-quotes-count">0</span> quotes</small>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Proforma Issued</div>
                <div class="kpi-value text-primary" id="kpi-issued">-</div>
                <small class="text-muted" style="font-size:0.75rem;">Successfully sent</small>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Conversion Rate</div>
                <div class="kpi-value text-warning" id="kpi-conversion">-%</div>
                <small class="text-muted" style="font-size:0.75rem;">Quote to PI</small>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Pending Payment</div>
                <div class="kpi-value text-danger" id="kpi-pending">-</div>
                <small class="text-muted" style="font-size:0.75rem;">Awaiting funds</small>
            </div>
        </div>
    </div>
    <div class="row py-4 align-items-center">
  <div class="col-md-6">
    <p class="text-muted mb-1" style="font-size: 22px;"><strong>PROFORMA REGISTRY</strong></p>
  </div>
      <div class="col-md-6 text-end">
        <?php if ($role === 'FINANCE' || $role === 'ADMIN'): ?>
        <button class="btn btn-dark fw-bold px-4 py-2 shadow-sm" onclick="APP.initNewProforma()">
          <i class="fa-solid fa-plus me-2"></i>New Proforma
        </button>
        <?php endif; ?>
      </div>
    </div>

    <div class="card-custom p-0 overflow-hidden">
        
        <div class="p-3 border-bottom bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="btn-group" role="group">
                <button type="button" class="btn btn-sm btn-outline-secondary fw-bold active filter-btn" data-filter="ALL" onclick="APP.filterTable('ALL')">All</button>
                <button type="button" class="btn btn-sm btn-outline-secondary fw-bold filter-btn" data-filter="DRAFT" onclick="APP.filterTable('DRAFT')">Draft</button>
                <button type="button" class="btn btn-sm btn-outline-primary fw-bold filter-btn" data-filter="SUBMITTED" onclick="APP.filterTable('SUBMITTED')">Submitted</button>
                <button type="button" class="btn btn-sm btn-outline-success fw-bold filter-btn" data-filter="APPROVED" onclick="APP.filterTable('APPROVED')">Approved</button>
                <button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold filter-btn" data-filter="ISSUED" onclick="APP.filterTable('ISSUED')">Issued</button>
            </div>

            <div class="input-group input-group-sm" style="width: 280px;">
                <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
                <input type="text" class="form-control border-start-0 ps-0 smart-input" placeholder="Search Reference, Client..." onkeyup="APP.searchTable(this.value)">
            </div>
        </div>

        <div class="table-responsive">
            <table class="table table-hover table-custom mb-0 align-middle">
                <thead class="bg-light">
                    <tr>
                        <th class="ps-4">Date</th>
                        <th>PI Reference</th>
                        <th>Linked Quote</th>
                        <th>Client / Account</th>
                        <th class="text-end">Quote Amount</th>
                        <th class="text-end">Advance Payable</th>
                        <th class="text-center">Status</th>
                        <th class="text-end pe-4">Action</th>
                    </tr>
                </thead>
                <tbody id="dataTableBody">
                    </tbody>
            </table>
            
            <div id="emptyState" class="text-center py-5 d-none">
                <i class="fa-solid fa-file-invoice fa-3x text-muted mb-3 opacity-50"></i>
                <h6 class="fw-bold text-muted">No Proformas Found</h6>
                <p class="text-muted small">Create a new proforma to get started.</p>
            </div>
            
            <div id="tableLoader" class="text-center py-5 d-none">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            </div>
        </div>
    </div>

  </div>

  <div class="offcanvas offcanvas-end" tabindex="-1" id="proformaEditor" data-bs-backdrop="static" style="width: 95vw; max-width: 1600px;">
    <div class="offcanvas-header bg-light border-bottom py-3">
        <div class="d-flex align-items-center gap-3">
            <div>
                <h5 class="offcanvas-title fw-bold mb-0" id="editorTitle">Proforma Worksheet</h5>
                <div class="d-flex align-items-center gap-2 mt-1">
                    <span class="status-pill status-draft" id="editorStatus">DRAFT</span>
                    <small class="text-muted font-monospace" id="editorRef">SLAS-PI-NEW</small>
                </div>
            </div>
        </div>
        <div id="editorActions" class="d-flex gap-2">
            <button class="btn btn-outline-secondary fw-bold btn-sm" data-bs-dismiss="offcanvas">Close</button>
        </div>
    </div>

    <div class="offcanvas-body p-0">
        <div id="unlockReasonBanner" class="d-none px-4 py-3 bg-warning bg-opacity-10 border-bottom border-warning">
    <div class="d-flex align-items-start gap-3">
        <i class="fa-solid fa-circle-exclamation text-warning fs-4 mt-1"></i>
        <div>
            <div class="fw-bold text-dark small text-uppercase">Unlock Request Pending</div>
            <div id="displayUnlockReason" class="text-muted small mt-1" style="font-style: italic;"></div>
        </div>
    </div>
</div>
        <div class="editor-layout">
            
            <div class="editor-sidebar bg-light">
                <div class="mb-4">
                    <h6 class="text-muted small fw-bold text-uppercase border-bottom pb-2 mb-3">Document Details</h6>
                    <div class="mb-3">
                        <label class="form-label">Issue Date</label>
                        <input type="date" class="form-control smart-input" id="edDate">
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Currency</label>
                        <select class="form-select smart-input" id="edCurrency">
                            <option value="XAF">XAF (BEAC)</option>
                            <option value="USD">USD ($)</option>
                            <option value="EUR">EUR (€)</option>
                        </select>
                    </div>
                    
                    <div id="divExchangeRate" class="mb-3 d-none">
                        <label class="form-label text-warning">Exchange Rate (1 <span id="lblBaseCurr">XAF</span> = ?)</label>
                        <input type="number" class="form-control smart-input border-warning" id="edExchangeRate" step="0.001">
                        <small class="text-muted" style="font-size: 0.7rem;">Enter rate to convert unit prices.</small>
                    </div>
                </div>

                <div class="mb-4">
                    <h6 class="text-muted small fw-bold text-uppercase border-bottom pb-2 mb-3">Client & Linkage</h6>
                    <div class="mb-3">
                        <label class="form-label">Import Quotation</label>
                        <select class="form-select smart-input" id="edQuoteSource">
                            <option value="">Select quotation...</option>
                        </select>
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Client Name</label>
                        <input type="text" class="form-control smart-input bg-white" id="edClient" readonly>
                    </div>
                    <div class="mb-3">
                        <label class="form-label">File Reference</label>
                        <input type="text" class="form-control smart-input bg-white font-monospace" id="edFile" readonly>
                    </div>
                </div>

                <div>
                    <h6 class="text-muted small fw-bold text-uppercase border-bottom pb-2 mb-3">Terms</h6>
                    <div class="mb-3">
                        <label class="form-label">Bank Details</label>
                        <textarea class="form-control smart-input" id="edBank" rows="4"></textarea>
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Remarks</label>
                        <textarea class="form-control smart-input" id="edRemarks" rows="3" placeholder="Payment terms..."></textarea>
                    </div>
                </div>
            </div>

            <div class="editor-main">
                <div class="editor-table-container">
                    <table class="editor-table">
                        <thead>
                            <tr>
                                <th class="col-num">#</th>
                                <th class="col-code">Code</th>
                                <th class="col-desc">Description (Item/Service)</th>
                                <th class="col-qty">Qty</th>
                                <th class="col-price text-end">Unit Price</th>
                                <th class="col-total text-end">Total HT</th>
                                <th class="col-vat">VAT</th>
                                <th class="col-del"></th>
                            </tr>
                        </thead>
                        <tbody id="editorLines">
                            </tbody>
                    </table>
                    
                    <div class="text-center mt-4">
                        <button class="btn btn-outline-dark btn-sm fw-bold border-dashed" id="btnAddLine">
                            <i class="fa-solid fa-plus me-2"></i> Add Line Item
                        </button>
                    </div>
                </div>

                <div class="editor-footer">
                    <div class="d-flex align-items-center gap-3 me-auto">
                        <div class="input-group input-group-sm" style="width: 180px;">
                            <span class="input-group-text fw-bold">Advance %</span>
                            <input type="number" class="form-control text-center fw-bold" id="edAdvancePct" value="100" min="1" max="100">
                        </div>
                    </div>

                    <div class="text-end me-4">
                        <div class="text-muted small fw-bold text-uppercase">Total HT</div>
                        <div class="font-monospace fw-bold" id="dispHT">0</div>
                    </div>
                    <div class="text-end me-4">
                        <div class="text-muted small fw-bold text-uppercase">VAT (19.25%)</div>
                        <div class="font-monospace fw-bold" id="dispVAT">0</div>
                    </div>
                    <div class="text-end me-4 border-start ps-4">
                        <div class="text-muted small fw-bold text-uppercase">Grand Total</div>
                        <div class="font-monospace fw-bold fs-5 text-dark" id="dispTTC">0</div>
                    </div>
                    <div class="text-end p-2 bg-warning bg-opacity-10 rounded border border-warning">
                        <div class="text-warning small fw-bold text-uppercase">Payable Advance</div>
                        <div class="font-monospace fw-bold fs-4 text-warning" id="dispPayable">0 XAF</div>
                    </div>
                </div>
            </div>

        </div>
    </div>
  </div>

  <div class="modal fade" id="printPreviewModal" tabindex="-1" data-bs-backdrop="static">
      <div class="modal-dialog modal-fullscreen">
          <div class="modal-content">
              <div class="modal-header bg-light py-2">
                  <div class="d-flex align-items-center gap-3">
                      <h5 class="modal-title fw-bold"><i class="fa-solid fa-print me-2"></i>Print Preview</h5>
                      <div class="btn-group btn-group-sm" role="group">
                          <input type="radio" class="btn-check" name="langOptions" id="langEn" value="en" autocomplete="off" checked onchange="APP.togglePrintLanguage('en')">
                          <label class="btn btn-outline-dark fw-bold" for="langEn">English</label>

                          <input type="radio" class="btn-check" name="langOptions" id="langFr" value="fr" autocomplete="off" onchange="APP.togglePrintLanguage('fr')">
                          <label class="btn btn-outline-dark fw-bold" for="langFr">Français</label>
                      </div>
                  </div>
                  <div>
                      <button type="button" class="btn btn-secondary btn-sm me-2" data-bs-dismiss="modal">Close</button>
                      <button type="button" class="btn btn-primary btn-sm fw-bold" onclick="APP.triggerBrowserPrint()">
                          <i class="fa-solid fa-print me-2"></i>Confirm & Print
                      </button>
                  </div>
              </div>
              <div class="modal-body">
                  <div id="previewCanvas"></div>
              </div>
          </div>
      </div>
  </div>

  <div id="print-container" style="display: none;"></div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

    <script>
        /**
         * ==================================================================================
         * SMART LS PROFORMA PORTAL v4.1 (Production)
         * - Rich Autocomplete
         * - Currency Exchange Sidebar
         * - Local Storage Backup
         * - Legacy Print Engine
         * ==================================================================================
         */

        const APP = (function() {
            'use strict';

            // Configuration
            const CONFIG = {
                API_BASE: '../../api/proforma-invoice/proforma-api.php',
                USER_ROLE: '<?php echo $role; ?>',
                VAT_RATE: 0.1925,
                DEFAULT_BANK: `Bank: AFRILAND FIRST BANK
                    Account Name: SMART LOGISTICS AND SERVICES LTD
                    Account Number: 10005-0006-107018411001-93
                    Swift Code: CCEICRBA
                    IBAN: CM21-1000-5000-6107-0184-1100-1-93`,
                STORAGE_KEY: 'smart_pi_draft_v1'
            };

            // State Management
            let state = {
                proformas: [],
                quotes: [],
                currentFilter: 'ALL',
                currentSearch: '',
                currentProforma: null,
                previousCurrency: 'XAF',
                bsOffcanvas: null,
                printData: null,
                currentLang: 'en'
            };
            
            setLoading: (btnId, isLoading) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    
    if (isLoading) {
        btn.dataset.originalHtml = btn.innerHTML; // Save original text
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-2"></i>Processing...';
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.originalHtml;
    }
}

            // Utility Functions
            const utils = {
                // --- NEW FUNCTION START ---
                setLoading: (btnId, isLoading) => {
                    const btn = document.getElementById(btnId);
                    if (!btn) return;
                    
                    if (isLoading) {
                        // Save original text if not already saved
                        if (!btn.dataset.originalHtml) {
                            btn.dataset.originalHtml = btn.innerHTML;
                        }
                        btn.disabled = true;
                        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-2"></i>Processing...';
                    } else {
                        btn.disabled = false;
                        // Restore original text
                        if (btn.dataset.originalHtml) {
                            btn.innerHTML = btn.dataset.originalHtml;
                        }
                    }
                },
                // --- NEW FUNCTION END ---

                formatNumber: (n) => new Intl.NumberFormat('en-US').format(Math.round(n)),
                parseNumber: (s) => parseFloat(String(s).replace(/,/g, '')) || 0,
                
                showToast: (title, message, type = 'success') => {
                    const container = document.getElementById('toastContainer');
                    const toast = document.createElement('div');
                    toast.className = `toast ${type}`;
                    toast.innerHTML = `
                        <div class="toast-icon">
                            <i class="fa-solid fa-${type === 'success' ? 'check' : 'exclamation'}"></i>
                        </div>
                        <div class="toast-content">
                            <div class="toast-title">${title}</div>
                            <div class="toast-message">${message}</div>
                        </div>
                    `;
                    container.appendChild(toast);
                    setTimeout(() => toast.remove(), 5000);
                },

                showLoader: (show = true) => {
                    const loader = document.getElementById('tableLoader');
                    if (loader) {
                        loader.style.display = show ? 'flex' : 'none';
                    }
                },

                getStatusClass: (status) => {
                    const map = {
                        'DRAFT': 'status-draft',
                        'SUBMITTED': 'status-submitted',
                        'APPROVED': 'status-approved',
                        'ISSUED': 'status-issued',
                        'PAID': 'status-paid',
                        'REJECTED': 'status-rejected',
                        'UNLOCK_REQUESTED': 'status-warning' // Ensure this exists for the yellow badge
                    };
                    return map[status] || 'status-draft';
                }
            };

            // API Communication
            const api = {
                async call(action, data = null, method = 'GET') {
    try {
        // PATCH: Add timestamp (_t) to force fresh data every time
        const ts = new Date().getTime();
        
        let url = `${CONFIG.API_BASE}?action=${action}&_t=${ts}`;
        
        if (method === 'GET' && data) {
            url += `&${new URLSearchParams(data).toString()}`;
        }

        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (method === 'POST' && data) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(url, options);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'API request failed');
        }

        return result;
    } catch (error) {
        console.error('API Error:', error);
        utils.showToast('Error', error.message, 'error');
        throw error;
    }
},

                getProformas: () => api.call('get_all_proformas'),
                getQuotations: () => api.call('get_quotations_dropdown'),
                getQuoteDetails: (quoteRef) => api.call('get_quotation_prefill', { quote_ref: quoteRef }),
                searchDictionary: (query) => api.call('search_dictionary', { q: query }),
                getKPIs: () => api.call('get_kpis'),
                getProformaDetail: (invoiceId) => api.call('get_proforma_detail', { invoice_id: invoiceId }),
                saveProforma: (data) => api.call('save_proforma', data, 'POST'),
                submitForApproval: (invoiceId) => api.call('submit_for_approval', { invoice_id: invoiceId }, 'POST'),
                approveProforma: (invoiceId) => api.call('approve_proforma', { invoice_id: invoiceId }, 'POST'),
                rejectProforma: (invoiceId, reason) => api.call('reject_proforma', { invoice_id: invoiceId, reason }, 'POST'),
                issueProforma: (invoiceId) => api.call('issue_proforma', { invoice_id: invoiceId }, 'POST')
            };

            // Dashboard Functions
            async function loadDashboard() {
                utils.showLoader(true);
                
                try {
                    const [proformasRes, kpisRes] = await Promise.all([
                        api.getProformas(),
                        api.getKPIs()
                    ]);

                    state.proformas = proformasRes.proformas || [];

                    renderKPIs(kpisRes.kpis);
                    renderTable();
                } catch (error) {
                    console.error('Dashboard load error:', error);
                } finally {
                    utils.showLoader(false);
                }
            }

            function renderKPIs(kpis) {
                document.getElementById('kpi-quotes').textContent = utils.formatNumber(kpis.total_proformas_value || 0);
                document.getElementById('kpi-quotes-count').textContent = kpis.total_proformas_mtd || 0;
                document.getElementById('kpi-issued').textContent = utils.formatNumber(kpis.total_issued_amount || 0);
                document.getElementById('kpi-conversion').textContent = (kpis.conversion_rate || 0) + '%';
                document.getElementById('kpi-pending').textContent = kpis.pending_payments || 0;
            }

            function renderTable() {
                
                const tbody = document.getElementById('dataTableBody');
                const emptyState = document.getElementById('emptyState');
                
                let filtered = state.proformas;

                // Apply filter
                if (state.currentFilter !== 'ALL') {
                    filtered = filtered.filter(p => p.workflow_status === state.currentFilter);
                }

                // Apply search
                if (state.currentSearch) {
                    const search = state.currentSearch.toLowerCase();
                    filtered = filtered.filter(p => 
                        p.invoice_no.toLowerCase().includes(search) ||
                        p.client_name.toLowerCase().includes(search) ||
                        (p.file_reference && p.file_reference.toLowerCase().includes(search))
                    );
                }

                if (filtered.length === 0) {
                    tbody.innerHTML = '';
                    emptyState.classList.remove('hidden');
                    return;
                }

                emptyState.classList.add('hidden');
                
                tbody.innerHTML = filtered.map(p => `
                    <tr onclick="APP.openEditor('${p.invoice_no}')">
                        <td class="cell-mono cell-muted">${p.issue_date}</td>
                        <td class="cell-mono cell-primary">${p.invoice_no}</td>
                        <td class="cell-muted">${p.linked_quote_ref || '—'}</td>
                        <td class="cell-bold">${p.client_name}</td>
                        <td class="text-end cell-mono">${utils.formatNumber(p.total || 0)}</td>
                        <td class="text-end cell-mono cell-bold">${utils.formatNumber(p.payable_advance)}</td>
                        <td class="text-center">
                            <span class="status-badge ${utils.getStatusClass(p.workflow_status)}">${p.workflow_status}</span>
                        </td>
                        <td class="text-end">
                            ${getActionIcon(p.workflow_status)}
                        </td>
                    </tr>
                `).join('');
            }

            function getActionIcon(status) {
    // 1. PRIORITY: If an unlock is pending, show the Key
    if (status === 'UNLOCK_REQUESTED') {
        return '<i class="fa-solid fa-key text-warning" title="Unlock Requested"></i>';
    }
    
    // 2. Standard icons
    if (status === 'ISSUED') return '<i class="fa-solid fa-download text-primary"></i>';
    if (status === 'SUBMITTED') return '<i class="fa-solid fa-clock text-info"></i>';
    if (status === 'DRAFT') return '<i class="fa-solid fa-pen text-muted"></i>';
    
    return '<i class="fa-solid fa-eye text-muted"></i>';
}

            function filterTable(filter) {
                state.currentFilter = filter;
                
                // Update UI
                document.querySelectorAll('.filter-chip').forEach(chip => {
                    chip.classList.toggle('active', chip.textContent.includes(filter === 'ALL' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase()));
                });
                
                renderTable();
            }

            function searchTable(query) {
                state.currentSearch = query;
                renderTable();
            }

            // Editor Functions
            async function initNewProforma() {
                if (CONFIG.USER_ROLE !== 'FINANCE' && CONFIG.USER_ROLE !== 'ADMIN') {
                    utils.showToast('Access Denied', 'Only Finance can create proformas', 'error');
                    return;
                }

                // CHECK FOR LOCAL DRAFT
                const savedDraft = localStorage.getItem(CONFIG.STORAGE_KEY);
                if (savedDraft) {
                    if (confirm('A saved draft was found from a previous session. Would you like to restore it?')) {
                        state.currentProforma = JSON.parse(savedDraft);
                    } else {
                        localStorage.removeItem(CONFIG.STORAGE_KEY);
                        createNewState();
                    }
                } else {
                    createNewState();
                }
                
                state.previousCurrency = state.currentProforma.currency || 'XAF';

                // Load quotations
                const quotesRes = await api.getQuotations();
                state.quotes = quotesRes.quotations || [];
                
                populateEditor();
                state.bsOffcanvas.show();
            }

            function createNewState() {
                state.currentProforma = {
                    status: 'DRAFT',
                    date: new Date().toISOString().split('T')[0],
                    currency: 'XAF',
                    pct: 100,
                    lines: [],
                    bank: CONFIG.DEFAULT_BANK,
                    remarks: ''
                };
            }

            async function openEditor(invoiceNo) {
                try {
                    // Find invoice_id from the list
                    const proforma = state.proformas.find(p => p.invoice_no === invoiceNo);
                    if (!proforma) return;

                    // Fetch full details from API
                    const detailRes = await api.getProformaDetail(proforma.invoice_id);
                    state.currentProforma = detailRes.proforma;
                    state.previousCurrency = state.currentProforma.currency;

                    populateEditor();
                    state.bsOffcanvas.show();
                } catch (error) {
                    console.error('Error loading proforma:', error);
                }
            }

            function populateEditor() {
    const p = state.currentProforma;
    const wfStatus = p.workflow_status || p.status || 'DRAFT';

const banner = document.getElementById('unlockReasonBanner');
const reasonText = document.getElementById('displayUnlockReason');
const bannerIcon = banner.querySelector('i');

if (wfStatus === 'REJECTED') {
    banner.classList.remove('d-none', 'bg-warning', 'border-warning');
    banner.classList.add('bg-danger', 'border-danger', 'text-white'); // Red Style
    bannerIcon.className = 'fa-solid fa-circle-xmark fs-4 mt-1';
    
    reasonText.innerHTML = `<strong>REJECTED:</strong> ${p.rejection_reason || 'Please correct errors.'}`;
} 
else if (wfStatus === 'UNLOCK_REQUESTED') {
    banner.classList.remove('d-none', 'bg-danger', 'border-danger', 'text-white');
    banner.classList.add('bg-warning', 'border-warning'); // Yellow Style
    bannerIcon.className = 'fa-solid fa-key text-warning fs-4 mt-1';
    
    reasonText.textContent = `Unlock Requested: "${p.unlock_reason}"`;
} 
else {
    banner.classList.add('d-none');
}

    // 1. UI Header
    document.getElementById('editorTitle').textContent = p.invoice_id ? 'Edit Proforma' : 'New Proforma';
    document.getElementById('editorStatus').textContent = wfStatus;
    document.getElementById('editorStatus').className = `status-pill ${utils.getStatusClass(wfStatus)}`;
    document.getElementById('editorRef').textContent = p.invoice_no || 'NEW';

    // 2. Lock Logic: Fields are editable ONLY if status is DRAFT
    const isEditable = (wfStatus === 'DRAFT');
    
    document.querySelectorAll('.editor-sidebar input, .editor-sidebar textarea, .editor-sidebar select, .editor-main input').forEach(el => {
        // Always lock the Quote Source dropdown in edit mode to prevent breaking links
        if (el.id === 'edQuoteSource') {
            el.disabled = !!p.invoice_id; 
        } else {
            el.disabled = !isEditable;
        }
    });

    // 3. Fix Disappearing Quote in Dropdown
    const quoteSelect = document.getElementById('edQuoteSource');
    if (p.invoice_id) {
        // If editing, force the current quote to appear as the selected option
        const currentRef = p.linked_quote_ref || "Manual Entry";
        quoteSelect.innerHTML = `<option value="${p.linked_quote_ref || ''}" selected>${currentRef}</option>`;
    } else {
        // If new, show the list from the database
        quoteSelect.innerHTML = '<option value="">Select quotation...</option>' + 
            state.quotes.map(q => `<option value="${q.simulation_ref}">${q.display_text}</option>`).join('');
        quoteSelect.disabled = false;
    }

    // 4. Show/Hide Add Line Button
    document.getElementById('btnAddLine').style.display = isEditable ? 'inline-flex' : 'none';

    // 5. Fill Inputs
    document.getElementById('edDate').value = p.issue_date || new Date().toISOString().split('T')[0];
    document.getElementById('edCurrency').value = p.currency || 'XAF';
    document.getElementById('edClient').value = p.client_name || '';
    document.getElementById('edFile').value = p.file_reference || '';
    document.getElementById('edBank').value = p.bank_details || CONFIG.DEFAULT_BANK;
    document.getElementById('edRemarks').value = p.remarks || '';
    document.getElementById('edAdvancePct').value = p.advance_percentage || 100;

    renderLines();
    renderEditorActions();
}

            async function importQuote() {
                const quoteRef = document.getElementById('edQuoteSource').value;
                if (!quoteRef) return;

                try {
                    // Get prefill data from API
                    const prefillRes = await api.getQuoteDetails(quoteRef);
                    const prefill = prefillRes.prefill;

                    // Update state
                    state.currentProforma.linked_quote_ref = prefill.simulation_ref;
                    state.currentProforma.client_name = prefill.client_name;
                    state.currentProforma.file_reference = prefill.file_reference;
                    state.currentProforma.bank_details = prefill.bank_details;
                    state.currentProforma.payment_terms = prefill.payment_terms;
                    state.currentProforma.currency = prefill.currency;
                    state.currentProforma.lines = prefill.lines.map(line => ({
                        code: line.code,
                        description: line.description || line.item_description || line.desc || '',
                        qty: Number(line.qty ?? 1),
                        unit_price: Number(line.unit_price ?? 0),
                        vat_applicable: line.vat_applicable ?? true,
                        vat_rate: line.vat_rate ?? 0.1925,
                        source_quote_line_id: line.source_quote_line_id ?? null,
                        is_ad_hoc: false
                    }));


                    // Update form fields
                    document.getElementById('edClient').value = prefill.client_name;
                    document.getElementById('edFile').value = prefill.file_reference;
                    document.getElementById('edBank').value = prefill.bank_details;
                    document.getElementById('edCurrency').value = prefill.currency;

                    renderLines();
                    utils.showToast('Success', 'Quotation imported successfully', 'success');
                    saveLocalDraft();
                } catch (error) {
                    console.error('Import error:', error);
                    utils.showToast('Error', 'Failed to import quotation', 'error');
                }
            }

            function renderLines() {
                const tbody = document.getElementById('editorLines');
                const lines = state.currentProforma.lines || [];
                const isLocked = ['SUBMITTED', 'APPROVED', 'ISSUED', 'PAID', 'UNLOCK_REQUESTED'].includes(state.currentProforma.workflow_status);

                tbody.innerHTML = lines.map((line, idx) => {
                    const unit = line.unit_price || line.unit || 0;
                    const ht = line.qty * unit;
                    const vatChecked = line.vat_applicable || line.vat || false;
                    return `
                        <tr>
                            <td class="col-num">${idx + 1}</td>
                            <td class="col-code"><input type="text" class="font-mono text-center" value="${line.code}" onchange="APP.updateLine(${idx}, 'code', this.value)" ${isLocked ? 'disabled' : ''} placeholder="Code"></td>
                            <td class="col-desc">
                                <div class="autocomplete-wrapper">
                                    <input type="text" 
                                           value="${line.description || line.desc || ''}" 
                                           onchange="APP.updateLine(${idx}, 'description', this.value)"
                                           oninput="APP.searchDictionaryForLine(${idx}, this.value)"
                                           ${isLocked ? 'disabled' : ''} 
                                           placeholder="Search Description..."
                                           autocomplete="off">
                                    <div id="suggestion-box-${idx}" class="suggestion-box"></div>
                                </div>
                            </td>
                            <td class="cell-qty"><input type="number" value="${line.qty}" onchange="APP.updateLine(${idx}, 'qty', this.value)" style="text-align: center;" ${isLocked ? 'disabled' : ''}></td>
                            <td class="cell-price"><input type="text" value="${utils.formatNumber(unit)}" onchange="APP.updateLine(${idx}, 'unit_price', this.value)" style="text-align: right;" ${isLocked ? 'disabled' : ''}></td>
                            <td class="cell-total"><input type="text" value="${utils.formatNumber(ht)}" disabled style="text-align: right; background: #fafafa;"></td>
                            <td class="col-vat"><input type="checkbox" ${vatChecked ? 'checked' : ''} onchange="APP.updateLine(${idx}, 'vat_applicable', this.checked)" ${isLocked ? 'disabled' : ''}></td>
                            <td class="col-del">${!isLocked ? `<i class="fa-solid fa-trash text-danger" style="cursor: pointer;" onclick="APP.deleteLine(${idx})"></i>` : ''}</td>
                        </tr>
                    `;
                }).join('');

                calculateTotals();
            }

            // RICH DICTIONARY SEARCH
            let searchTimeout = null;
            async function searchDictionaryForLine(lineIdx, query) {
                const box = document.getElementById(`suggestion-box-${lineIdx}`);
                if (!query || query.length < 2) {
                    box.style.display = 'none';
                    return;
                }

                if (searchTimeout) clearTimeout(searchTimeout);

                searchTimeout = setTimeout(async () => {
                    try {
                        const result = await api.searchDictionary(query);
                        
                        if (result.items && result.items.length > 0) {
                            box.innerHTML = `
    <div class="suggestion-header">
        <div>CODE</div><div>DESCRIPTION</div><div class="text-center">VAT</div>
    </div>
` + result.items.map(item => {
    // Escape single quotes for the onclick handler
    const safeDesc = item.description.replace(/'/g, "\\'");
    return `
        <div class="suggestion-item" onmousedown="APP.selectDictionaryItem(${lineIdx}, '${item.code}', '${safeDesc}', ${item.vat_applicable})">
            <div class="s-code">${item.code}</div>
            <div class="s-desc">${item.description}</div>
            <div class="s-vat ${item.vat_applicable ? 'active' : ''}">${item.vat_applicable ? 'YES' : 'NO'}</div>
        </div>
    `;
}).join('');
                            box.style.display = 'block';
                        } else {
                            box.style.display = 'none';
                        }
                    } catch (error) {
                        console.error('Dictionary search error:', error);
                    }
                }, 300);
            }

            function selectDictionaryItem(lineIdx, code, desc, vat) {
    // Use setTimeout to ensure this runs AFTER the input's onchange/blur event
    setTimeout(() => {
        state.currentProforma.lines[lineIdx].code = code;
        state.currentProforma.lines[lineIdx].description = desc;
        state.currentProforma.lines[lineIdx].vat_applicable = Boolean(vat);
        
        // Hide box
        const box = document.getElementById(`suggestion-box-${lineIdx}`);
        if(box) box.style.display = 'none';
        
        renderLines();
        saveLocalDraft();
    }, 100);
}

            function updateLine(idx, field, value) {
                if (field === 'qty') value = parseFloat(value) || 0;
                if (field === 'unit') value = utils.parseNumber(value);
                state.currentProforma.lines[idx][field] = value;
                renderLines();
                saveLocalDraft();
            }

            function addNewLine() {
                state.currentProforma.lines.push({
                    code: '',  
                    description: '', 
                    qty: 1,
                    unit_price: 0,
                    vat_applicable: true,
                    vat_rate: 0.1925,
                    is_ad_hoc: true
                });
                renderLines();
                saveLocalDraft();
            }

            function deleteLine(idx) {
                state.currentProforma.lines.splice(idx, 1);
                renderLines();
                saveLocalDraft();
            }

            function saveLocalDraft() {
                if (state.currentProforma && !state.currentProforma.invoice_id) {
                    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.currentProforma));
                }
            }

            function calculateTotals() {
                let totalHT = 0;
                let totalVAT = 0;

                state.currentProforma.lines.forEach(line => {
                    const unitPrice = line.unit_price || line.unit || 0;
                    const ht = line.qty * unitPrice;
                    const vatApplicable = line.vat_applicable || line.vat || false;
                    const vatRate = line.vat_rate || CONFIG.VAT_RATE;
                    const vat = vatApplicable ? ht * vatRate : 0;
                    totalHT += ht;
                    totalVAT += vat;
                });

                const totalTTC = totalHT + totalVAT;
                const pct = parseFloat(document.getElementById('edAdvancePct').value) || 100;
                const payable = Math.round(totalTTC * (pct / 100));

                state.currentProforma.subtotal = totalHT;
                state.currentProforma.vat = totalVAT;
                state.currentProforma.total = totalTTC;
                state.currentProforma.payable_advance = payable;
                state.currentProforma.advance_percentage = pct;

                document.getElementById('dispHT').textContent = utils.formatNumber(totalHT);
                document.getElementById('dispVAT').textContent = utils.formatNumber(totalVAT);
                document.getElementById('dispTTC').textContent = utils.formatNumber(totalTTC);
                document.getElementById('dispPayable').textContent = utils.formatNumber(payable) + ' ' + (state.currentProforma.currency || 'XAF');
            }

            function renderEditorActions() {
    const container = document.getElementById('editorActions');
    const p = state.currentProforma;
    const wfStatus = p.workflow_status || 'DRAFT';
    const userRole = (CONFIG.USER_ROLE || '').trim().toUpperCase();
    
    let html = '<button class="btn btn-secondary btn-sm" data-bs-dismiss="offcanvas">Close</button>';

    // --- STATE 1: DRAFT ---
    if (wfStatus === 'DRAFT') {
        if (userRole === 'FINANCE' || userRole === 'ADMIN') {
            html += `<button id="btnSaveDraft" class="btn btn-secondary btn-sm ms-2" onclick="APP.saveProforma('DRAFT')">Save Draft</button>
                     <button id="btnSubmit" class="btn btn-primary btn-sm ms-2" onclick="APP.saveProforma('SUBMIT')">Submit for Approval</button>`;
        }
    } 
    // --- STATE 2: SUBMITTED ---
    else if (wfStatus === 'SUBMITTED') {
        if (userRole === 'MANAGEMENT' || userRole === 'ADMIN') {
            html += `<button id="btnReject" class="btn btn-danger btn-sm ms-2" onclick="APP.rejectProforma()">Reject</button>
                     <button id="btnApprove" class="btn btn-success btn-sm ms-2" onclick="APP.approveProforma()">Approve</button>`;
        } else {
            html += `<span class="badge bg-primary ms-2">Pending Approval</span>`;
        }
    } 
    // --- STATE 3: UNLOCK REQUESTED ---
    else if (wfStatus === 'UNLOCK_REQUESTED') {
        if (userRole === 'MANAGEMENT') {
            html += `<button id="btnConfirmUnlock" class="btn btn-warning btn-sm fw-bold ms-2" onclick="APP.approveUnlock()">
                        <i class="fa-solid fa-lock-open me-2"></i>Confirm Unlock
                     </button>`;
        } else {
            html += `<span class="badge bg-warning text-dark ms-2 p-2"><i class="fa-solid fa-hourglass"></i> Waiting for Management</span>`;
        }
    } 
    // --- STATE 4: LOCKED STATES ---
    else if (['APPROVED', 'ISSUED', 'ISSUED_LOCKED', 'PAID'].includes(wfStatus)) {
        // Issue Button (Triggers Modal)
        if (wfStatus === 'APPROVED' && (userRole === 'FINANCE' || userRole === 'ADMIN')) {
            html += `<button id="btnIssue" class="btn btn-primary btn-sm ms-2" onclick="APP.issueProforma()">Issue & Lock</button>`;
        } else {
            html += `<button class="btn btn-dark btn-sm ms-2" onclick="APP.printProforma()"><i class="fa-solid fa-print"></i> Print</button>`;
        }

        // Request Edit Button
        const isPaid = parseFloat(p.total_paid_percentage) > 0;
        if (!isPaid && (userRole === 'FINANCE' || userRole === 'ADMIN')) {
            html += `<button class="btn btn-outline-danger btn-sm ms-2" onclick="APP.requestUnlock()">
                        <i class="fa-solid fa-key"></i> Request Edit
                     </button>`;
        }
    }

    container.innerHTML = html;
}

            // Workflow Functions
            async function saveProforma(action) {
    // 1. Determine which button to lock based on the action
    // (Make sure your HTML buttons actually have these IDs! See the note below)
    const btnId = (action === 'SUBMIT') ? 'btnSubmit' : 'btnSaveDraft';
    
    // 2. Start Loading
    utils.setLoading(btnId, true);
    
    try {
        const p = state.currentProforma;
        
        const data = {
            invoice_id: p.invoice_id,
            issue_date: document.getElementById('edDate').value,
            currency: document.getElementById('edCurrency').value,
            client_name: p.client_name,
            file_reference: document.getElementById('edFile').value,
            linked_quote_ref: p.linked_quote_ref,
            advance_percentage: parseInt(document.getElementById('edAdvancePct').value),
            bank_details: document.getElementById('edBank').value,
            remarks: document.getElementById('edRemarks').value,
            lines: p.lines.map(line => ({
                code: line.code,
                description: line.description || line.desc || '',
                qty: parseFloat(line.qty),
                unit_price: parseFloat(line.unit_price || line.unit || 0),
                vat_applicable: line.vat_applicable || line.vat || false,
                vat_rate: line.vat_rate || 0.1925,
                remarks: line.remarks || '',
                is_ad_hoc: line.is_ad_hoc || false,
                source_quote_line_id: line.source_quote_line_id || null
            }))
        };

        const result = await api.saveProforma(data);
        
        if (action === 'SUBMIT') {
            await api.submitForApproval(result.invoice_id);
        }

        utils.showToast('Success', 'Proforma saved successfully', 'success');
        localStorage.removeItem(CONFIG.STORAGE_KEY); // Clear draft
        state.bsOffcanvas.hide();
        loadDashboard();

    } catch (error) {
        console.error('Save error:', error);
        // Improved: actually show the error to the user
        utils.showToast('Error', error.message || 'Failed to save', 'error');
    } finally {
        // 3. Stop Loading (This guarantees the button unlocks)
        utils.setLoading(btnId, false);
    }
}

            async function approveProforma() {
    if (!confirm('Approve this proforma? This will lock it from further editing.')) return;

    utils.setLoading('btnApprove', true); // <--- START LOADING

    try {
        await api.approveProforma(state.currentProforma.invoice_id);
        utils.showToast('Success', 'Proforma approved', 'success');
        state.bsOffcanvas.hide();
        loadDashboard();
    } catch (error) {
        console.error('Approve error:', error);
        utils.showToast('Error', error.message, 'error');
    } finally {
        utils.setLoading('btnApprove', false); // <--- STOP LOADING
    }
}

            async function rejectProforma() {
    const reason = prompt('Rejection reason:');
    if (!reason) return;

    utils.setLoading('btnReject', true); // <--- START LOADING

    try {
        await api.rejectProforma(state.currentProforma.invoice_id, reason);
        utils.showToast('Success', 'Proforma rejected', 'success');
        state.bsOffcanvas.hide();
        loadDashboard();
    } catch (error) {
        console.error('Reject error:', error);
        utils.showToast('Error', error.message, 'error');
    } finally {
        utils.setLoading('btnReject', false); // <--- STOP LOADING
    }
}

            // 1. Open the Modal instead of calling API directly
function issueProforma() {
    const modal = new bootstrap.Modal(document.getElementById('issueModal'));
    modal.show();
}

// 2. The Actual API Call (triggered by modal buttons)
async function confirmIssue(mode) {
    const modalEl = document.getElementById('issueModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    
    try {
        await api.call('issue_proforma', { 
            invoice_id: state.currentProforma.invoice_id,
            signature_mode: mode 
        }, 'POST');
        
        utils.showToast('Success', 'Issued with ' + mode + ' signature');
        modal.hide();
        state.bsOffcanvas.hide();
        loadDashboard();
    } catch (e) {
        console.error(e);
    }
}
            
            function requestUnlock() {
    // 1. Guard against PAID invoices
    const paidAmount = parseFloat(state.currentProforma.total_amount_paid_xaf) || 0;
    if (paidAmount > 0) {
        utils.showToast('Error', 'Cannot unlock a PAID invoice. Void payments first.', 'error');
        return;
    }

    // 2. Locate the Modal Element
    const modalEl = document.getElementById('unlockModal');
    if (!modalEl) {
        console.error("CRITICAL: #unlockModal not found in HTML. Check if you pasted it at the bottom.");
        utils.showToast('Error', 'System Error: Modal missing.', 'error');
        return;
    }

    // 3. Reset the UI inside the modal
    document.getElementById('txtUnlockReason').value = '';
    document.getElementById('btnSubmitUnlock').disabled = true;
    const charCount = document.getElementById('charCount');
    if (charCount) {
        charCount.textContent = '0';
        charCount.className = 'fw-bold text-danger';
    }

    // 4. Show the Modal (Using the safe Bootstrap constructor)
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

async function approveUnlock() {
    if (!confirm("Unlock this invoice? It will revert to DRAFT.")) return;
    
    utils.setLoading('btnConfirmUnlock', true); // <--- START LOADING

    try {
        await api.call('approve_unlock', { invoice_id: state.currentProforma.invoice_id }, 'POST');
        utils.showToast('Success', 'Invoice unlocked to Draft');
        state.bsOffcanvas.hide();
        loadDashboard();
    } catch (e) { 
        console.error(e);
        utils.showToast('Error', e.message, 'error');
    } finally {
        utils.setLoading('btnConfirmUnlock', false); // <--- STOP LOADING
    }
}
        
        async function submitUnlockRequest() {
    const reasonField = document.getElementById('txtUnlockReason');
    const reason = reasonField ? reasonField.value.trim() : '';
    
    if (reason.length < 5) {
        utils.showToast('Error', 'Reason must be at least 5 characters.', 'error');
        return;
    }

    utils.setLoading('btnSubmitUnlock', true); // <--- START LOADING

    try {
        const res = await api.call('request_unlock', { 
            invoice_id: state.currentProforma.invoice_id, 
            reason: reason 
        }, 'POST');
        
        if (res.success) {
            utils.showToast('Success', 'Unlock request sent to Management');
            
            // Close modal
            const modalEl = document.getElementById('unlockModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            // Refresh UI
            state.currentProforma.workflow_status = 'UNLOCK_REQUESTED';
            state.currentProforma.unlock_reason = reason;
            populateEditor();
            loadDashboard(); 
        }
    } catch (e) { 
        utils.showToast('Error', e.message, 'error'); 
    } finally {
        utils.setLoading('btnSubmitUnlock', false); // <--- STOP LOADING
    }
}

            function init() {
    // A. Standard Initialization
    const offcanvasEl = document.getElementById('proformaEditor');
    if (offcanvasEl) state.bsOffcanvas = new bootstrap.Offcanvas(offcanvasEl);

    // B. SAFE MODAL VALIDATION
    const reasonInput = document.getElementById('txtUnlockReason');
    const submitBtn = document.getElementById('btnSubmitUnlock');
    const charCount = document.getElementById('charCount');

    if (reasonInput && submitBtn) {
        // This makes the button clickable ONLY after 5 characters
        reasonInput.addEventListener('input', function() {
            const len = this.value.trim().length;
            if (charCount) charCount.textContent = len;
            
            if (len >= 5) {
                submitBtn.disabled = false;
                if (charCount) charCount.className = "fw-bold text-success";
            } else {
                submitBtn.disabled = true;
                if (charCount) charCount.className = "fw-bold text-danger";
            }
        });
    }

    // C. Event Listeners
    document.getElementById('edQuoteSource')?.addEventListener('change', importQuote);
    document.getElementById('btnAddLine')?.addEventListener('click', addNewLine);
    document.getElementById('edAdvancePct')?.addEventListener('input', calculateTotals);
    document.getElementById('edCurrency')?.addEventListener('change', handleCurrencyChange);
    document.getElementById('edExchangeRate')?.addEventListener('change', applyExchangeRate);

    // D. Load Dashboard
    loadDashboard();
}

            function handleCurrencyChange(e) {
                const newCurr = e.target.value;
                const prevCurr = state.previousCurrency;
                const rateDiv = document.getElementById('divExchangeRate');
                const lblBase = document.getElementById('lblBaseCurr');

                if (newCurr === prevCurr) {
                    rateDiv.classList.add('d-none');
                    return;
                }

                // Show the Input instead of prompt
                lblBase.textContent = prevCurr;
                rateDiv.classList.remove('d-none');
                document.getElementById('edExchangeRate').focus();
            }

            function applyExchangeRate() {
                const rate = parseFloat(document.getElementById('edExchangeRate').value);
                const prevCurr = state.previousCurrency;
                const newCurr = document.getElementById('edCurrency').value;

                if (!rate || isNaN(rate)) return;

                let isDivisor = false;
                // Heuristic: If converting XAF -> USD (Rate is usually ~600), we divide XAF by 600
                if (prevCurr === 'XAF' && (newCurr === 'EUR' || newCurr === 'USD')) {
                    isDivisor = true; 
                } 
                // If converting USD -> XAF, we multiply

                state.currentProforma.lines.forEach(line => {
                    line.unit_price = isDivisor ? (line.unit_price / rate) : (line.unit_price * rate);
                    line.unit = line.unit_price; // Sync
                });

                state.currentProforma.currency = newCurr;
                state.previousCurrency = newCurr;
                document.getElementById('divExchangeRate').classList.add('d-none');
                renderLines();
                saveLocalDraft();
            }
            

            // --- PRINTING LOGIC (LEGACY) ---

            async function printProforma() {
                state.currentLang = 'en'; // Reset default
                document.getElementById('langEn').checked = true;
                
                // Show Modal
                const modalEl = document.getElementById('printPreviewModal');
                const modal = new bootstrap.Modal(modalEl);
                modal.show();

                // Fetch and Render
                await loadPrintPreview(state.currentProforma.invoice_id, 'en');
            }

            async function loadPrintPreview(invoiceId, lang) {
                const canvas = document.getElementById('previewCanvas');
                canvas.innerHTML = '<div class="text-center py-5">Loading Preview...</div>';

                try {
                    const response = await api.call('get_print_payload', { invoice_id: invoiceId, lang: lang });
                    if (!response.success) throw new Error(response.error);
                    
                    state.printData = response;
                    const html = generateLegacyHTML(response);
                    
                    canvas.innerHTML = html; // Render in Modal
                    document.getElementById('print-container').innerHTML = html; // Render for Print
                    
                } catch (e) {
                    canvas.innerHTML = `<div class="text-danger text-center py-5">Error: ${e.message}</div>`;
                }
            }

            function togglePrintLanguage(lang) {
                if (state.currentLang === lang) return;
                state.currentLang = lang;
                if (state.currentProforma) {
                    loadPrintPreview(state.currentProforma.invoice_id, lang);
                }
            }

            function triggerBrowserPrint() {
                window.print();
            }

    function generateLegacyHTML(data) {
    const u = utils;
    
    // 1. Pagination Config
    const ITEMS_FIRST_PAGE = 14;
    const ITEMS_NEXT_PAGES = 32; 
    
    // 2. Chunk Lines
    const allLines = Array.isArray(data.lines) ? data.lines : [];
    const pages = [];
    let currentIdx = 0;
    
    while (currentIdx < allLines.length) {
        const limit = (pages.length === 0) ? ITEMS_FIRST_PAGE : ITEMS_NEXT_PAGES;
        pages.push(allLines.slice(currentIdx, currentIdx + limit));
        currentIdx += limit;
    }
    if (pages.length === 0) pages.push([]);

    // 3. Bill To Helper
    const renderBillTo = () => (Array.isArray(data.bill_to) ? data.bill_to : []).map((raw, idx) => {
        const line = (raw || '').trim();
        if (!line) return '';
        if (idx === 0) return `<div style="font-weight:700; font-size: 9pt;">${line}</div>`; 
        const m = line.match(/^(ATTN:|Email:|NIU:)\s*(.*)$/i);
        if (m) return `<div><span style="font-weight:700;">${m[1]}</span> <span>${m[2]}</span></div>`;
        return `<div>${line}</div>`;
    }).join('');

    // 4. Build Pages
    return pages.map((pageLines, pageIdx) => {
        const page = pageIdx + 1;
        const isFirst = (page === 1);
        const isLast = (page === pages.length);

        return `
        <div class="legacy-invoice" style="height: 296mm; display: flex; flex-direction: column; page-break-after: ${isLast ? 'auto' : 'always'}; position: relative;">
            
            <div class="legacy-header">
                <div class="legacy-logo"><img src="../../../assets/img-webp/logo-smart.webp" alt="Logo"></div>
                <div class="legacy-company">
                    <h1>Smart Logistics And Services Ltd</h1>
                    <div>1030, Avenue Douala Manga Bell, Bali</div>
                    <div>PO Box 5120, Douala, Cameroon</div>
                    <div>+237 233 420 281 | invoicing@smartls.cm</div>
                </div>
            </div>

            ${isFirst ? `
            <div style="flex: 0 0 auto;">
                <div style="text-align: center; font-weight: 800; font-size: 12pt; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; color: #000;">PROFORMA INVOICE</div>
                <div class="legacy-row">
                    <div class="legacy-col-6">
                        <div class="legacy-box-title">BILL TO</div>
                        <div style="font-size: 8.5pt; line-height: 1.3;">${renderBillTo()}</div>
                    </div>
                    <div class="legacy-col-4">
                        <div class="legacy-box-title">PROFORMA INVOICE INFO</div>
                        <div>
                            <div class="legacy-kv-row"><div class="legacy-key">Number:</div><div class="legacy-val" style="font-weight:700;">${data?.header?.invoice_no ?? ''}</div></div>
                            <div class="legacy-kv-row"><div class="legacy-key">Date:</div><div class="legacy-val">${data?.header?.date ?? ''}</div></div>
                            <div class="legacy-kv-row"><div class="legacy-key">File Ref:</div><div class="legacy-val">${data?.header?.file_ref ?? ''}</div></div>
                            <div class="legacy-kv-row"><div class="legacy-key">Terms:</div><div class="legacy-val">${data?.header?.terms ?? 'Upon reception'}</div></div>
                            <div class="legacy-kv-row"><div class="legacy-key">Currency:</div><div class="legacy-val">${data?.header?.currency ?? ''}</div></div>
                        </div>
                    </div>
                </div>
                <div style="margin-bottom: 10px;">
                    <div class="legacy-box-title">SHIPMENT DETAILS</div>
                    <div class="ship-grid">
    <div class="ship-col">
        <div><span style="font-weight:600;">Service:</span> ${data?.shipment?.service ?? '-'}</div>
        <div><span style="font-weight:600;">Route:</span> ${data?.shipment?.route ?? '-'}</div>
        <div><span style="font-weight:600;">Conveyance:</span> ${data?.shipment?.vessel ?? '-'}</div>
    </div>
    <div class="ship-col">
        <div><span style="font-weight:600;">Trans. Ref.:</span> ${data?.shipment?.bl_awb ?? '-'}</div>
        <div><span style="font-weight:600;">Marks:</span> ${data?.shipment?.marks ?? '-'}</div>
        <div><span style="font-weight:600;">Incoterm:</span> ${data?.shipment?.incoterm ?? '-'}</div>
    </div>
    <div class="ship-col">
        <div><span style="font-weight:600;">Comm.:</span> ${data?.shipment?.commodity ?? '-'}</div>
        <div><span style="font-weight:600;">Weight:</span> ${data?.shipment?.weight ?? '-'}</div>
        <div><span style="font-weight:600;">Dest:</span> ${data?.shipment?.dest ?? '-'}</div>
    </div>
</div>
                </div>
            </div>` : ''}

            <div style="flex: 0 0 auto;">
                <table class="legacy-table">
                    <thead>
                        <tr>
                            <th class="col-code">CODE</th><th class="col-desc">DESCRIPTION</th><th class="col-qty">QTY</th>
                            <th class="col-curr">UNIT PRICE</th><th class="col-curr">TOTAL HT</th>
                            <th class="col-curr">${data?.labels?.vat ?? 'VAT'}</th><th class="col-curr">TOTAL TTC</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pageLines.map(l => `
                        <tr>
                            <td class="col-code">${l.code ?? ''}</td><td class="col-desc">${l.desc ?? ''}</td><td class="col-qty">${l.qty ?? ''}</td>
                            <td class="col-curr">${u.formatNumber(l.unit ?? 0)}</td><td class="col-curr">${u.formatNumber(l.ht ?? 0)}</td>
                            <td class="col-curr">${u.formatNumber(l.vat ?? 0)}</td><td class="col-curr">${u.formatNumber(l.ttc ?? 0)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>

            ${isLast ? `
            <div style="flex: 0 0 auto; margin-top: 10px;">
                <div class="footer-split">
                    <div class="footer-left">
                        <div class="amount-words-box">
                            ${data?.words?.label ?? 'AMOUNT IN WORDS:'} <span style="text-transform: uppercase;">${data?.words?.amount ?? ''}</span>
                        </div>
                        <div class="remarks-box">
                            <div class="legacy-box-title" style="border: none; margin-bottom: 0; text-decoration: underline;">REMARKS:</div>
                            <div class="remarks-content">${data?.remarks ?? ''}</div>
                        </div>
                    </div>
                    <div class="footer-right">
                        <table class="totals-table">
                            <tr><td class="total-label">Total H.T.</td><td class="total-val">${u.formatNumber(data?.totals?.ht ?? 0)}</td></tr>
                            <tr><td class="total-label">${data?.labels?.vat ?? 'VAT'} (19.25%)</td><td class="total-val">${u.formatNumber(data?.totals?.vat ?? 0)}</td></tr>
                            <tr><td class="total-label">NET PAYABLE</td><td class="total-val">${u.formatNumber(data?.totals?.ttc ?? 0)}</td></tr>
                            <tr class="grand-total-row"><td class="total-label">ADVANCE (${data?.totals?.pct ?? 100}%)</td><td class="total-val">${u.formatNumber(data?.totals?.advance ?? 0)} ${data?.header?.currency ?? ''}</td></tr>
                        </table>
                        
                        <div class="sig-area">
    <div class="sig-label">INVOICING</div>
    ${(data?.header?.signature_mode === 'PHYSICAL') ? '<div style="height: 60px;"></div>' : '<img src="../../../assets/img/signature-dg.svg" class="sig-img">'}
</div>
                    </div>
                </div>
            </div>` : ''}

            <div style="flex: 1;"></div>

            <div style="flex: 0 0 auto;">
                <div class="page-footer" style="border-top: 2px solid #EE7D04; margin-top: 10px;">
                    <div>
                        <strong>NIU:</strong> M042116033580Q | <strong>RC:</strong> RC/DLA/2021/B/2060<br>
                        <strong>Bank:</strong> AFRILAND FIRST BANK | <strong>Account:</strong> 10005-0006-107018411001-93
                    </div>
                    <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
                        <div class="page-num">PAGE ${page} / ${pages.length}</div>
                        <div>Generated by Smart LS System | ${data?.header?.date ?? ''}</div>
                    </div>
                </div>
            </div>

        </div>`;
    }).join('');
}

        // --- EXPORT PUBLIC FUNCTIONS ---
            return {
                init,
                initNewProforma,
                openEditor,
                filterTable,
                searchTable,
                updateLine,
                deleteLine,
                searchDictionaryForLine,
                selectDictionaryItem,
                saveProforma,
                approveProforma,
                rejectProforma,
                issueProforma,
                confirmIssue,
                printProforma,
                togglePrintLanguage,
                triggerBrowserPrint,
                
                // ADD THESE THREE TO ENSURE UNLOCK WORKS
                requestUnlock,       
                submitUnlockRequest, 
                approveUnlock        
            };
        })(); // This closes the APP module
        
        // Initialize on DOM load
        document.addEventListener('DOMContentLoaded', APP.init);
    </script>
    <div class="modal fade" id="unlockModal" tabindex="-1" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header bg-light">
                <h5 class="modal-title fw-bold text-danger">
                    <i class="fa-solid fa-lock-open me-2"></i>Request Edit Access
                </h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <p class="small text-muted mb-2">
                    This invoice is currently <strong>LOCKED</strong>. To edit, you must request approval from Management.
                </p>
                <div class="mb-3">
                    <label class="form-label fw-bold">Reason for Unlocking <span class="text-danger">*</span></label>
                    <textarea class="form-control" id="txtUnlockReason" rows="3" 
                              placeholder="e.g. Correcting unit price on line 2..."></textarea>
                    <div class="form-text text-end">
                        <span id="charCount" class="fw-bold text-danger">0</span>/5 characters minimum
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-danger btn-sm fw-bold" id="btnSubmitUnlock" disabled onclick="APP.submitUnlockRequest()">
                    Submit Request
                </button>
            </div>
        </div>
    </div>
</div>
<div class="modal fade" id="issueModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Issue Proforma</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <p>You are about to lock this invoice. How should the signature appear?</p>
                <div class="d-grid gap-2">
                    <div class="d-grid gap-2">
    <button id="btnIssueDigital" class="btn btn-outline-primary text-start p-3 border-2" onclick="APP.confirmIssue('DIGITAL')">
        <div class="fw-bold"><i class="fa-solid fa-pen-nib me-2"></i>Digital Signature</div>
        <small class="text-muted">Apply the electronic stamp & signature automatically.</small>
    </button>

    <button id="btnIssuePhysical" class="btn btn-outline-dark text-start p-3 border-2" onclick="APP.confirmIssue('PHYSICAL')">
        <div class="fw-bold"><i class="fa-solid fa-stamp me-2"></i>Physical Stamping (Wet Ink)</div>
        <small class="text-muted">Leave signature area blank for manual stamping.</small>
    </button>
</div>
                </div>
            </div>
        </div>
    </div>
</div>
</body>
</html>