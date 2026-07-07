<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['SALES']);

/**
 * Use same authenticated user fetch pattern as index.php (authoritative profile).
 */
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

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
$stmt->bind_param('is', $userId, $employeeId);
$stmt->execute();
$me = $stmt->get_result()->fetch_assoc();

if (!$me) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

// --- Display values ---
$fullName  = trim((string)($me['full_name'] ?? 'SALES'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'SALES');

$role = strtoupper((string)($me['role'] ?? 'SALES'));
$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$roleLabel = $roleLabelMap[$role] ?? $role;

// For MANAGEMENT, show job title if present, else fallback.
$jobTitle = trim((string)($me['job_title'] ?? ''));
$topRoleLabel = ($jobTitle !== '') ? strtoupper($jobTitle) : $roleLabel;

// Avatar
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// Greeting
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');
$bannerName = $firstName;

// --- API base (adjust if your routing differs) ---
$API_BASE = '../../api/marginpricing'; // e.g. /administration/api/marginpricing/*
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Smart LS Commercial Workspace - Enterprise Logistics Pricing Engine" />
  <meta name="author" content="Smart Logistics & Services IT" />
  <title>Commercial Workspace | Smart LS Enterprise | v3.0.0 Stable</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
  <link rel="stylesheet" href="../../css/admin.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400;500;600;700;800&family=Montserrat:wght@100;200;300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

  <style>
    /* ==================================================================================
       1. CORE RESET & VARIABLES
       ================================================================================== */
    :root {
      /* Brand Colors */
      --smart-blue: #1F99D8;
      --smart-blue-hover: #167ab0;
      --smart-dark: #055B83;
      --smart-dark-rgb: 5, 91, 131;
      --smart-orange: #EE7D04;
      --smart-orange-hover: #cc6b03;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
      --smart-surface: #FFFFFF;

      /* Structural Variables */
      --sidebar-width: 280px;
      --sidebar-width-collapsed: 80px;
      --header-height: 70px;
      --footer-height: 60px;
      --border-radius: 8px;
      --border-color: #e2e8f0;

      /* Typography */
      --font-body: 'Manrope', sans-serif;
      --font-heading: 'Montserrat', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;

      /* Status Colors */
      --st-draft-bg: #f1f5f9; --st-draft-fg: #475569;
      --st-submitted-bg: #fff7ed; --st-submitted-fg: #c2410c;
      --st-approved-bg: #f0fdf4; --st-approved-fg: #15803d;
      --st-rejected-bg: #fef2f2; --st-rejected-fg: #991b1b;
      --st-quoted-bg: #eff6ff; --st-quoted-fg: #1e40af;
      --st-revision-bg: #f5f3ff; --st-revision-fg: #7c3aed;
    }

    *, *::before, *::after { box-sizing: border-box; }

    body {
      font-family: var(--font-body);
      background-color: var(--smart-bg);
      color: var(--smart-charcoal);
      overflow-x: hidden;
      font-size: 0.9rem;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    h1, h2, h3, h4, h5, h6, .font-heading {
      font-family: var(--font-heading);
      letter-spacing: -0.02em;
    }

    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #f1f1f1; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; border: 2px solid #f1f1f1; }
    ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

    /* ==================================================================================
       2. KEEP ALL ORIGINAL PAGE STYLES (EXCEPT TOPBAR/SIDEBAR WHICH ARE OVERRIDDEN BELOW)
       ================================================================================== */

    /* --- MAIN LAYOUT AREA (BASE) --- */
    .main-content{
      margin-left: var(--sidebar-width);
      padding-top: var(--header-height);
      min-height: 100vh;
      width: calc(100% - var(--sidebar-width));
      transition: margin-left 0.3s ease, width 0.3s ease;
    }

    /* --- DASHBOARD CARDS & WIDGETS --- */
    .card-custom {
      background: white;
      border-radius: 16px;
      border: 1px solid var(--border-color);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.01), 0 2px 4px -1px rgba(0, 0, 0, 0.01);
      height: 100%;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s;
      position: relative;
      overflow: hidden;
    }
    .card-custom:hover {
      transform: translateY(-4px);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.01);
    }

    .kpi-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 1px; margin-bottom: 4px; }
    .kpi-value { font-size: 1.85rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.1; letter-spacing: -1px; }

    .smart-input {
      border-radius: 6px;
      font-size: 0.9rem;
      padding: 0.6rem 0.85rem;
      border: 1px solid #cbd5e1;
      transition: all 0.2s;
    }
    .smart-input:focus {
      border-color: var(--smart-dark);
      box-shadow: 0 0 0 4px rgba(5, 91, 131, 0.1);
      outline: none;
    }

    /* Status Pills */
    .status-badge {
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
      padding: 6px 12px;
      border-radius: 50px;
      letter-spacing: 0.5px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .status-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; display: block; }
    .st-draft { background: var(--st-draft-bg); color: var(--st-draft-fg); border: 1px solid #e2e8f0; }
    .st-draft::before { background: var(--st-draft-fg); }
    .st-submitted { background: var(--st-submitted-bg); color: var(--st-submitted-fg); border: 1px solid #ffedd5; }
    .st-submitted::before { background: var(--st-submitted-fg); }
    .st-approved { background: var(--st-approved-bg); color: var(--st-approved-fg); border: 1px solid #dcfce7; }
    .st-approved::before { background: var(--st-approved-fg); }
    .st-rejected { background: var(--st-rejected-bg); color: var(--st-rejected-fg); border: 1px solid #fee2e2; }
    .st-rejected::before { background: var(--st-rejected-fg); }
    .st-quoted { background: var(--st-quoted-bg); color: var(--st-quoted-fg); border: 1px solid #dbeafe; }
    .st-quoted::before { background: var(--st-quoted-fg); }
    .st-revision { background: var(--st-revision-bg); color: var(--st-revision-fg); border: 1px solid #e9d5ff; }
    .st-revision::before { background: var(--st-revision-fg); }

    /* Table Styling */
    .table-custom { width: 100%; border-collapse: separate; border-spacing: 0; }
    .table-custom thead th {
      background: #f8fafc;
      font-size: 0.75rem;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 700;
      border-bottom: 2px solid #e2e8f0;
      padding: 16px 20px;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .table-custom tbody tr { transition: background 0.15s; }
    .table-custom tbody tr:hover { background-color: #f8fafc; cursor: pointer; transform: scale(1); }
    .table-custom td {
      font-size: 0.9rem;
      vertical-align: middle;
      padding: 16px 20px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }
    .table-custom tr:last-child td { border-bottom: none; }

    /* ==================================================================================
       3. OFFCANVAS SIMULATOR (ORIGINAL)
       ================================================================================== */
    .offcanvas-body { display: flex; flex-direction: column; padding: 0; overflow: hidden; background: #f8fafc; }
    .workspace-header {
      padding: 16px 32px;
      background: #fff;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
      z-index: 10;
    }
    .ssdc-panel {
      background: #fff;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 20px;
      margin-top: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }
    .ssdc-label { color: #94a3b8; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; display: block; letter-spacing: 0.5px; }
    .ssdc-value { color: #0f172a; font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }

    .workspace-content { flex-grow: 1; overflow: hidden; display: flex; }
    .table-area {
      flex: 1;
      overflow-y: auto;
      padding: 0 32px;
      background: #fff;
      position: relative;
      padding-top: 20px;
    }
    .sidebar-area {
      width: 360px;
      background: #fdfdfd;
      border-left: 1px solid var(--border-color);
      padding: 24px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .table-sim th {
      position: sticky;
      top: 0;
      background-color: #ffffff;
      z-index: 100;
      border-bottom: 2px solid #e2e8f0;
      font-size: 0.7rem;
      text-transform: uppercase;
      color: #64748b;
      padding: 12px 10px;
      box-shadow: 0 4px 6px -4px rgba(0,0,0,0.15);
    }
    .table-sim td { vertical-align: top; padding: 12px 10px; border-bottom: 1px solid #f1f5f9; }

    .input-sell {
      border: 1px solid #cbd5e1;
      background: #fff;
      font-weight: 700;
      color: var(--smart-dark);
      text-align: right;
      border-radius: 6px;
      transition: all 0.2s;
      font-family: var(--font-mono);
      padding: 6px 10px;
      width: 100%;
    }
    .input-sell:focus { border-color: var(--smart-blue); box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.1); outline: none; }
    .input-sell:disabled { background: #f8fafc; color: #94a3b8; border-color: transparent; cursor: not-allowed; }

    .toggle-btn {
      background: none; border: 1px solid #e2e8f0; color: #cbd5e1;
      width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all 0.2s;
    }
    .toggle-btn:hover { background: #f1f5f9; color: #94a3b8; }
    .toggle-btn.active-vat { background: #dbeafe; color: var(--smart-blue); border-color: var(--smart-blue); }
    .toggle-btn.active-eye { background: #dcfce7; color: #15803d; border-color: #15803d; }
    .toggle-btn.inactive-eye { background: #f1f5f9; color: #cbd5e1; opacity: 0.5; }

    .chart-container {
      display: flex; align-items: flex-end; justify-content: space-around;
      height: 180px; padding: 20px 10px 0;
      background: #fff; border-radius: 12px; border: 1px solid var(--border-color);
    }
    .bar-col { display: flex; flex-direction: column; align-items: center; width: 25%; position: relative; height: 100%; justify-content: flex-end; }
    .bar {
      width: 100%;
      border-radius: 8px 8px 0 0;
      transition: height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
      min-height: 4px;
      position: relative;
    }
    .bar-val { position: absolute; top: -30px; left: 50%; transform: translateX(-50%); font-size: 0.75rem; font-weight: 800; white-space: nowrap; color: #334155; background: white; padding: 2px 6px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .bar-lbl { font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 12px; margin-bottom: 10px; border-top: 1px solid #f1f5f9; width: 100%; text-align: center; padding-top: 6px; }

    .bg-cost { background: linear-gradient(to top, #64748b, #94a3b8); }
    .bg-rev  { background: linear-gradient(to top, #0369a1, #38bdf8); }
    .bg-profit { background: linear-gradient(to top, #c2410c, #fb923c); }

    .workspace-footer {
      padding: 16px 32px;
      background: #fff;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      z-index: 100;
    }

    .obs-pill { font-size: 0.65rem; font-weight: 800; padding: 4px 8px; border-radius: 4px; display: inline-block; width: 100%; text-align: center; letter-spacing: 0.5px; }
    .obs-poor { background: #fee2e2; color: #991b1b; }
    .obs-fair { background: #ffedd5; color: #c2410c; }
    .obs-good { background: #dcfce7; color: #15803d; }
    .obs-excel { background: #dbeafe; color: #1e40af; }

    /* ==================================================================================
       4. PRINT ENGINE (ORIGINAL)
       ================================================================================== */
    #print-container {
      background-color: #525659;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 40px;
      width: 100%;
      min-height: 100vh;
    }
    .a4-page {
      width: 210mm;
      height: 297mm;
      background: white;
      padding: 10mm 15mm;
      position: relative;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      font-family: 'Montserrat', sans-serif;
      color: #231F20;
    }
    .print-header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid var(--smart-orange);
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .ph-logo img { height: 55px; width: auto; }
    .ph-company { text-align: right; font-size: 0.7rem; line-height: 1.3; }
    .ph-company h1 { font-size: 1.1rem; font-weight: 800; text-transform: uppercase; margin: 0 0 2px 0; color: var(--smart-charcoal); }

    .info-grid-wrapper {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }
    .info-card { border: 1px solid #000; border-radius: 0; font-size: 0.6rem; }
    .info-card-head {
      background: #e0e0e0; font-weight: 800; text-transform: uppercase;
      padding: 3px 6px; border-bottom: 1px solid #000;
    }
    .info-card-body { padding: 4px 6px; line-height: 1.3; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 1px; }
    .info-line strong { color: #444; margin-right: 5px; }

    .print-table-wrapper { width: 100%; position: relative; margin-bottom: 10px; }
    .print-table { width: 100%; border-collapse: collapse; font-size: 0.65rem; }
    .print-table th {
      background: var(--smart-charcoal); color: white;
      padding: 3px 6px; text-transform: uppercase; font-weight: 700;
      border: 1px solid #000;
    }
    .print-table td {
      padding: 3px 6px;
      border-left: 1px solid #000; border-right: 1px solid #000;
      border-bottom: 1px dashed #ccc;
      vertical-align: top;
    }
    .print-table tbody { border-bottom: 1px solid #000; }

    .after-table-container { display: flex; gap: 20px; align-items: flex-start; width: 100%; }
    .ats-left { flex: 1; display: flex; flex-direction: column; }
    .amt-words {
      font-size: 0.7rem; font-style: italic; margin-bottom: 10px; font-weight: 700;
      border: 1px solid #000; padding: 6px; background: #f9f9f9;
    }
    .remarks-box { font-size: 0.6rem; border: 1px solid #000; padding: 5px; min-height: 60px; }

    .ats-right { width: 38%; display: flex; flex-direction: column; }
    .totals-box { width: 100%; border-collapse: collapse; font-size: 0.7rem; border: 1px solid #000; }
    .totals-box td { padding: 4px 8px; border-bottom: 1px solid #ccc; }
    .totals-box tr:last-child td { border-bottom: none; background: #eee; font-weight: 800; font-size: 0.75rem; }

    .md-signature-block { margin-top: 20px; text-align: center; width: 100%; }
    .md-sig-title { font-size: 0.6rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px; color: var(--smart-dark); }
    .md-sig-img { height: 150px; width: auto; display: block; margin: 0 auto; }

    .print-footer {
      margin-top: auto;
      border-top: 2px solid var(--smart-orange);
      padding-top: 6px;
      font-size: 0.6rem;
      text-align: center;
      color: #222;
    }
    .pf-row { display: flex; justify-content: center; gap: 15px; margin-bottom: 2px; font-weight: 700; }

    @media print {
      @page { margin: 0; size: auto; }
      body > *:not(#printModal) { display: none !important; }
      html, body { height: 100%; background: white; }
      #printModal { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999; background: white; }
      .modal-dialog, .modal-content, .modal-body { margin: 0; padding: 0; border: none; width: 100%; height: 100%; }
      .modal-header, .no-print { display: none !important; }
      #print-container { padding: 0; background: white; }
      .a4-page { margin: 0; box-shadow: none; page-break-after: always; height: 297mm; width: 210mm; }
      .a4-page:last-child { page-break-after: auto; }
    }

    /* ==================================================================================
       5. REPLACE ONLY TOPBAR + SIDEBAR WITH index.php VERSION (OVERRIDES)
       ================================================================================== */
    :root{ --sidebar-width:280px; }

    .sidebar{
      width:var(--sidebar-width);
      height:100vh;
      position:fixed;
      top:0; left:0;
      background-color:#ffffff;
      border-right:1px solid #e0e0e0;
      z-index:1000;
      display:flex;
      flex-direction:column;
      box-shadow:2px 0 10px rgba(0,0,0,0.02);
    }
    .sidebar-header{
      height:70px;
      display:flex;
      align-items:center;
      padding:0 20px;
      border-bottom:1px solid #f0f0f0;
    }
    .brand-logo{
      font-weight:800;
      font-size:1.1rem;
      color:var(--smart-charcoal);
      text-decoration:none;
      letter-spacing:-0.5px;
      display:flex;
      align-items:center;
    }
    .sidebar-menu{ overflow-y:auto; flex-grow:1; padding:10px 0; }

    .menu-btn{
      width:100%;
      text-align:left;
      background:none;
      border:none;
      padding:12px 20px;
      font-size:0.8rem;
      font-weight:700;
      color:#555;
      display:flex;
      justify-content:space-between;
      align-items:center;
      transition:all 0.2s;
      border-left:3px solid transparent;
    }
    .menu-btn:hover, .menu-btn[aria-expanded="true"]{
      color:var(--smart-charcoal);
      background-color:#f0f7fa;
      border-left-color:var(--smart-charcoal);
    }
    .menu-btn i.category-icon{ width:20px; margin-right:8px; color:#888; transition:color 0.2s; }
    .menu-btn:hover i.category-icon{ color:var(--smart-charcoal); }
    .menu-chevron{ font-size:0.7rem; transition:transform 0.3s; }
    .menu-btn[aria-expanded="true"] .menu-chevron{ transform:rotate(180deg); }

    .sub-link{
      display:block;
      padding:8px 20px 8px 48px;
      font-size:0.75rem;
      color:#666;
      text-decoration:none;
      font-weight:500;
      transition:all 0.2s;
      line-height:1.3;
    }
    .sub-link:hover{ color:var(--smart-orange); background-color:#fff9f2; }

    .sidebar-footer{ border-top:1px solid #f0f0f0; padding:16px; }

    .top-navbar{
      height:70px;
      position:fixed;
      top:0; right:0; left:var(--sidebar-width);
      background:rgba(255,255,255,0.95);
      backdrop-filter:blur(12px);
      border-bottom:1px solid #e0e0e0;
      z-index:900;
      padding:0 30px;
      display:flex;
      align-items:center;
      justify-content:space-between;
    }

    .clock-pill{
      background:#f1f5f9;
      padding:6px 12px;
      border-radius:30px;
      display:flex;
      align-items:center;
      gap:10px;
      font-size:0.85rem;
      font-weight:600;
      color:var(--smart-dark);
    }
    .btn-clock{
      background:#e2e8f0;
      border:none;
      border-radius:20px;
      padding:4px 12px;
      font-size:0.75rem;
      font-weight:700;
      color:#64748b;
      transition:0.3s;
    }
    .btn-clock.active{
      background:var(--smart-orange);
      color:white;
      box-shadow:0 2px 10px rgba(238,125,4,0.3);
    }
  </style>
</head>

<body>

  <!-- SIDEBAR -->
   <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Sales Dashboard GM</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="salesMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales1">
                <span><i class="fa-solid fa-database category-icon"></i>MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales1" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales2">
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales2" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales3">
                <span><i class="fa-solid fa-filter category-icon"></i>SALES FUNNEL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales3" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales4">
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales4" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales5">
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales5" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales6" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales7">
                <span><i class="fa-solid fa-box-archive category-icon"></i>COMPANY ARCHIVES</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales7" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
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
      <h5 class="mb-0 fw-bold text-dark">Cash Requests</h5>
      <small class="text-muted" style="font-size: 0.7rem;">FINANCE DISBURSEMENT WORKFLOW</small>
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
          <div class="fw-bold fs-6"><?php echo h($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
            <?php echo h($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo h($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo h($firstName); ?>">
      </div>
    </div>
  </div>

  <!-- CONTENT -->
  <div class="main-content px-4 pb-5">

    <div class="row py-4 align-items-center">
      <div class="col-md-6">
        <h2 class="fw-bold font-heading mb-0">Margin Simulations</h2>
        <p class="text-muted mb-0 small">Analyze costs, define pricing strategies, and generate commercial quotations.</p>
      </div>
      <div class="col-md-6 text-end">
        <button class="btn btn-dark fw-bold px-4 py-2 shadow-sm" type="button" onclick="openSim('new')">
          <i class="fa-solid fa-plus me-2"></i>New Simulation
        </button>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width: 50px; height: 50px; font-size: 1.2rem;">
            <i class="fa-solid fa-chart-pie"></i>
          </div>
          <div>
            <div class="kpi-title">Win Rate (MTD)</div>
            <div class="kpi-value" id="kpi-winrate">-</div>
            <small class="text-success fw-bold" style="font-size: 0.7rem;" id="kpi-winrate-delta"><i class="fa-solid fa-arrow-trend-up"></i> -</small>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 50px; height: 50px; font-size: 1.2rem;">
            <i class="fa-solid fa-file-invoice"></i>
          </div>
          <div>
            <div class="kpi-title">Active Quotes</div>
            <div class="kpi-value" id="kpi-activequotes">-</div>
            <small class="text-muted" style="font-size: 0.7rem;" id="kpi-pipeline">Pipeline: -</small>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width: 50px; height: 50px; font-size: 1.2rem;">
            <i class="fa-solid fa-stamp"></i>
          </div>
          <div>
            <div class="kpi-title">Pending Approval</div>
            <div class="kpi-value text-warning" id="kpi-pending">-</div>
            <small class="text-muted" style="font-size: 0.7rem;">Needs Action</small>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-4 d-flex align-items-center bg-dark text-white border-0 position-relative overflow-hidden">
          <div class="position-relative z-2">
            <div class="kpi-title text-white-50">Projected Margin</div>
            <div class="kpi-value text-white" id="kpi-projmargin">-</div>
            <small class="text-white-50 fw-bold" style="font-size: 0.7rem;">XAF (Weighted)</small>
          </div>
          <i class="fa-solid fa-coins position-absolute text-white opacity-10" style="font-size: 80px; right: -20px; bottom: -20px; transform: rotate(-15deg);"></i>
        </div>
      </div>
    </div>

    <div class="card-custom p-0 overflow-hidden">
      <div class="p-3 border-bottom bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div class="btn-group shadow-sm" role="group" id="statusFilters">
          <button type="button" class="btn btn-sm btn-white text-dark border fw-bold active" onclick="filterStatus('ALL')">All</button>
          <button type="button" class="btn btn-sm btn-white text-primary border fw-bold" onclick="filterStatus('DRAFT')">Draft</button>
          <button type="button" class="btn btn-sm btn-white text-warning border fw-bold" onclick="filterStatus('SUBMITTED')">Submitted</button>
          <button type="button" class="btn btn-sm btn-white text-success border fw-bold" onclick="filterStatus('APPROVED')">Approved</button>
          <button type="button" class="btn btn-sm btn-white text-dark border fw-bold" onclick="filterStatus('QUOTED')">Quoted</button>
        </div>

        <div class="input-group input-group-sm" style="width: 320px;">
          <span class="input-group-text bg-white border-end-0 ps-3"><i class="fa-solid fa-search text-muted"></i></span>
          <input type="text" class="form-control border-start-0 ps-0 smart-input" placeholder="Search Client, Ref, Ops..." id="searchInput" onkeyup="debouncedRenderDashboard()">
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-custom mb-0">
          <thead>
            <tr>
              <th class="ps-4">Sim Ref #</th>
              <th>Costing Source</th>
              <th>Client / Account</th>
              <th class="text-end">Revenue (XAF)</th>
              <th class="text-end">Margin (XAF)</th>
              <th>KPI</th>
              <th>Status</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>

      <div class="p-2 border-top bg-light d-flex justify-content-between align-items-center">
        <small class="text-muted fw-bold ms-2" id="pager-label">Showing -</small>
        <nav class="me-2">
          <ul class="pagination pagination-sm mb-0" id="pager"></ul>
        </nav>
      </div>
    </div>
  </div>

  <!-- OFFCANVAS -->
  <div class="offcanvas offcanvas-end" tabindex="-1" id="simOffcanvas" style="width: 96vw; max-width: 1440px;">
    <div class="workspace-header">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="d-flex align-items-center gap-3">
          <h5 class="font-heading fw-bold mb-0 text-dark">Margin Simulator</h5>
          <span class="badge st-draft" id="sim-status-badge">DRAFT</span>
          <div class="vr"></div>
          <small class="text-muted font-mono fw-bold" id="sim-ref-display">-</small>
        </div>

        <div class="d-flex gap-2">
          <div class="file-selector-group">
            <span class="text-muted small fw-bold me-2 text-uppercase" style="font-size: 0.65rem;">Link Costing:</span>
            <select class="form-select form-select-sm d-inline-block w-auto border-secondary" id="costing-selector" onchange="loadCostingData(this.value)">
              <option value="">Select Approved Costing...</option>
            </select>
          </div>
          <button class="btn btn-outline-secondary fw-bold btn-sm" onclick="generatePDF('INTERNAL')">
            <i class="fa-solid fa-print me-2"></i>Analysis
          </button>
          <button type="button" class="btn-close ms-2" data-bs-dismiss="offcanvas"></button>
        </div>
      </div>

      <div class="ssdc-panel">
        <div class="row g-2">
          <div class="col-md-3 border-end">
            <span class="ssdc-label">Client</span>
            <span class="ssdc-value" id="ssdc-client">-</span>
          </div>
          <div class="col-md-2 border-end">
            <span class="ssdc-label">Service</span>
            <span class="ssdc-value" id="ssdc-service">-</span>
          </div>
          <div class="col-md-2 border-end">
            <span class="ssdc-label">File Ref</span>
            <span class="ssdc-value" id="ssdc-fileref">-</span>
          </div>
          <div class="col-md-2 border-end">
            <span class="ssdc-label">Costing Ref</span>
            <span class="ssdc-value text-primary" id="ssdc-costref">-</span>
          </div>
          <div class="col-md-2 border-end">
            <span class="ssdc-label">Route</span>
            <span class="ssdc-value" id="ssdc-route">-</span>
          </div>
          <div class="col-md-1 text-center pt-2">
            <a href="#ssdcHidden" data-bs-toggle="collapse" class="text-secondary"><i class="fa-solid fa-chevron-down"></i></a>
          </div>
        </div>
        <div class="collapse mt-3 pt-3 border-top" id="ssdcHidden">
          <div class="row g-3">
            <div class="col-md-2"><span class="ssdc-label">ETA</span><span class="ssdc-value" id="ssdc-eta">-</span></div>
            <div class="col-md-2"><span class="ssdc-label">Weight</span><span class="ssdc-value" id="ssdc-wgt">-</span></div>
            <div class="col-md-2"><span class="ssdc-label">Packages</span><span class="ssdc-value" id="ssdc-pkg">-</span></div>
            <div class="col-md-2"><span class="ssdc-label">Commodity</span><span class="ssdc-value" id="ssdc-comm">-</span></div>
            <div class="col-md-4"><span class="ssdc-label">Marks</span><span class="ssdc-value" id="ssdc-marks">-</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="workspace-content">
      <div class="table-area">
        <table class="table table-sim w-100">
          <thead>
            <tr>
              <th style="width: 40px;">#</th>
              <th style="width: 40px;">Q</th>
              <th>Item Description</th>
              <th class="text-end">Cost (XAF)</th>
              <th class="text-end bg-primary bg-opacity-10 border-start border-primary" style="width: 160px;">Selling (XAF)</th>
              <th class="text-center" style="width: 50px;">VAT</th>
              <th class="text-end">Margin</th>
              <th class="text-center" style="width: 100px;">KPI</th>
              <th>Quote Remarks (Client Facing)</th>
            </tr>
          </thead>
          <tbody id="sim-lines-body"></tbody>
        </table>
        <div class="text-center mt-3 mb-5">
          <button class="btn btn-outline-primary btn-sm fw-bold border-dashed" onclick="addAdHocLine()">
            <i class="fa-solid fa-plus me-2"></i>Add Ad-Hoc Line (Financial Dictionary)
          </button>
          <p class="text-muted small fst-italic mt-2">
            Use 'Add Ad-Hoc Line' for fees not present in the Costing (e.g., File Opening, Management Fees).
          </p>
        </div>
      </div>

      <div class="sidebar-area">
        <div>
          <h6 class="fw-bold text-uppercase small text-muted mb-3"><i class="fa-solid fa-chart-simple me-2"></i>Profitability Snapshot</h6>
          <div class="chart-container">
            <div class="bar-col">
              <div class="bar-val font-mono" id="chart-cost-val">0</div>
              <div class="bar bg-cost" id="chart-cost-bar" style="height: 10%;"></div>
              <div class="bar-lbl">Cost</div>
            </div>
            <div class="bar-col">
              <div class="bar-val font-mono" id="chart-rev-val">0</div>
              <div class="bar bg-rev" id="chart-rev-bar" style="height: 10%;"></div>
              <div class="bar-lbl">Rev</div>
            </div>
            <div class="bar-col">
              <div class="bar-val font-mono" id="chart-prof-val">0</div>
              <div class="bar bg-profit" id="chart-prof-bar" style="height: 10%;"></div>
              <div class="bar-lbl">Net</div>
            </div>
          </div>
        </div>

        <div class="card bg-light border-0 p-3 text-center mt-2">
          <span class="text-muted small fw-bold text-uppercase">Global Margin</span>
          <div class="display-6 fw-bold text-dark my-1" id="global-margin-pct">0.0%</div>
          <div id="global-margin-badge"><span class="obs-pill obs-fair">WAITING</span></div>
        </div>

        <div class="d-grid gap-2 mt-auto">
          <div class="alert alert-danger p-2 small mb-0 d-none shadow-sm border-danger" id="risk-warning">
            <i class="fa-solid fa-triangle-exclamation me-1"></i> <strong>Risk Detected:</strong> Negative margins present on specific lines. Business Justification required.
          </div>
        </div>
      </div>
    </div>

    <div class="workspace-footer">
      <div class="d-flex align-items-center gap-4">
        <div class="text-muted small fst-italic" id="autosave-status"><i class="fa-solid fa-check me-1"></i> System Ready</div>
        <div class="vr"></div>
        <div class="small text-muted"><strong>Line Items:</strong> <span id="footer-count">0</span></div>
      </div>
      <div class="d-flex gap-2" id="footer-actions"></div>
    </div>
  </div>

  <!-- QUOTE SETUP -->
  <div class="modal fade" id="quoteSetupModal" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-dark text-white">
          <h5 class="modal-title fw-bold"><i class="fa-solid fa-file-invoice-dollar me-2"></i>Generate Quotation</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>

        <div class="modal-body p-4 bg-light">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label fw-bold small text-uppercase">Validity Period</label>
              <select class="form-select smart-input" id="q-validity">
                <option value="15 Days">15 Days (Standard)</option>
                <option value="30 Days">30 Days</option>
                <option value="7 Days">7 Days (Spot Rate)</option>
                <option value="48 Hours">48 Hours (Urgent)</option>
              </select>
            </div>

            <div class="col-md-6">
              <label class="form-label fw-bold small text-uppercase">Payment Terms</label>
              <input class="form-control smart-input" list="terms-list" id="q-terms" placeholder="Type or select terms...">
              <datalist id="terms-list">
                <option value="30 Days Net from Invoice Date">
                <option value="Cash in Advance (100%)">
                <option value="50% Advance, 50% upon Delivery">
                <option value="Immediate upon Receipt">
              </datalist>
            </div>

            <div class="col-md-4">
              <label class="form-label fw-bold small text-uppercase">Currency</label>
              <select class="form-select smart-input" id="q-currency" onchange="toggleFxRate(this.value)">
                <option value="XAF">XAF (BEAC)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label fw-bold small text-uppercase">Language</label>
              <select class="form-select smart-input border-primary" id="q-lang">
                <option value="EN">English (Standard)</option>
                <option value="FR">Français (Cameroon)</option>
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label fw-bold small text-uppercase">Exchange Rate</label>
              <input type="number" class="form-control smart-input" id="q-fx-rate" value="1.00" disabled step="0.01">
            </div>

            <div class="col-12">
              <label class="form-label fw-bold small text-uppercase">Bank Details</label>
              <textarea class="form-control smart-input font-mono" id="q-bank-custom" rows="2">Bank: AFRILAND FIRST BANK S.A.
Acct: 10005-0006-107018411001-93 | IBAN: CM21 1000 5000 6107</textarea>
            </div>

            <div class="col-12">
              <label class="form-label fw-bold small text-uppercase">Special Header Note</label>
              <textarea class="form-control smart-input" id="q-header-note" rows="2" placeholder="Optional remarks for Client understanding of quotation (e.g. 'Excluding Duties')."></textarea>
            </div>
          </div>
        </div>

        <div class="modal-footer border-top-0 bg-light">
          <button type="button" class="btn btn-outline-secondary fw-bold" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-dark fw-bold px-4" onclick="generatePDF('QUOTE')">
            <i class="fa-solid fa-print me-2"></i>Generate PDF
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- JUSTIFICATION -->
  <div class="modal fade" id="justificationModal" tabindex="-1" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content border-danger shadow-lg">
        <div class="modal-header bg-danger text-white">
          <h5 class="modal-title fw-bold"><i class="fa-solid fa-triangle-exclamation me-2"></i>Risk Justification</h5>
        </div>
        <div class="modal-body">
          <p class="small text-muted mb-3">One or more lines have negative margins. To proceed with submission, you must provide a valid business reason (e.g., Strategic Client, Loss Leader, Bundle Deal).</p>
          <textarea class="form-control" id="risk-reason" rows="4" placeholder="Explain why we are selling below cost..."></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary fw-bold" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-danger fw-bold" onclick="saveJustification()">Confirm Risk</button>
        </div>
      </div>
    </div>
  </div>

  <!-- PRINT -->
  <div class="modal fade" id="printModal" tabindex="-1">
    <div class="modal-dialog modal-fullscreen">
      <div class="modal-content bg-secondary bg-opacity-25">
        <div class="modal-header bg-white shadow-sm border-0 py-2 no-print">
          <h5 class="modal-title fw-bold text-dark"><i class="fa-solid fa-print me-2"></i>Print Preview</h5>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-outline-secondary fw-bold" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-dark fw-bold" onclick="window.print()">
              <i class="fa-solid fa-print me-2"></i>Print / Save PDF
            </button>
          </div>
        </div>
        <div class="modal-body d-flex justify-content-center overflow-auto py-4">
          <div id="print-container"></div>
        </div>
      </div>
    </div>
  </div>

  <datalist id="fin-dict"></datalist>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    // Guard: if admin.js doesn't define toggleClock, prevent crash.
    if (typeof toggleClock !== 'function') { function toggleClock(){ /* noop */ } }

    // Keep topbar clock alive regardless of admin.js clock implementation.
    function tickClock(){
      const el = document.getElementById('realtime-clock');
      if (!el) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const ss = String(now.getSeconds()).padStart(2,'0');
      el.textContent = `${hh}:${mm}:${ss}`;
    }
    setInterval(tickClock, 1000);
    tickClock();
  </script>

  <script>
    /**
     * =================================================================================
     * SMART LS COMMERCIAL WORKSPACE - FRONTEND (API-DRIVEN)
     * =================================================================================
     *
     * IMPORTANT:
     * - This file assumes backend endpoints exist under:
     *   <?php echo e($API_BASE); ?>/*
     * - Backend will be provided next (per your staged workflow).
     */

    const API_BASE = <?php echo json_encode($API_BASE, JSON_UNESCAPED_SLASHES); ?>;

    // Session-derived defaults (authoritative)
    const SESSION = {
      user_id: <?php echo (int)$userId; ?>,
      employee_id: <?php echo json_encode($employeeId); ?>,
      role: <?php echo json_encode($role); ?>,
      full_name: <?php echo json_encode($fullName); ?>,
    };

    // --- Shared helpers ---
    async function apiJson(url, opts = {}) {
      const res = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        ...opts,
      });

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) {}

      if (!res.ok || !data || data.ok === false) {
        const msg = (data && (data.error || data.message)) ? (data.error || data.message)
                  : (text ? text.slice(0, 200) : `HTTP ${res.status}`);
        throw new Error(msg);
      }
      return data;
    }

    function money(n){ return (Number(n||0)).toLocaleString(); }

    // --- UI state ---
    const bsOffcanvas = new bootstrap.Offcanvas('#simOffcanvas');

    let LIST_STATE = {
      status: 'ALL',
      q: '',
      page: 1,
      per_page: 10,
      total: 0,
      rows: []
    };

    let currentRole = SESSION.role || 'SALES';
    let currentSim = null;     // {id, simulation_ref, costing_id, costing_ref, status, totals...}
    let currentLines = [];     // [{line_id, code, desc, cost, sell, remarks, printOnQuote, applyVat, isAdHoc}]
    let isLocked = false;
    let riskJustification = "";

    // Reference caches from backend
    let APPROVED_COSTINGS = {};      // keyed by costing_id
    let FINANCIAL_DICTIONARY = [];   // [{code, name_en}]
    let CLIENT_LOOKUP = {};          // optional if backend returns client payloads
    let COSTING_SELECTOR_READY = false;

    // --- Debounce for search typing ---
    let _debounceTimer = null;
    function debouncedRenderDashboard(){
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => renderDashboard(true), 250);
    }

    // --- Status filter ---
    function filterStatus(status) {
      LIST_STATE.status = status;
      LIST_STATE.page = 1;

      // button styling
      const btns = document.querySelectorAll('#statusFilters button');
      btns.forEach(b => {
        b.classList.remove('active');
        if ((status === 'ALL' && b.textContent.trim().toUpperCase() === 'ALL') ||
            (b.textContent.trim().toUpperCase() === status)) {
          b.classList.add('active');
        }
      });

      renderDashboard(true);
    }

    // --- KPI rendering (from backend summary if provided) ---
    function renderKpis(summary){
      // safe defaults
      document.getElementById('kpi-winrate').innerText = summary?.win_rate_mtd != null ? `${Number(summary.win_rate_mtd).toFixed(1)}%` : '-';
      document.getElementById('kpi-winrate-delta').innerHTML = summary?.win_rate_delta != null
        ? `<i class="fa-solid fa-arrow-trend-${summary.win_rate_delta>=0 ? 'up' : 'down'}"></i> ${Math.abs(Number(summary.win_rate_delta)).toFixed(1)}% vs Last Mo`
        : `<i class="fa-solid fa-arrow-trend-up"></i> -`;

      document.getElementById('kpi-activequotes').innerText = summary?.active_quotes != null ? String(summary.active_quotes) : '-';
      document.getElementById('kpi-pipeline').innerText = summary?.pipeline_xaf != null ? `Pipeline: ${money(summary.pipeline_xaf)} XAF` : 'Pipeline: -';

      document.getElementById('kpi-pending').innerText = summary?.pending_approval != null ? String(summary.pending_approval) : '-';
      document.getElementById('kpi-projmargin').innerText = summary?.projected_margin_xaf != null ? money(summary.projected_margin_xaf) : '-';
    }

    // --- List rendering ---
    async function renderDashboard(fetchFromApi = false) {
      try {
        const search = document.getElementById('searchInput').value || '';
        LIST_STATE.q = search;

        if (fetchFromApi) {
          const params = new URLSearchParams();
          if (LIST_STATE.status && LIST_STATE.status !== 'ALL') params.set('status', LIST_STATE.status);
          if (LIST_STATE.q) params.set('q', LIST_STATE.q);
          params.set('page', String(LIST_STATE.page));
          params.set('per_page', String(LIST_STATE.per_page));

          const data = await apiJson(`${API_BASE}/list.php?${params.toString()}`, { method: 'GET', headers: {} });

          // expected: {ok:true, page, per_page, total, rows:[...], summary:{...}}
          LIST_STATE.page = data.page || LIST_STATE.page;
          LIST_STATE.per_page = data.per_page || LIST_STATE.per_page;
          LIST_STATE.total = data.total || 0;
          LIST_STATE.rows = data.rows || [];

          renderKpis(data.summary || null);
        }

        const tbody = document.getElementById('table-body');
        const rows = LIST_STATE.rows || [];

        tbody.innerHTML = rows.map(s => {
          let badgeClass = 'st-draft';
          if (s.status === 'SUBMITTED') badgeClass = 'st-submitted';
          if (s.status === 'APPROVED') badgeClass = 'st-approved';
          if (s.status === 'QUOTED') badgeClass = 'st-quoted';
          if (s.status === 'REJECTED') badgeClass = 'st-rejected';
          if (s.status === 'REVISION') badgeClass = 'st-revision';

          const rev = Number(s.total_revenue_xaf ?? s.rev ?? 0);
          const margin = Number(s.total_margin_xaf ?? s.margin ?? 0);
          const pct = rev > 0 ? ((margin / rev) * 100) : 0;

          let action = `<button class="btn btn-sm btn-light border" onclick="openSim('${s.simulation_ref}')">View</button>`;
          if (currentRole === 'SALES') {
            if (['DRAFT','REJECTED','REVISION'].includes(s.status)) {
              action = `<button class="btn btn-sm btn-outline-dark fw-bold" onclick="openSim('${s.simulation_ref}')">Edit</button>`;
            }
          } else if (currentRole === 'MANAGEMENT') {
            if (s.status === 'SUBMITTED') {
              action = `<button class="btn btn-sm btn-warning fw-bold text-dark" onclick="openSim('${s.simulation_ref}')">Review</button>`;
            }
          }

          return `
            <tr data-status="${s.status}" onclick="openSim('${s.simulation_ref}')">
              <td class="ps-4 font-mono fw-bold text-primary" style="font-size:0.8rem">${s.simulation_ref}</td>
              <td class="small text-muted">${s.costing_ref || s.costing_id || '-'}</td>
              <td class="fw-bold">${s.client_name || s.client || '-'}</td>
              <td class="text-end font-mono">${money(rev)}</td>
              <td class="text-end fw-bold ${margin>=0?'text-success':'text-danger'} font-mono">${money(margin)}</td>
              <td><span class="badge ${pct > 20 ? 'bg-success' : 'bg-warning text-dark'}">${pct.toFixed(1)}%</span></td>
              <td><span class="status-badge ${badgeClass}">${s.status}</span></td>
              <td class="text-end pe-4" onclick="event.stopPropagation()">${action}</td>
            </tr>
          `;
        }).join('');

        renderPager();
      } catch (err) {
        console.error(err);
        // minimal UI impact; keep current table if API fails
      }
    }

    function renderPager(){
      const total = LIST_STATE.total || 0;
      const page = LIST_STATE.page || 1;
      const per = LIST_STATE.per_page || 10;
      const pages = Math.max(1, Math.ceil(total / per));

      const start = total ? ((page - 1) * per + 1) : 0;
      const end = Math.min(total, page * per);

      document.getElementById('pager-label').innerText =
        total ? `Showing ${start}-${end} of ${total} Records` : 'Showing 0 Records';

      const ul = document.getElementById('pager');
      const mk = (label, p, disabled=false, active=false) => `
        <li class="page-item ${disabled?'disabled':''} ${active?'active':''}">
          <a class="page-link ${active?'bg-dark border-dark':''} ${active?'':'text-dark'}"
             href="#"
             onclick="event.preventDefault(); ${disabled?'':'gotoPage('+p+')'}">${label}</a>
        </li>`;

      let html = '';
      html += mk('Prev', page-1, page<=1);

      // compact page list
      const windowSize = 3;
      const from = Math.max(1, page - windowSize);
      const to = Math.min(pages, page + windowSize);

      if (from > 1) html += mk('1', 1, false, page===1);
      if (from > 2) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;

      for (let p = from; p <= to; p++) html += mk(String(p), p, false, p===page);

      if (to < pages-1) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
      if (to < pages) html += mk(String(pages), pages, false, page===pages);

      html += mk('Next', page+1, page>=pages);

      ul.innerHTML = html;
    }

    function gotoPage(p){
      const total = LIST_STATE.total || 0;
      const per = LIST_STATE.per_page || 10;
      const pages = Math.max(1, Math.ceil(total / per));
      LIST_STATE.page = Math.max(1, Math.min(pages, p));
      renderDashboard(true);
    }

    // --- Unlock to revision (MANAGEMENT only) ---
    async function unlockSim() {
      if(!currentSim) return;
      if(!confirm("MANAGER OVERRIDE\n\nUnlock this quote?\nThis will set status to REVISION and allow editing.")) return;

      try {
        await apiJson(`${API_BASE}/unlock.php`, {
          method: 'POST',
          body: JSON.stringify({ simulation_ref: currentSim.simulation_ref })
        });
        await openSim(currentSim.simulation_ref, true);
        await renderDashboard(true);
      } catch (err) {
        alert(err.message || 'Unlock failed');
      }
    }

    // --- Load approved costings selector ---
   async function loadApprovedCostingsOnce() {
  if (window.__approvedCostingsLoaded) return;

  const sel = document.getElementById('costing-selector');
  sel.innerHTML = `<option value="">Select Approved Costing...</option>`;


  const res = await apiJson('/administration/api/marginpricing/get-approved-costings.php', {
    method: 'GET'
  });

  for (const c of (res.items || [])) {
    const label = `${c.costing_ref} | ${c.client_name_cached} | ${c.operations_file_reference} | ${Number(c.total_ttc || 0).toLocaleString()} XAF`;
    const opt = document.createElement('option');
    opt.value = c.costing_id;
    opt.textContent = label;
    sel.appendChild(opt);
  }

  window.__approvedCostingsLoaded = true;
}


    // --- Load financial dictionary datalist ---
    async function loadFinancialDictionaryOnce(){
      const dl = document.getElementById('fin-dict');
      dl.innerHTML = '';

      const data = await apiJson(`${API_BASE}/financial-dictionary.php`, { method: 'GET', headers: {} });
      // expected: {ok:true, items:[{code, name_en}]}
      FINANCIAL_DICTIONARY = data.items || [];

      FINANCIAL_DICTIONARY.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.name_en;
        opt.dataset.code = item.code;
        dl.appendChild(opt);
      });
    }

    // --- Open simulation (API) ---
    async function openSim(simRef, forceReload = false) {
      riskJustification = "";
      document.getElementById('risk-warning').classList.add('d-none');

      await loadApprovedCostingsOnce();
      await loadFinancialDictionaryOnce();

      if (simRef === 'new') {
        // backend creates a draft simulation shell and returns ref
        try {
          const data = await apiJson(`${API_BASE}/create.php`, {
            method: 'POST',
            body: JSON.stringify({}) // backend will infer actor + role from session
          });

          // expected: {ok:true, simulation:{...}}
          const sim = data.simulation;
          setupSimUI(sim, [], true);
          bsOffcanvas.show();
          await renderDashboard(true);
          return;
        } catch (err) {
          alert(err.message || 'Failed to create simulation');
          return;
        }
      }

      try {
        const data = await apiJson(`${API_BASE}/get.php?simulation_ref=${encodeURIComponent(simRef)}`, { method: 'GET', headers: {} });
        // expected: {ok:true, simulation:{...}, lines:[...], costing?:{...}, risk_justification?:string}
        const sim = data.simulation;
        const lines = data.lines || [];
        riskJustification = data.risk_justification || sim.risk_justification || "";

        // If backend included costing snapshot, merge into cache
        if (data.costing && data.costing.costing_id) {
          APPROVED_COSTINGS[data.costing.costing_id] = data.costing;
        }

        setupSimUI(sim, lines, false);
        bsOffcanvas.show();
      } catch (err) {
        alert(err.message || 'Failed to load simulation');
      }
    }

    function setupSimUI(sim, lines, isNew) {
      currentSim = {
        ...sim,
        simulation_ref: sim.simulation_ref || sim.id || sim.sim_ref || simRefSafe(sim)
      };

      currentLines = (lines || []).map(l => ({
        line_id: l.line_id || l.id || null,
        code: l.code || '',
        desc: l.description || l.desc || '',
        cost: Number(l.cost_xaf ?? l.cost ?? 0),
        sell: Number(l.selling_xaf ?? l.sell ?? 0),
        remarks: l.quote_remarks || l.remarks || '',
        printOnQuote: (l.client_facing ?? l.print_on_quote ?? l.printOnQuote ?? true) !== false,
        applyVat: (l.apply_vat ?? l.applyVat ?? false) === true,
        isAdHoc: (l.is_adhoc ?? l.isAdHoc ?? false) === true,
      }));

      // If backend returns empty lines but has costing link, load cost lines (client-side fallback)
      if ((!currentLines || currentLines.length === 0) && currentSim.costing_id) {
        const c = APPROVED_COSTINGS[currentSim.costing_id];
        if (c && Array.isArray(c.lines) && c.lines.length) {
          currentLines = c.lines.map(x => ({
            line_id: null,
            code: x.code || x.item_code || '',
            desc: x.desc || x.description || '',
            cost: Number(x.cost_xaf ?? x.cost ?? 0),
            sell: Math.ceil(Number(x.cost_xaf ?? x.cost ?? 0) * 1.3),
            remarks: '',
            printOnQuote: true,
            applyVat: false,
            isAdHoc: false,
          }));
        }
      }

      // Header
      document.getElementById('sim-ref-display').innerText = currentSim.simulation_ref;
      const badge = document.getElementById('sim-status-badge');
      badge.innerText = currentSim.status || 'DRAFT';

      const statusKey = String(currentSim.status || 'DRAFT').toLowerCase();
      badge.className = `badge st-${statusKey}`;

      // Costing selector
      const sel = document.getElementById('costing-selector');
      if (isNew || !currentSim.costing_id) {
        sel.value = "";
        sel.disabled = false;
        resetSSDC();
      } else {
        sel.value = currentSim.costing_id;
        sel.disabled = true; // business rule: once linked, lock
        renderSSDC(currentSim.costing_id);
      }

      // Locking rules
      isLocked = (currentSim.status === 'APPROVED' || currentSim.status === 'QUOTED');
      if (currentRole === 'SALES' && currentSim.status === 'SUBMITTED') isLocked = true;
      if (currentSim.status === 'REVISION') isLocked = false;

      renderLines();
      updateFooter();
    }

    function simRefSafe(sim){
      return sim?.simulation_ref || sim?.id || sim?.simulationRef || 'SLAS-MA-XXXX';
    }

    // --- Link costing: pull from cache (backend populated selector) ---
   async function loadCostingData(costingId) {
  if (!costingId) return;

  // call the new API
  const data = await apiJson(`${API_BASE}/get-costing-ssdc.php?costing_id=${encodeURIComponent(costingId)}`, {
    method: 'GET'
  });

  // update cache in the exact structure renderSSDC() expects
  APPROVED_COSTINGS[costingId] = {
    costing_id: data.header.costing_id,
    costing_ref: data.header.costing_ref,
    operations_file_reference: data.header.operations_file_reference,
    client_id: data.header.client_id,
    client_name: data.header.client_name,
    service_type: data.header.service_type,
    route_label: data.ssdc.route_label,
    ssdc: {
      eta: data.ssdc.eta,
      weight: data.ssdc.weight,
      packages: data.ssdc.packages,
      commodity: data.ssdc.commodity,
      marks: data.ssdc.marks
    },
    lines: (data.lines || []).map(l => ({
      code: l.item_code,
      description: l.item_description,
      cost_xaf: Number(l.total_ttc || 0) // or compute from unit_cost*qty+vat as your costing_line schema dictates
    }))
  };

  renderSSDC(costingId);

  // set simulation lines from costing lines (adapt to your selling logic)
  currentLines = (data.lines || []).map(l => ({
    line_id: null,
    code: l.item_code || '',
    desc: l.item_description || '',
    cost: Number(l.total_ttc || 0),
    sell: Math.ceil(Number(l.total_ttc || 0) * 1.3),
    remarks: '',
    printOnQuote: true,
    applyVat: false,
    isAdHoc: false,
  }));

  renderLines();
}

    function renderSSDC(costingId) {
      const c = APPROVED_COSTINGS[costingId];
      if(!c) return;

      document.getElementById('ssdc-client').innerText = c.client_name || c.client_id || '-';
      document.getElementById('ssdc-service').innerText = c.service_type || c.service || '-';
      document.getElementById('ssdc-fileref').innerText = c.operations_file_reference || c.fileRef || '-';
      document.getElementById('ssdc-costref').innerText = c.costing_ref || c.costing_id || '-';
      document.getElementById('ssdc-route').innerText = c.route_label || c.route || '-';

      const ssdc = c.ssdc || {};
      document.getElementById('ssdc-eta').innerText = ssdc.eta || '-';
      document.getElementById('ssdc-wgt').innerText = ssdc.weight || ssdc.wgt || '-';
      document.getElementById('ssdc-pkg').innerText = ssdc.packages || ssdc.pkg || '-';
      document.getElementById('ssdc-comm').innerText = ssdc.commodity || ssdc.comm || '-';
      document.getElementById('ssdc-marks').innerText = ssdc.marks || '-';
    }

    function resetSSDC() {
      ['client','service','fileref','costref','route','eta','wgt','pkg','comm','marks'].forEach(id => {
        const el = document.getElementById(`ssdc-${id}`);
        if (el) el.innerText = '-';
      });
    }

    function handleEnter(e, idx, field) {
      if (e.key === 'Enter') {
        e.preventDefault();

        // 1. Commit the value to the model immediately
        // (We do this manually here because we are about to destroy/re-render the input)
        const val = e.target.value;
        if (field === 'sell') currentLines[idx].sell = parseFloat(val) || 0;
        if (field === 'note') currentLines[idx].remarks = val; // 'note' maps to remarks in your data model

        // 2. Re-render the table to update margins/KPIs
        renderLines();

        // 3. Determine the next target (Next line, same column)
        let nextId = '';
        if (idx + 1 < currentLines.length) {
          if (field === 'sell') nextId = `sell-${idx + 1}`;
          if (field === 'note') nextId = `note-${idx + 1}`;
        } else {
          // Last row: Stay on the current cell
          if (field === 'sell') nextId = `sell-${idx}`;
          if (field === 'note') nextId = `note-${idx}`;
        }

        // 4. Set Focus
        const nextEl = document.getElementById(nextId);
        if (nextEl) {
          nextEl.focus();
          // Optional: Select all text like Excel does
          if (nextEl.select) nextEl.select();
        }
      }
    }

    function addAdHocLine() {
      currentLines.push({
        line_id: null,
        code: '',
        desc: '',
        cost: 0,
        sell: 0,
        remarks: '',
        isAdHoc: true,
        printOnQuote: true,
        applyVat: false
      });
      renderLines();
    }

    function updateAdHocDesc(idx, val) {
      currentLines[idx].desc = val;
      const match = FINANCIAL_DICTIONARY.find(f => f.name_en === val);
      if(match) currentLines[idx].code = match.code;
      renderLines();
    }

    function renderLines() {
      const tbody = document.getElementById('sim-lines-body');
      let tCost = 0,
        tRev = 0,
        negativeFound = false;

      tbody.innerHTML = (currentLines || []).map((l, i) => {
        const cost = Number(l.cost || 0);
        const sell = Number(l.sell || 0);
        const margin = sell - cost;
        const pct = sell > 0 ? (margin / sell * 100) : 0;

        tCost += cost;
        tRev += sell;
        if (margin < 0) negativeFound = true;

        let kpiClass = 'obs-fair';
        let kpiText = 'FAIR';
        if (pct < 10) {
          kpiClass = 'obs-poor';
          kpiText = 'POOR';
        } else if (pct >= 35) {
          kpiClass = 'obs-excel';
          kpiText = 'EXCEL';
        } else if (pct >= 20) {
          kpiClass = 'obs-good';
          kpiText = 'GOOD';
        }

        const disabled = isLocked ? 'disabled' : '';
        const vatClass = l.applyVat ? 'active-vat' : '';
        const eyeClass = l.printOnQuote ? 'active-eye' : 'inactive-eye';
        const eyeIcon = l.printOnQuote ? 'fa-eye' : 'fa-eye-slash';

        let descHtml = '';
        if (l.isAdHoc) {
          descHtml = `
             <input type="text" class="form-control form-control-sm smart-input mb-1" list="fin-dict"
               value="${escapeHtml(l.desc || '')}" onchange="updateAdHocDesc(${i}, this.value)" placeholder="Search Dictionary..." ${disabled}>
             <div class="text-muted font-mono small">${escapeHtml(l.code || 'NO-CODE')}</div>
           `;
        } else {
          descHtml = `
             <div class="fw-bold text-dark">${escapeHtml(l.desc || '')}</div>
             <div class="text-muted font-mono" style="font-size:0.7rem">${escapeHtml(l.code || '')}</div>
           `;
        }

        // CHANGED: oninput -> onchange for 'sell' and 'remarks' inputs
        return `
           <tr>
             <td class="text-muted small align-middle">${i+1}</td>
             <td class="align-middle text-center">
               <button class="toggle-btn ${eyeClass}" onclick="toggleLineProp(${i}, 'printOnQuote')" ${disabled} title="Show on Quote">
                 <i class="fa-solid ${eyeIcon}"></i>
               </button>
             </td>
             <td class="small">${descHtml}</td>
             <td class="text-end font-mono text-muted small align-middle">
               ${money(cost)}
               ${l.isAdHoc ? '<i class="fa-solid fa-lock ms-1 text-muted" style="font-size:0.6rem"></i>' : ''}
             </td>
             <td class="p-1 align-middle">
               <input type="number" class="form-control form-control-sm input-sell" id="sell-${i}"
                 value="${sell}" onchange="updateLine(${i}, 'sell', this.value)"
                 onkeydown="handleEnter(event, ${i}, 'sell')" ${disabled}>
             </td>
             <td class="align-middle text-center">
               <button class="toggle-btn ${vatClass}" onclick="toggleLineProp(${i}, 'applyVat')" ${disabled} title="Apply VAT">
                 <span style="font-size:0.6rem; font-weight:800;">VAT</span>
               </button>
             </td>
             <td class="text-end font-mono fw-bold small align-middle ${margin<0?'text-danger':'text-success'}">
               ${money(margin)}
             </td>
             <td class="text-center align-middle">
               <span class="obs-pill ${kpiClass}">${kpiText} (${pct.toFixed(0)}%)</span>
             </td>
             <td class="p-1 align-middle">
               <input type="text" class="form-control form-control-sm smart-input" id="note-${i}" placeholder="Notes for client..."
                 value="${escapeHtml(l.remarks || '')}" onchange="updateLine(${i}, 'remarks', this.value)"
                 onkeydown="handleEnter(event, ${i}, 'note')" ${disabled}>
             </td>
           </tr>
         `;
      }).join('');

      updateSnapshot(tCost, tRev);

      const riskEl = document.getElementById('risk-warning');
      if (negativeFound) {
        riskEl.classList.remove('d-none');
        if (!riskJustification && !isLocked && currentRole === 'SALES') promptRiskJustification();
      } else {
        riskEl.classList.add('d-none');
      }
    }

    function escapeHtml(s){
      return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
    }

    function updateLine(idx, field, val) {
      if(field === 'sell') currentLines[idx].sell = parseFloat(val) || 0;
      if(field === 'remarks') currentLines[idx].remarks = val;
      if(field === 'sell') renderLines();
    }

    function toggleLineProp(idx, prop) {
      if(isLocked) return;
      currentLines[idx][prop] = !currentLines[idx][prop];
      renderLines();
    }

    function updateSnapshot(cost, rev) {
      const margin = rev - cost;
      const pct = rev > 0 ? (margin/rev*100) : 0;

      // keep on currentSim for footer + submit payload
      if (currentSim) {
        currentSim.total_cost_xaf = cost;
        currentSim.total_revenue_xaf = rev;
        currentSim.total_margin_xaf = margin;
      }

      const badge = document.getElementById('global-margin-badge');
      const pctDisplay = document.getElementById('global-margin-pct');
      pctDisplay.innerText = pct.toFixed(1) + "%";

      let bClass = 'bg-secondary', bText = 'WAITING';
      if(rev > 0) {
        if(pct < 10) { bClass = 'bg-danger'; bText = 'CRITICAL'; }
        else if(pct < 20) { bClass = 'bg-warning text-dark'; bText = 'LOW'; }
        else { bClass = 'bg-success'; bText = 'HEALTHY'; }
      }
      badge.innerHTML = `<span class="badge ${bClass} px-3 py-2">${bText}</span>`;

      const max = Math.max(cost, rev, Math.abs(margin)) || 100;
      const hCost = (cost/max)*100;
      const hRev  = (rev/max)*100;
      const hProf = (Math.max(0, margin)/max)*100;

      document.getElementById('chart-cost-bar').style.height = `${hCost}%`;
      document.getElementById('chart-rev-bar').style.height  = `${hRev}%`;
      document.getElementById('chart-prof-bar').style.height = `${hProf}%`;

      document.getElementById('chart-cost-val').innerText = (cost/1000000).toFixed(1)+'M';
      document.getElementById('chart-rev-val').innerText  = (rev/1000000).toFixed(1)+'M';
      document.getElementById('chart-prof-val').innerText = (margin/1000000).toFixed(1)+'M';

      document.getElementById('footer-count').innerText = (currentLines || []).length;
    }

    function updateFooter() {
      const container = document.getElementById('footer-actions');
      let html = '';

      if (!currentSim) { container.innerHTML = ''; return; }

      if (currentSim.status === 'QUOTED') {
        html += `<button class="btn btn-success fw-bold btn-sm me-2" onclick="generatePDF('QUOTE')">
                  <i class="fa-solid fa-file-pdf me-2"></i>Download PDF
                </button>`;
        if (currentRole === 'MANAGEMENT') {
          html += `<button class="btn btn-outline-warning fw-bold btn-sm" onclick="unlockSim()">
                    <i class="fa-solid fa-lock-open me-2"></i>Unlock to Revision
                  </button>`;
        }
      } else if (currentSim.status === 'APPROVED') {
        html += `<button class="btn btn-dark fw-bold btn-sm" onclick="openQuoteSetup()">
                  <i class="fa-solid fa-file-invoice-dollar me-2"></i>Generate Quote
                </button>`;
      } else if (currentRole === 'SALES') {
        if (!isLocked) {
          html += `<button class="btn btn-outline-dark fw-bold btn-sm me-2" onclick="saveDraft()">
                    <i class="fa-regular fa-floppy-disk me-2"></i>Save
                  </button>`;
          html += `<button class="btn btn-primary fw-bold btn-sm" onclick="submitApproval()">
                    <i class="fa-solid fa-paper-plane me-2"></i>Submit
                  </button>`;
        } else {
          html += `<span class="text-muted fst-italic me-2"><i class="fa-solid fa-lock me-1"></i> Locked for review</span>`;
        }
      } else if (currentRole === 'MANAGEMENT') {
        if (currentSim.status === 'SUBMITTED') {
          html += `<button class="btn btn-danger fw-bold btn-sm me-2" onclick="rejectSim()">
                    <i class="fa-solid fa-ban me-2"></i>Reject
                  </button>`;
          html += `<button class="btn btn-success fw-bold btn-sm" onclick="approveSim()">
                    <i class="fa-solid fa-check me-2"></i>Approve
                  </button>`;
        }
      }

      container.innerHTML = html;
    }

    function promptRiskJustification() {
      const modal = new bootstrap.Modal('#justificationModal');
      modal.show();
    }

    async function saveJustification() {
      const txt = document.getElementById('risk-reason').value;
      if(txt.length < 5) { alert("Please provide a valid reason."); return; }
      riskJustification = txt;

      // persist immediately to backend (so management sees it)
      try {
        await apiJson(`${API_BASE}/save-justification.php`, {
          method: 'POST',
          body: JSON.stringify({ simulation_ref: currentSim.simulation_ref, risk_justification: txt })
        });
      } catch (err) {
        // do not block user; but show warning
        console.warn(err);
      }

      bootstrap.Modal.getInstance(document.getElementById('justificationModal')).hide();
    }

    // --- Save draft (API) ---
    async function saveDraft() {
      if (!currentSim) return;

      document.getElementById('autosave-status').innerHTML =
        '<span class="text-primary"><i class="fa-solid fa-spinner fa-spin"></i> Saving...</span>';

      try {
        const payload = {
          simulation_ref: currentSim.simulation_ref,
          costing_id: currentSim.costing_id || null,
          status: currentSim.status || 'DRAFT',
          totals: {
            total_cost_xaf: Number(currentSim.total_cost_xaf || 0),
            total_revenue_xaf: Number(currentSim.total_revenue_xaf || 0),
            total_margin_xaf: Number(currentSim.total_margin_xaf || 0),
          },
          risk_justification: riskJustification || null,
          lines: (currentLines || []).map(l => ({
            line_id: l.line_id,
            code: l.code,
            description: l.desc,
            cost_xaf: Number(l.cost || 0),
            selling_xaf: Number(l.sell || 0),
            quote_remarks: l.remarks || '',
            client_facing: l.printOnQuote !== false,
            apply_vat: l.applyVat === true,
            is_adhoc: l.isAdHoc === true,
          }))
        };

        await apiJson(`${API_BASE}/save.php`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        document.getElementById('autosave-status').innerHTML =
          '<span class="text-success"><i class="fa-solid fa-check"></i> Saved</span>';

        await renderDashboard(true);
      } catch (err) {
        document.getElementById('autosave-status').innerHTML =
          '<span class="text-danger"><i class="fa-solid fa-triangle-exclamation"></i> Save failed</span>';
        alert(err.message || 'Save failed');
      }
    }

    // --- Submit / Approve / Reject (API) ---
    async function submitApproval() {
      if (!currentSim) return;
      if (!currentSim.costing_id) { alert('Link an approved costing first.'); return; }

      if(document.getElementById('risk-warning').classList.contains('d-none') === false && !riskJustification) {
        alert("Cannot submit: Negative margins require justification.");
        promptRiskJustification();
        return;
      }

      if(!confirm("Submit for Management Approval?")) return;

      try {
        await saveDraft();
        await apiJson(`${API_BASE}/submit.php`, {
          method: 'POST',
          body: JSON.stringify({ simulation_ref: currentSim.simulation_ref })
        });

        await openSim(currentSim.simulation_ref, true);
        await renderDashboard(true);
        alert("Submitted successfully.");
      } catch (err) {
        alert(err.message || 'Submit failed');
      }
    }

    async function rejectSim() {
      if (!currentSim) return;
      const reason = prompt("Enter rejection reason:");
      if(reason === null) return;

      try {
        await apiJson(`${API_BASE}/reject.php`, {
          method: 'POST',
          body: JSON.stringify({ simulation_ref: currentSim.simulation_ref, reason })
        });

        await openSim(currentSim.simulation_ref, true);
        await renderDashboard(true);
      } catch (err) {
        alert(err.message || 'Reject failed');
      }
    }

    async function approveSim() {
      if (!currentSim) return;
      if(!confirm("Approve and Lock this Simulation?")) return;

      try {
        await apiJson(`${API_BASE}/approve.php`, {
          method: 'POST',
          body: JSON.stringify({ simulation_ref: currentSim.simulation_ref })
        });

        await openSim(currentSim.simulation_ref, true);
        await renderDashboard(true);
      } catch (err) {
        alert(err.message || 'Approve failed');
      }
    }

    // --- Quote modal ---
    function openQuoteSetup() {
      const modal = new bootstrap.Modal('#quoteSetupModal');
      modal.show();
    }

    function toggleFxRate(curr) {
      const inp = document.getElementById('q-fx-rate');
      if(curr === 'XAF') { inp.value = "1.00"; inp.disabled = true; }
      else { inp.disabled = false; inp.value = ""; inp.focus(); }
    }

    /**
     * PDF generator stays client-side for now.
     * Backend will later record:
     * - generated_at, quotation_id, quotation_amount (TTC) and status QUOTED
     */
    async function generatePDF(type) {
      const setupModal = bootstrap.Modal.getInstance(document.getElementById('quoteSetupModal'));
      if(setupModal) setupModal.hide();

      const isQuote = (type === 'QUOTE');
      if (!currentSim) return;
      if (isQuote && (!currentSim.status || currentSim.status !== 'APPROVED') && currentRole !== 'ADMIN') {
        // admin can test; enforce later in backend anyway
      }

      const config = {
        validity: isQuote ? document.getElementById('q-validity').value : 'N/A',
        terms: isQuote ? document.getElementById('q-terms').value : 'N/A',
        currency: isQuote ? document.getElementById('q-currency').value : 'XAF',
        fx: parseFloat(document.getElementById('q-fx-rate').value) || 1,
        bank: isQuote ? document.getElementById('q-bank-custom').value : '',
        headerNote: isQuote ? document.getElementById('q-header-note').value : ''
      };

      const costing = APPROVED_COSTINGS[currentSim.costing_id] || null;
      const clientName = costing?.client_name || document.getElementById('ssdc-client').innerText || 'Unknown';
      const client = {
        name: clientName,
        address: costing?.client_address || 'Unknown',
        taxId: costing?.client_niu || 'N/A',
        contact: costing?.client_contact || 'N/A',
        email: costing?.client_email || 'N/A'
      };

      const shipment = {
        route: costing?.route_label || document.getElementById('ssdc-route').innerText || '-',
        eta: (costing?.ssdc?.eta || document.getElementById('ssdc-eta').innerText || '-'),
        weight: (costing?.ssdc?.weight || document.getElementById('ssdc-wgt').innerText || '-'),
        packages: (costing?.ssdc?.packages || document.getElementById('ssdc-pkg').innerText || '-'),
        commodity: (costing?.ssdc?.commodity || document.getElementById('ssdc-comm').innerText || '-'),
        marks: (costing?.ssdc?.marks || document.getElementById('ssdc-marks').innerText || '-'),
        pod: (costing?.pod || "Douala, CMR")
      };

      const printLines = (currentLines || [])
        .filter(l => l.printOnQuote !== false && Number(l.sell||0) > 0)
        .map(l => {
          const qty = 1;
          const unitPrice = Number(l.sell||0) / config.fx;
          const totalHT = qty * unitPrice;
          const vatRate = l.applyVat ? 0.1925 : 0;
          const vatAmt = totalHT * vatRate;
          const totalTTC = totalHT + vatAmt;

          return {
            code: l.code, desc: l.desc, qty,
            unitPrice, totalHT, vat: vatAmt, totalTTC,
            remarks: l.remarks
          };
        });

      const sumHT = printLines.reduce((acc, l) => acc + l.totalHT, 0);
      const sumVAT = printLines.reduce((acc, l) => acc + l.vat, 0);
      const sumTTC = sumHT + sumVAT;
      const totalWords = toWords(Math.floor(sumTTC)) + (config.currency === 'USD' ? ' DOLLARS' : (config.currency === 'EUR' ? ' EUROS' : ' XAF'));

      // Build pages
      const container = document.getElementById('print-container');
      container.innerHTML = '';

      const MAX_LINES = 14;
      const totalPages = Math.ceil(printLines.length / MAX_LINES) || 1;

      // Quote reference: let backend assign; for UI, show placeholder until backend response
      let displayRef = currentSim.quote_ref || currentSim.quoteRef || (isQuote ? 'SLAS-QU-XXXX' : currentSim.simulation_ref);

      for(let p = 1; p <= totalPages; p++) {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'a4-page';

        let content = '';

        content += `
          <div class="print-header-row">
            <div class="ph-logo"><img src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png" alt="Smart LS Logo"></div>
            <div class="ph-company">
              <h1>Smart Logistics And Services Ltd</h1>
              <div>1030, Avenue Douala Manga Bell, Bali</div>
              <div>PO Box 5120, Douala, Cameroon</div>
              <div>+237 233 420 281 | info@smartls.cm</div>
            </div>
          </div>
        `;

        if(p === 1) {
          content += `
            <div class="info-grid-wrapper">
              <div class="info-card">
                <div class="info-card-head">Bill To / Client</div>
                <div class="info-card-body">
                  <div class="fw-bold">${escapeHtml(client.name)}</div>
                  <div class="info-line"><strong>Address:</strong> <span>${escapeHtml(client.address)}</span></div>
                  <div class="info-line"><strong>Attn:</strong> <span>${escapeHtml(client.contact)}</span></div>
                  <div class="info-line"><strong>Email:</strong> <span>${escapeHtml(client.email)}</span></div>
                  <div class="info-line"><strong>NIU:</strong> <span>${escapeHtml(client.taxId)}</span></div>
                </div>
              </div>
              <div class="info-card">
                <div class="info-card-head">Shipment Details</div>
                <div class="info-card-body">
                  <div class="info-line"><strong>Route:</strong> <span>${escapeHtml(shipment.route)}</span></div>
                  <div class="info-line"><strong>POD:</strong> <span>${escapeHtml(shipment.pod)}</span></div>
                  <div class="info-line"><strong>ETA:</strong> <span>${escapeHtml(shipment.eta)}</span></div>
                  <div class="info-line"><strong>Weight:</strong> <span>${escapeHtml(shipment.weight)}</span></div>
                  <div class="info-line"><strong>Vol/Pkg:</strong> <span>${escapeHtml(shipment.packages)}</span></div>
                  <div class="info-line"><strong>Comm:</strong> <span>${escapeHtml(shipment.commodity)}</span></div>
                  <div class="info-line"><strong>Marks:</strong> <span>${escapeHtml(shipment.marks)}</span></div>
                </div>
              </div>
              <div class="info-card">
                <div class="info-card-head">${isQuote ? 'Quotation Info' : 'Analysis Info'}</div>
                <div class="info-card-body">
                  <div class="info-line"><strong>Number:</strong> <span>${escapeHtml(displayRef)}</span></div>
                  <div class="info-line"><strong>Date:</strong> <span>${new Date().toLocaleDateString()}</span></div>
                  <div class="info-line"><strong>Terms:</strong> <span>${escapeHtml(config.terms)}</span></div>
                  <div class="info-line"><strong>Valid:</strong> <span>${escapeHtml(config.validity)}</span></div>
                  <div class="info-line"><strong>Ref:</strong> <span>${escapeHtml(costing?.operations_file_reference || costing?.fileRef || '-')}</span></div>
                </div>
              </div>
            </div>
          `;
        } else {
          content += `<div style="height:20px; font-size:0.7rem; border-bottom:1px dashed #ccc; margin-bottom:10px;">Continuation Sheet - Page ${p} of ${totalPages} - Ref: ${escapeHtml(displayRef)}</div>`;
        }

        content += `<div class="print-table-wrapper"><table class="print-table">
          <thead>
            <tr>
              <th style="width:10%;">Code</th>
              <th style="width:35%;">Description</th>
              <th style="width:5%; text-align:center;">Qty</th>
              <th style="text-align:right;">Unit Price</th>
              <th style="text-align:right;">Total HT</th>
              <th style="text-align:right;">VAT</th>
              <th style="text-align:right;">Total TTC</th>
            </tr>
          </thead>
          <tbody>`;

        const startIdx = (p-1) * MAX_LINES;
        const pageLines = printLines.slice(startIdx, startIdx + MAX_LINES);

        pageLines.forEach(l => {
          content += `
            <tr>
              <td>${escapeHtml(l.code || '')}</td>
              <td>${escapeHtml(l.desc || '')}</td>
              <td style="text-align:center;">${l.qty}</td>
              <td style="text-align:right;">${l.unitPrice.toLocaleString(undefined, {minimumFractionDigits:0})}</td>
              <td style="text-align:right;">${l.totalHT.toLocaleString(undefined, {minimumFractionDigits:0})}</td>
              <td style="text-align:right;">${l.vat.toLocaleString(undefined, {minimumFractionDigits:0})}</td>
              <td style="text-align:right; font-weight:700;">${l.totalTTC.toLocaleString(undefined, {minimumFractionDigits:0})}</td>
            </tr>
          `;
        });

        content += `</tbody></table></div>`;

        if(p === totalPages) {
          content += `
            <div class="after-table-container">
              <div class="ats-left">
                <div class="amt-words"><strong>Amount in words:</strong> ${escapeHtml(totalWords)}</div>
                <div class="remarks-box">
                  <strong>Remarks / Conditions:</strong><br>
                  ${escapeHtml(config.headerNote || 'Subject to standard trading conditions. Rate valid for non-hazardous cargo unless specified.')}
                </div>
              </div>
              <div class="ats-right">
                <table class="totals-box">
                  <tr><td>Total H.T.</td><td style="text-align:right;">${sumHT.toLocaleString(undefined, {minimumFractionDigits:0})}</td></tr>
                  <tr><td>Total VAT</td><td style="text-align:right;">${sumVAT.toLocaleString(undefined, {minimumFractionDigits:0})}</td></tr>
                  <tr><td><strong>NET PAYABLE (${escapeHtml(config.currency)})</strong></td><td style="text-align:right;">${sumTTC.toLocaleString(undefined, {minimumFractionDigits:0})}</td></tr>
                </table>

                <div class="md-signature-block">
                  ${ (isQuote && (currentSim.status === 'APPROVED' || currentSim.status === 'QUOTED')) ?
                    `<div class="md-sig-title">SMART LOGISTICS MANAGEMENT</div>
                     <img src="https://i.ibb.co/m58kKZdd/signature-dg-smart.png" class="md-sig-img" alt="Signed">` :
                    ''
                  }
                </div>
              </div>
            </div>
          `;
        }

        content += `
          <div class="print-footer">
            <div class="pf-row">
              <span><strong>NIU:</strong> M0421160335800</span>
              <span><strong>RC:</strong> 357-0114542</span>
            </div>
            <div class="pf-row">
              <span><strong>Bank:</strong> AFRILAND FIRST BANK</span>
              <span><strong>Account:</strong> 10005-0006-107018411001-93</span>
            </div>
            <div style="font-size:0.55rem; color:#999; margin-top:4px;">
              Page ${p} of ${totalPages} | Generated by Smart LS Enterprise System | ${new Date().toLocaleString()}
            </div>
          </div>
        `;

        pageDiv.innerHTML = content;
        container.appendChild(pageDiv);
      }

      // If QUOTE, ask backend to record quotation + set status QUOTED
      if(isQuote) {
        try {
          const quotePayload = {
            simulation_ref: currentSim.simulation_ref,
            validity: config.validity,
            terms: config.terms,
            currency: config.currency,
            fx_rate: config.fx,
            bank_details: config.bank,
            header_note: config.headerNote,
            total_ht: sumHT,
            total_vat: sumVAT,
            total_ttc: sumTTC
          };
          const resp = await apiJson(`${API_BASE}/quote.php`, {
            method: 'POST',
            body: JSON.stringify(quotePayload)
          });
          // expected: {ok:true, quotation:{quotation_id, quotation_ref, amount_ttc, generated_at}, simulation:{...}}
          if (resp.quotation?.quotation_ref) {
            currentSim.quote_ref = resp.quotation.quotation_ref;
          }
          if (resp.simulation) currentSim = resp.simulation;
          await renderDashboard(true);
          updateFooter();
        } catch (err) {
          // Do not block printing; but warn that backend record failed
          console.warn(err);
          alert('PDF generated, but quotation record failed to save in backend: ' + (err.message || 'Unknown error'));
        }
      }

      const printModal = new bootstrap.Modal('#printModal');
      printModal.show();
    }

    function toWords(n) {
      const string = n.toString(),
        units = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
      const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
      const scales = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion'];

      if (n === 0) return 'zero';

      let start = string.length;
      let chunks = [];
      while (start > 0) {
        const end = start;
        chunks.push(string.slice((start = Math.max(0, start - 3)), end));
      }

      let chunksLen = chunks.length;
      if (chunksLen > scales.length) return '';

      let words = [], word;

      for (let i = 0; i < chunksLen; i++) {
        let chunk = parseInt(chunks[i]);
        if (chunk) {
          let ints = chunks[i].split('').reverse().map(parseFloat);
          if (ints[1] === 1) ints[0] += 10;
          if ((word = scales[i])) words.push(word);
          if ((word = units[ints[0]])) words.push(word);
          if ((word = tens[ints[1]])) words.push(word);
          if ((word = units[ints[2]])) words.push(word + ' hundred');
        }
      }
      return words.reverse().join(' ').toUpperCase();
    }

    // --- Boot ---
    (async function boot(){
      try {
        await renderDashboard(true);
      } catch (err) {
        console.error(err);
      }
      document.getElementById('costing-selector').addEventListener('change', async (e) => {
  const costingId = e.target.value;
  if (!costingId || !currentSim) return;

  // 1) Tell backend: link and copy costing lines into simulation lines
  await apiJson(`${API_BASE}/link-costing.php`, {
    method: 'POST',
    body: JSON.stringify({
      simulation_ref: currentSim.simulation_ref,
      costing_id: costingId
    })
  });

  // 2) Reload simulation from backend (now it has lines)
  await openSim(currentSim.simulation_ref, true);
});

      // refresh list every 30s
      setInterval(() => renderDashboard(true), 30000);
    })();

  </script>
</body>
</html>
