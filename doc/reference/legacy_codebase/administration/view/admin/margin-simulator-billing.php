<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

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
$fullName  = trim((string)($me['full_name'] ?? 'ADMIN'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'ADMIN');

$role = strtoupper((string)($me['role'] ?? 'ADMIN'));
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
    .workspace-content{
  flex-grow: 1;
  overflow: hidden;  /* prevent whole content from scrolling */
  display: flex;
  min-height: 0;     /* CRITICAL for flex children to scroll correctly */
}

.table-area{
  min-height: 0;     /* CRITICAL */
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
    .table-area{
  flex: 1;
  background: #fff;
  position: relative;

  /* IMPORTANT: this becomes the scroll container */
  overflow-y: auto;

  /* remove top padding that creates weird sticky offsets */
  padding: 0 32px 24px;
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
    .md-sig-img { height: 200px; width: auto; display: block; margin: 0 auto; }

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
    /* --- PATCH 1 START: STICKY HEADERS & UX OVERLAYS --- */

    /* Fix Challenge 8: Stronger Sticky Header */
    .table-sim th{
  position: sticky;
  top: 0;                 /* stick to top of .table-area scroll */
  background: #fff !important;
  z-index: 1050;          /* above table rows/overlays */
  border-bottom: 2px solid #cbd5e1;
}


    /* Challenge 33: QUOTED Status Overlay for Rows */
    .tr-quoted {
      position: relative;
    }
    .tr-quoted::after {
      content: "QUOTED";
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(220, 252, 231, 0.4); /* Light Green Tint */
      display: flex; align-items: center; justify-content: center;
      font-weight: 900;
      font-size: 3rem;
      color: rgba(21, 128, 61, 0.15); /* Faded Green Text */
      letter-spacing: 10px;
      pointer-events: none; /* Allows clicking "View" button underneath */
      z-index: 5;
    }
    
    /* Input Styling for Manual Price (Challenge 6 & 7) */
    .input-sell:placeholder-shown {
      background-color: #fffbeb; /* Light yellow hint to type here */
    }
    
    /* Loading State for Buttons (Challenge 19) */
    .btn-loading {
      pointer-events: none;
      opacity: 0.75;
      position: relative;
    }
    .btn-loading::after {
      content: "";
      display: inline-block;
      width: 1rem; height: 1rem;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
      margin-left: 0.5rem;
      vertical-align: text-bottom;
    }
    @keyframes spin { 100% { transform: rotate(360deg); } }

    /* Print/Analysis Modal Layout Fixes */
    .modal-fullscreen .modal-body {
        background-color: #525659; /* Dark background for document contrast */
    }
    
    /* --- PATCH 1 END --- */
    /* --- PATCH: Adhoc line input “goes out of box” fix --- */

/* Force the simulator table to NOT expand when typing */
.table-sim{
  table-layout: fixed;  /* critical */
  width: 100%;
}

/* Allow cells to shrink (important in flex/offcanvas layouts) */
.table-sim td,
.table-sim th{
  min-width: 0;         /* critical */
}

/* Prevent horizontal bleed in the scroll area */
.table-area{
  overflow-x: hidden;
}

/* Any inputs inside the table must stay inside their cells */
.table-sim input,
.table-sim textarea,
.table-sim select{
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box;
}

/* If you render the description as text, also prevent long strings from pushing layout */
.table-sim td .fw-bold{
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* --- PATCH: Fix Offcanvas Layout & Z-Index Issues --- */

/* 1. Lower Z-Index of Sticky Header so it stays INSIDE the offcanvas context */
.table-sim th {
  z-index: 10 !important; 
}

/* 2. Align SSDC Panel with Header/Footer (Add Margins) */
.ssdc-panel {
  margin-left: 32px;
  margin-right: 32px;
  width: auto; 
}

/* 3. Allow Horizontal Scroll if needed (Stop Hard Clipping) */
.table-area {
  overflow-x: auto !important; 
  padding-right: 16px; 
}

/* 4. Fix Input padding so text doesn't hit the cell border */
.input-sell {
  padding-right: 8px;
}

/* 5. Ensure Sidebar doesn't overflow horizontally */
.sidebar-area {
  overflow-x: hidden;
}

/* --- PATCH 2: Fix Header Dropdown Overflow --- */

/* Force the costing selector to truncate instead of pushing buttons off-screen */
#costing-selector {
  max-width: 350px;       /* Restrict width so it doesn't blow out the header */
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

/* Ensure the container doesn't force width issues */
.file-selector-group {
  max-width: 100%;
  display: inline-flex;
  align-items: center;
}

/* Safety: Prevent the whole header flexbox from overflowing */
.workspace-header .d-flex {
  min-width: 0;           /* Allows flex children to shrink if needed */
}
  </style>
</head>

<body>

  <!-- SIDEBAR -->
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
                <span><i class="fa-solid fa-database category-icon"></i> MASTER DATA</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin1" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
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
                    <a href="smart-quote-leads.php" class="sub-link">Leads & Proposal Generator</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                    <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
                    <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin3">
                <span><i class="fa-solid fa-calculator category-icon"></i> COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin3" class="accordion-collapse collapse show " data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link active">Margin Simulator & Pricing System</a>
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
      <h5 class="mb-0 fw-bold text-dark">Admin Governance</h5>
      <small class="text-muted" style="font-size: 0.7rem;">SYSTEM HEALTH & SECURITY OVERSIGHT</small>
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
              <th class="text-muted small">Date</th> <th>Costing Source</th>
              <th>Client / Account</th>
              <th class="text-end">Revenue</th>
              <th class="text-end">Margin</th>
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
  <div class="offcanvas offcanvas-end" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1" id="simOffcanvas" style="width: 96vw; max-width: 1440px;">
    <div class="workspace-header">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="d-flex align-items-center gap-3">
          <h5 class="font-heading fw-bold mb-0 text-dark">Margin Simulator</h5>
          <span class="badge st-draft" id="sim-status-badge">DRAFT</span>
          <div class="vr"></div>
            <small class="text-muted font-mono fw-bold" id="sim-ref-display">-</small>
            <div class="vr ms-2"></div>
            <small class="text-muted font-mono ms-2" style="font-size: 0.6rem;" title="ISO Verification Hash">
                <i class="fa-solid fa-fingerprint me-1"></i>
                <span id="sim-hash-display">...</span>
            </small>
        </div>

        <div class="d-flex gap-2">
          <div class="file-selector-group">
            <span class="text-muted small fw-bold me-2 text-uppercase" style="font-size: 0.65rem;">Link Costing:(Only those without created margin simulations)</span>
            <select class="form-select form-select-sm d-inline-block w-auto border-secondary" id="costing-selector">

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
              <th style="width: 80px;">QTY</th>
              <th>Item Description</th>
              <th class="text-end">Cost_HT</th>
              <th class="text-end bg-primary bg-opacity-10 border-start border-primary" style="width: 160px;">Selling_HT</th>
              <th class="text-center" style="width: 50px;">VAT</th>
              <th class="text-end">Margin</th>
              <th class="text-center" style="width: 100px;">KPI</th>
              <th>Remarks</th>
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
Acct: 10005-0006-107018411001-93</textarea>
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
      per_page: 50, // PATCH: Increased to 50 to match backend
      total: 0,
      rows: []
    };

    let currentRole = SESSION.role || 'ADMIN';
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
    /* --- PATCH 3.2: DASHBOARD WITH OVERLAYS --- */
    async function renderDashboard(fetchFromApi = false) {
      try {
        const search = document.getElementById('searchInput').value || '';
        LIST_STATE.q = search;

        if (fetchFromApi) {
            const params = new URLSearchParams();
            if (LIST_STATE.status && LIST_STATE.status !== 'ALL') params.set('status', LIST_STATE.status);
            if (LIST_STATE.q) params.set('q', LIST_STATE.q);
            params.set('limit', '50'); // Challenge 32: Limit 50

            const data = await apiJson(`${API_BASE}/list.php?${params.toString()}`, { method: 'GET' });
            LIST_STATE.rows = Array.isArray(data.items) ? data.items : [];
            LIST_STATE.total = LIST_STATE.rows.length;
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

          // Challenge 33: Overlay Class
          const rowClass = (s.status === 'QUOTED') ? 'tr-quoted' : '';

          const rev = Number(s.total_sell_ttc ?? 0);
          const margin = Number(s.margin_amount ?? 0);
          const pct = rev > 0 ? ((margin / rev) * 100) : 0;

          return `
            <tr class="${rowClass}" onclick="openSim('${s.simulation_ref}')">
              <td class="ps-4 font-mono fw-bold text-primary" style="font-size:0.8rem">
                 ${s.simulation_ref}
                 ${s.verification_hash ? '<i class="fa-solid fa-lock text-muted ms-1" title="Verified"></i>' : ''}
              </td>
              <td class="small text-muted font-mono">
                ${s.created_at ? new Date(s.created_at).toLocaleDateString('en-GB') : '-'}
              </td>
              <td class="small text-muted">${s.costing_ref || '-'}</td>
              <td class="fw-bold">${s.client_name_cached || '-'}</td>
              <td class="text-end font-mono">${money(rev)} ${s.currency || 'XAF'}</td>
              <td class="text-end fw-bold ${margin>=0?'text-success':'text-danger'} font-mono">${money(margin)}</td>
              <td><span class="badge ${pct > 20 ? 'bg-success' : 'bg-warning text-dark'}">${pct.toFixed(1)}%</span></td>
              <td><span class="status-badge ${badgeClass}">${s.status}</span></td>
              <td class="text-end pe-4"><button class="btn btn-sm btn-light border">View</button></td>
            </tr>
          `;
        }).join('');

        renderPager();
      } catch (err) { console.error(err); }
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

    // Add a global loading flag (outside the function)
let _isLoadingCostings = false;

async function loadApprovedCostingsOnce(force = false) {
  // 1. STOP if already loaded OR if currently loading
  if ((window.__approvedCostingsLoaded && !force) || _isLoadingCostings) return;

  // 2. Lock immediately
  _isLoadingCostings = true;

  const sel = document.getElementById('costing-selector');
  
  try {
    const res = await apiJson('/administration/api/marginpricing/get-approved-costings.php', {
      method: 'GET'
    });

    if (force) APPROVED_COSTINGS = {};

    // 3. Clear the dropdown explicitly right before filling to ensure it is clean
    sel.innerHTML = `<option value="">Select Approved Costing...</option>`;

    for (const c of (res.items || [])) {
      APPROVED_COSTINGS[c.costing_id] = c;

      const label =
        `${c.costing_ref} | ${c.client_name_cached || c.client_name} | ${c.operations_file_reference} | ` +
        `${Number(c.total_ttc || 0).toLocaleString()} ${c.currency || 'XAF'}`;

      const opt = document.createElement('option');
      opt.value = c.costing_id;
      opt.textContent = label;
      sel.appendChild(opt);
    }

    window.__approvedCostingsLoaded = true;

  } catch (err) {
    console.error("Failed to load approved costings", err);
    // Optional: Show error in dropdown
    sel.innerHTML = `<option value="">Error loading costings</option>`;
  } finally {
    // 4. Always Unlock, even if error
    _isLoadingCostings = false;
  }
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

    async function openSim(simRef, forceReload = false) {
  riskJustification = "";
  document.getElementById('risk-warning').classList.add('d-none');

  await loadApprovedCostingsOnce();
  await loadFinancialDictionaryOnce();

  if (simRef === 'new') {
    // Initialize blank state for new
    const dummySim = { id: 0, simulation_ref: 'NEW-SIM', status: 'DRAFT' };
    setupSimUI(dummySim, [], true);
    bsOffcanvas.show();
    return;
  }

  try {
    const data = await apiJson(`${API_BASE}/get.php?simulation_ref=${encodeURIComponent(simRef)}`);
    
    // Hydrate SSDC data if linked
    if (data?.simulation?.costing_id) {
      await loadCostingData(data.simulation.costing_id, { hydrateOnly: true });
    }

    const sim = data.simulation;
    let lines = data.lines || [];

    // Logic: Only reload from Costing if the Simulation is truly empty
    const noLines = !Array.isArray(lines) || lines.length === 0;
    
    if (sim?.costing_id && noLines) {
      await loadCostingData(sim.costing_id, { hydrateOnly: false });
      // loadCostingData populates global currentLines, so we use that
      setupSimUI(sim, currentLines, false); 
    } else {
      setupSimUI(sim, lines, false);
    }
    
    riskJustification = data.risk_justification || sim.risk_justification || "";
    if (data.costing && data.costing.costing_id) {
        APPROVED_COSTINGS[data.costing.costing_id] = data.costing;
    }

    bsOffcanvas.show();
  } catch (err) {
    alert('Failed to load simulation: ' + err.message);
  }
}

    function toBool(v) {
  if (v === true) return true;
  if (v === 1) return true;
  if (v === "1") return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "yes" || s === "y" || s === "on";
  }
  return false;
}

    function setupSimUI(sim, lines, isNew) {
  // 1. Set Global State
  currentSim = {
    ...sim,
    simulation_ref: sim.simulation_ref || sim.id || 'NEW-SIM'
  };

  // 2. Display ISO Verification Hash
  const hashEl = document.getElementById('sim-hash-display');
  if(hashEl) {
    if (sim.verification_hash) {
        hashEl.innerText = sim.verification_hash.substring(0, 16) + '...';
        hashEl.title = "Full Hash: " + sim.verification_hash;
        hashEl.classList.remove('text-muted');
        hashEl.classList.add('text-success');
    } else {
        hashEl.innerText = 'Not Signed';
        hashEl.title = "Simulation has not been hashed/saved yet";
        hashEl.classList.add('text-muted');
        hashEl.classList.remove('text-success');
    }
  }

  // 3. Process Lines (CRITICAL FIX: READ UNIT COST)
  currentLines = (lines || []).map(l => {
    // A. Helper to check booleans safely
    const isTrue = (v) => (v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true");

    // B. Get Quantity
    const qty = Number(l.qty || 1);

    // C. Logic to determine Unit Cost from DB
    // Priority 1: Explicit Unit Cost from DB (cost_unit_xaf or cost_unit)
    // Priority 2: Calculated from Total (total / qty)
    let unitCost = Number(l.cost_unit_xaf ?? l.cost_unit ?? 0);
    const totalCost = Number(l.cost_total_xaf ?? l.cost_xaf ?? l.total_cost_xaf ?? 0);

    // If unit cost is missing but we have a total, derive unit
    if (unitCost === 0 && totalCost !== 0) {
        unitCost = (qty > 0) ? (totalCost / qty) : totalCost;
    }

    // D. Logic to determine Unit Sell from DB
    let unitSell = Number(l.sell_unit_xaf ?? l.sell_unit ?? 0);
    const totalSell = Number(l.selling_total_xaf ?? l.sell_total ?? l.sell ?? 0);
    
    // If unit sell is missing but we have a total, derive unit
    if (unitSell === 0 && totalSell !== 0) {
        unitSell = (qty > 0) ? (totalSell / qty) : totalSell;
    }
    
    // E. Handle "Empty" sell (for new lines or reset lines)
    const finalSell = (unitSell === 0 && totalSell === 0) ? null : unitSell;

    return {
      line_id: l.line_id || l.id || null,
      code: l.item_code || l.code || '',
      desc: l.item_description || l.description || l.desc || '',
      
      qty: qty,

      // STORE UNIT COST
      cost: unitCost,
      
      // STORE UNIT SELL
      sell: finalSell,
      
      remarks: l.quote_remarks || l.remarks || '',
      
      // Map Flags
      printOnQuote: isTrue(l.print_on_quote ?? l.client_facing ?? true),
      applyVat: isTrue(l.apply_vat ?? l.vat_applicable ?? false),
      isAdHoc: isTrue(l.is_adhoc ?? l.isAdHoc ?? false)
    };
  });

  // 4. Header UI Updates (Ref & Badge)
  const refDisplay = document.getElementById('sim-ref-display');
  if(refDisplay) refDisplay.innerText = currentSim.simulation_ref;

  const badge = document.getElementById('sim-status-badge');
  const status = currentSim.status || 'DRAFT';
  if(badge) {
      badge.innerText = status;
      badge.className = `badge st-${status.toLowerCase()}`;
  }

  // 5. Costing Selector Configuration
  const sel = document.getElementById('costing-selector');
  let unlockBtn = document.getElementById('btn-unlock-costing');

  if (isNew || !currentSim.costing_id) {
    if(sel) { sel.value = ""; sel.disabled = false; }
    if(unlockBtn) unlockBtn.style.display = 'none';
    resetSSDC();
  } else {
    // Lock selection
    const c = APPROVED_COSTINGS[currentSim.costing_id] || {};
    const label = `${currentSim.costing_ref || c.costing_ref || 'COSTING'} | ${currentSim.client_name_cached || 'Client'}`; 
    ensureCostingOption(currentSim.costing_id, label);

    if(sel) { sel.value = currentSim.costing_id; sel.disabled = true; }
    if(unlockBtn) unlockBtn.style.display = 'inline-block';
    
    // Render the Sidebar Data
    renderSSDC(currentSim.costing_id);
  }

  // 6. Global Locking Rules
  isLocked = (status === 'APPROVED' || status === 'QUOTED' || status === 'SUBMITTED');
  if (status === 'REVISION') isLocked = false;

  // 7. Render Content
  renderLines();
  updateFooter();
}

    function simRefSafe(sim){
      return sim?.simulation_ref || sim?.id || sim?.simulationRef || 'SLAS-MA-XXXX';
    }

    async function loadCostingData(costingId, opts = {}) {
  if (!costingId) return;

  const data = await apiJson(
    `${API_BASE}/get-costing-ssdc.php?costing_id=${encodeURIComponent(costingId)}`,
    { method: 'GET' }
  );

  // Normalize header and ssdc safely
  const h = data.header || {};
  const s = data.ssdc || {}; 
  const totals = h.totals || {};

  // Cache FULL costing context
  APPROVED_COSTINGS[costingId] = {
    redirect_to: data.redirect_to, // Support for Auto-Redirect
    costing_id: h.costing_id,
    costing_ref: h.costing_ref,
    operations_file_reference: h.operations_file_reference,

    client_id: h.client_id,
    client_name: h.client_name || h.client_name_cached || h.client_bill_to || '',

    // Data for Print Preview
    client_address: h.client_address || '',
    client_niu: h.client_niu || h.niu || '',
    client_contact: h.client_contact || h.contact_person || '',
    client_email: h.client_email || h.contact_email || '',
    client_phone: h.client_phone || h.contact_phone || '',
    
    // Correctly mapping from 's' (SSDC) as per previous fix
    pod: s.pod || '',                        
    transport_ref: s.transport_ref || '',   
    conveyance: s.conveyance || '',          

    service_type: h.service_type,
    service_territory: h.service_territory,

    currency: h.currency,
    exchange_rate_to_xaf: Number(h.exchange_rate_to_xaf || 0),

    totals: {
      total_ht: Number(totals.total_ht || 0),
      total_vat: Number(totals.total_vat || 0),
      total_ttc: Number(totals.total_ttc || 0),
    },

    route_label: s.route_label,

    ssdc: {
      eta: s.eta,
      weight: s.weight,
      packages: s.packages,
      commodity: s.commodity,
      marks: s.marks
    },
    
    // Raw lines from API
    lines: (data.lines || [])
  };

  // Always refresh SSDC panel
  renderSSDC(costingId);

  // If we are only hydrating SSDC / print fields, do not touch currentLines
  if (opts.hydrateOnly) return;

  // --- CRITICAL FIX: HT & VAT LOGIC ---
  currentLines = (data.lines || []).map(l => {
    // 1. Get Quantity (Safe default to 1)
    const qty = Number(l.qty || 1);
    
    // 2. Get TOTAL HT from DB
    const totalHt = Number(l.total_ht || 0);

    // 3. CALCULATE UNIT COST
    // If qty is 0, avoid division by zero
    const unitCost = (qty > 0) ? (totalHt / qty) : totalHt;

    // 4. VAT: Strict check. If backend says 1/true, we turn it ON.
    const applyVat = (l.vat_applicable == 1 || l.vat_applicable === true);

    return {
      line_id: null,
      code: l.item_code || '',
      desc: l.item_description || '',
      
      qty: qty,

      cost: unitCost, // STORE UNIT COST, NOT TOTAL

      // Sell Default: Unit Cost * 1 (No markup, as requested)
      sell: Math.ceil(unitCost * 1),

      remarks: '',
      printOnQuote: true,

      applyVat: applyVat, // Defaults to whatever the Costing had

      isAdHoc: false,
    };
  });

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
      // 1. Update State Only
      currentLines[idx].desc = val;
      
      // 2. Check Dictionary for code match
      const match = FINANCIAL_DICTIONARY.find(f => f.name_en === val);
      if(match) {
          currentLines[idx].code = match.code;
          
          // 3. Update DOM directly (surgical update) without re-rendering the table
          const codeEl = document.getElementById(`code-display-${idx}`);
          if (codeEl) codeEl.innerText = match.code;
      }
      
      // DO NOT CALL renderLines() HERE - It kills input focus!
    }

    function renderLines() {
  const tbody = document.getElementById('sim-lines-body');
  let tCost = 0, tRev = 0, negativeFound = false;

  tbody.innerHTML = (currentLines || []).map((l, i) => {
    // Calc total based on Qty
    const q = Number(l.qty || 1);
    const costUnit = Number(l.cost || 0); // Unit cost
    const sellUnit = Number(l.sell || 0); // Unit sell
    
    // Line Totals (Calculated in background for Margin display)
    const costTotal = costUnit * q;
    const sellTotal = sellUnit * q;
    const margin = sellTotal - costTotal;
    
    // KPI is based on Unit or Total (same result mathematically)
    const pct = sellTotal > 0 ? (margin / sellTotal * 100) : 0;

    tCost += costTotal;
    tRev  += sellTotal;
    
    if (margin < 0) negativeFound = true;

    // Styling
    let kpiClass = 'obs-fair', kpiText = 'FAIR';
    if (pct < 10) { kpiClass = 'obs-poor'; kpiText = 'POOR'; }
    else if (pct >= 35) { kpiClass = 'obs-excel'; kpiText = 'EXCEL'; }
    else if (pct >= 20) { kpiClass = 'obs-good'; kpiText = 'GOOD'; }
    
    const disabled = isLocked ? 'disabled' : '';
    const vatClass = l.applyVat ? 'active-vat' : '';
    const eyeClass = l.printOnQuote ? 'active-eye' : 'inactive-eye';
    const eyeIcon  = l.printOnQuote ? 'fa-eye' : 'fa-eye-slash';
    
    const inputValue = (l.sell === null) ? '' : l.sell;

    // LOGIC UPDATE: Ad-Hoc lines get an editable Cost Input
    const costDisplay = l.isAdHoc
      ? `<input type="number" class="form-control form-control-sm text-end fw-bold font-mono" 
           value="${costUnit}" 
           oninput="updateLine(${i}, 'cost', this.value)" 
           ${disabled} step="0.01">`
      : `<div class="text-end font-mono text-muted small align-middle py-1">
           ${money(costUnit)} <i class="fa-solid fa-lock ms-1" style="font-size:0.6rem"></i>
         </div>`;

    return `
      <tr>
        <td class="text-muted small align-middle">${i+1}</td>
        
        <td class="p-1 align-middle">
           <input type="number" class="form-control form-control-sm text-center fw-bold bg-light" 
             value="${q}" oninput="updateLine(${i}, 'qty', this.value)" ${disabled} step="0.01">
        </td>

        <td class="small align-middle">
          ${l.isAdHoc 
            ? `<input type="text" class="form-control form-control-sm fw-bold" list="fin-dict" value="${escapeHtml(l.desc)}" oninput="updateAdHocDesc(${i}, this.value)" ${disabled}>
               <div id="code-display-${i}" class="text-muted font-mono mt-1" style="font-size:0.7rem">${escapeHtml(l.code)}</div>`
            : `<div class="fw-bold text-dark">${escapeHtml(l.desc)}</div>
               <div class="text-muted font-mono" style="font-size:0.7rem">${escapeHtml(l.code)}</div>`
          }
        </td>
        
        <td class="p-1 align-middle" style="min-width: 120px;">
          ${costDisplay}
        </td>
        
        <td class="p-1 align-middle">
          <input type="number" class="form-control form-control-sm input-sell" 
            id="sell-${i}"
            value="${inputValue}" 
            placeholder="Price"
            oninput="updateLine(${i}, 'sell', this.value)"
            onkeydown="handleEnter(event, ${i}, 'sell')" ${disabled}>
        </td>
        
        <td class="align-middle text-center">
           <div class="d-flex justify-content-center gap-1">
             <button class="toggle-btn ${vatClass}" onclick="toggleLineProp(${i}, 'applyVat')" ${disabled} title="Apply VAT">VAT</button>
             <button class="toggle-btn ${eyeClass}" onclick="toggleLineProp(${i}, 'printOnQuote')" ${disabled}><i class="fa-solid ${eyeIcon}"></i></button>
           </div>
        </td>
        
        <td id="cell-margin-${i}" class="text-end font-mono fw-bold small align-middle ${margin<0?'text-danger':'text-success'}">
            ${money(margin)}
        </td>
       
        <td id="cell-kpi-${i}" class="text-center align-middle">
           <span class="obs-pill ${kpiClass}">${kpiText} (${pct.toFixed(0)}%)</span>
        </td>
        
        <td class="p-1 align-middle">
          <input type="text" class="form-control form-control-sm smart-input" 
            id="note-${i}" 
            placeholder="Notes..."
            value="${escapeHtml(l.remarks)}" 
            oninput="updateLine(${i}, 'remarks', this.value)"
            onkeydown="handleEnter(event, ${i}, 'note')" ${disabled}>
        </td>
      </tr>
    `;
  }).join('');
  
  updateSnapshot(tCost, tRev);

  const riskEl = document.getElementById('risk-warning');
  if (negativeFound) riskEl.classList.remove('d-none');
  else riskEl.classList.add('d-none');
}

    function escapeHtml(s){
      return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
    }

    function updateLine(idx, field, val) {
  // 1. Update State
  if(field === 'qty') {
      let q = parseFloat(val);
      if(isNaN(q)) q = 0; // Allow 0
      currentLines[idx].qty = q;
  }
  if(field === 'cost') { // NEW: Handle Cost Input (for AdHoc lines)
      let c = parseFloat(val);
      if(isNaN(c)) c = 0;
      currentLines[idx].cost = c;
  }
  if(field === 'sell') {
      currentLines[idx].sell = (val === '') ? null : parseFloat(val);
  }
  if(field === 'remarks') {
      currentLines[idx].remarks = val;
      return; // Text only, no math needed
  }

  // 2. Recalculate This Row (Unit * Qty)
  const l = currentLines[idx];
  const q = Number(l.qty || 1);
  const unitCost = Number(l.cost || 0);
  const unitSell = Number(l.sell || 0);
  
  const totalCost = unitCost * q;
  const totalSell = unitSell * q;
  const totalMargin = totalSell - totalCost;
  const pct = totalSell > 0 ? (totalMargin / totalSell * 100) : 0;

  // 3. Update DOM (Margin Cell)
  const margEl = document.getElementById(`cell-margin-${idx}`);
  if(margEl) {
      margEl.innerText = money(totalMargin);
      margEl.classList.remove('text-danger', 'text-success');
      margEl.classList.add(totalMargin < 0 ? 'text-danger' : 'text-success');
  }

  // 4. Update DOM (KPI Badge)
  const kpiEl = document.getElementById(`cell-kpi-${idx}`);
  if(kpiEl) {
      let kpiClass = 'obs-fair', kpiText = 'FAIR';
      if (pct < 10) { kpiClass = 'obs-poor'; kpiText = 'POOR'; }
      else if (pct >= 35) { kpiClass = 'obs-excel'; kpiText = 'EXCEL'; }
      else if (pct >= 20) { kpiClass = 'obs-good'; kpiText = 'GOOD'; }
      kpiEl.innerHTML = `<span class="obs-pill ${kpiClass}">${kpiText} (${pct.toFixed(0)}%)</span>`;
  }

  // 5. Update Global Totals
  let tCost = 0, tRev = 0;
  currentLines.forEach(line => {
      const lq = Number(line.qty || 1);
      tCost += (Number(line.cost || 0) * lq); // Unit * Qty
      tRev  += (Number(line.sell || 0) * lq); // Unit * Qty
  });
  
  updateSnapshot(tCost, tRev);
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
  
 


  const status = String(currentSim.status || 'DRAFT').toUpperCase();
  const isAdmin = String(currentRole || '').toUpperCase() === 'ADMIN';
  const isSales = String(currentRole || '').toUpperCase() === 'SALES';
  const isMgmt  = String(currentRole || '').toUpperCase() === 'MANAGEMENT';

  // Admin override permissions
  const canSalesActions = isSales || isAdmin;
  const canMgmtActions  = isMgmt  || isAdmin;

  // QUOTED (anyone can download; admin also can unlock)
  if (status === 'QUOTED') {
    html += `<button class="btn btn-success fw-bold btn-sm me-2" onclick="generatePDF('QUOTE')">
              <i class="fa-solid fa-file-pdf me-2"></i>Download PDF
            </button>`;

    if (canMgmtActions) {
      html += `<button class="btn btn-outline-warning fw-bold btn-sm" onclick="unlockSim()">
                <i class="fa-solid fa-lock-open me-2"></i>Unlock to Revision
              </button>`;
    }

    container.innerHTML = html;
    return;
  }

  // APPROVED (anyone can generate quote)
  if (status === 'APPROVED') {
    html += `<button class="btn btn-dark fw-bold btn-sm" onclick="openQuoteSetup()">
              <i class="fa-solid fa-file-invoice-dollar me-2"></i>Generate Quote
            </button>`;
    container.innerHTML = html;
    return;
  }

  // SALES actions (Sales OR Admin)
  if (canSalesActions) {
    if (!isLocked) {
      html += `<button class="btn btn-outline-dark fw-bold btn-sm me-2" onclick="saveDraft()">
                <i class="fa-regular fa-floppy-disk me-2"></i>Save
              </button>`;
      html += `<button class="btn btn-primary fw-bold btn-sm" onclick="submitApproval()">
                <i class="fa-solid fa-paper-plane me-2"></i>Submit
              </button>`;
    } else {
      html += `<span class="text-muted fst-italic me-2">
                <i class="fa-solid fa-lock me-1"></i> Locked for review
              </span>`;
    }
  }

  // MANAGEMENT actions (Management OR Admin) – only when submitted
  if (canMgmtActions && status === 'SUBMITTED') {
    html += `<button class="btn btn-danger fw-bold btn-sm me-2" onclick="rejectSim()">
              <i class="fa-solid fa-ban me-2"></i>Reject
            </button>`;
    html += `<button class="btn btn-success fw-bold btn-sm" onclick="approveSim()">
              <i class="fa-solid fa-check me-2"></i>Approve
            </button>`;
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
    
    function commitDomEditsToState(){
  (currentLines || []).forEach((_, i) => {
    const sellEl = document.getElementById(`sell-${i}`);
    if (sellEl) {
      const v = sellEl.value;
      currentLines[i].sell = (v === '') ? null : parseFloat(v);
    }

    const noteEl = document.getElementById(`note-${i}`);
    if (noteEl) currentLines[i].remarks = noteEl.value || '';
  });
}

    function ensureCostingOption(costingId, label) {
  const sel = document.getElementById('costing-selector');
  if (!sel || !costingId) return;

  const exists = Array.from(sel.options).some(o => o.value === costingId);
  if (exists) return;

  const opt = document.createElement('option');
  opt.value = costingId;
  opt.textContent = label || `Linked Costing: ${costingId}`;
  sel.appendChild(opt);
}


    async function saveDraft() {
  if (!currentSim) return;
  commitDomEditsToState();

  document.getElementById('autosave-status').innerHTML =
    '<span class="text-primary"><i class="fa-solid fa-spinner fa-spin"></i> Saving...</span>';

  // Lazy Create logic
  if (currentSim.id === 0) {
    try {
      const res = await apiJson(`${API_BASE}/create.php`, { method: 'POST' });
      currentSim.id = res.simulation.id;
      currentSim.simulation_ref = res.simulation.simulation_ref;
      document.getElementById('sim-ref-display').innerText = currentSim.simulation_ref;
    } catch (e) {
      alert("Failed to initialize: " + e.message);
      document.getElementById('autosave-status').innerHTML = '<span class="text-danger">Creation Failed</span>';
      return;
    }
  }

  try {
    const payload = {
      id: currentSim.id,
      simulation_ref: currentSim.simulation_ref,
      costing_id: currentSim.costing_id || null,
      status: 'DRAFT',
      totals: {
        total_cost_xaf: Number(currentSim.total_cost_xaf || 0),
        total_revenue_xaf: Number(currentSim.total_revenue_xaf || 0),
        total_margin_xaf: Number(currentSim.total_margin_xaf || 0),
      },
      risk_justification: riskJustification || null,
      
      lines: (currentLines || []).map(l => {
        // Prepare math variables
        const qty = Number(l.qty || 1);
        const unitCost = Number(l.cost || 0); // l.cost is now Unit Cost
        const unitSell = Number(l.sell || 0); // l.sell is now Unit Sell

        return {
          line_id: l.line_id || null,
          item_code: l.code || '',
          item_description: l.desc || '',
          
          qty: qty,
          
          // --- FIX: Send Unit AND Calculated Total ---
          cost_unit: unitCost,
          cost_total_xaf: unitCost * qty, 
          
          sell_unit: unitSell,
          sell_total_xaf: unitSell * qty,
          
          quote_remarks: l.remarks || '',
          
          printOnQuote: l.printOnQuote !== false,
          applyVat: l.applyVat === true,
          isAdHoc: l.isAdHoc === true
        };
      })
    };

    const res = await apiJson(`${API_BASE}/save.php`, {
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
         body: JSON.stringify({ id: currentSim.id })
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
  const isQuote = (type === 'QUOTE');

  // 1) Validation
  if (isQuote && (!currentLines || currentLines.length === 0)) {
    alert("Cannot generate quote: No lines available.");
    return;
  }

  // 2) Configuration & Currency Math
  // We treat the input as "How many XAF make 1 Unit of Currency" (e.g. 655 for EUR)
  const rawFx = document.getElementById('q-fx-rate')?.value;
  const fx = (rawFx && parseFloat(rawFx) !== 0) ? parseFloat(rawFx) : 1;

  const config = {
    validity: document.getElementById('q-validity')?.value || '15 Days',
    terms: document.getElementById('q-terms')?.value || 'N/A',
    currency: document.getElementById('q-currency')?.value || 'XAF',
    bank: document.getElementById('q-bank-custom')?.value || '',
    headerNote: document.getElementById('q-header-note')?.value || '',
    lang: document.getElementById('q-lang')?.value || 'EN'
  };

  // Aggregated Remarks
  if (!config.headerNote) {
    const remarks = (currentLines || [])
      .filter(l => l.remarks && String(l.remarks).trim() !== '')
      .map((l, i) => `${i + 1}. ${l.remarks}`)
      .join('\n');
    config.headerNote = remarks;
  }

  // 3) Data Extraction
  const c = APPROVED_COSTINGS[currentSim?.costing_id] || {};
  const ssdc = c.ssdc || {};

  // 4) Print lines & Calc Totals (Converted)
  const printLines = (currentLines || [])
    .filter(l => l.printOnQuote && (l.sell !== null && Number(l.sell) > 0));

  if (isQuote && printLines.length === 0) {
    alert("No printable lines (ensure client-facing + selling price > 0).");
    return;
  }

  // CALC: Apply Exchange Rate Divisor
  const totalVal = printLines.reduce((acc, l) => acc + ((l.qty || 1) * (Number(l.sell) / fx)), 0);
  const words = toWords(totalVal, config.lang);
  const curr  = String(config.currency || 'XAF');

  const amtInWords = (String(config.lang || 'EN').toUpperCase() === 'FR')
    ? `MONTANT DU DEVIS ARRÊTÉ À LA SOMME DE : ${words} ${curr}`
    : `QUOTATION AMOUNT HELD AT: ${words} ${curr}`;

  const sumHT = printLines.reduce((acc, l) => acc + ((l.qty || 1) * (Number(l.sell) / fx)), 0);
  const vat   = printLines.reduce((acc, l) => acc + (l.applyVat ? ((l.qty || 1) * (Number(l.sell) / fx) * 0.1925) : 0), 0);
  const ttc   = sumHT + vat;

  const safe = (v, fallback = '-') => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return s.trim() ? s : fallback;
  };

// 5) HTML (Totals attached to Table + Legal Footer pinned to bottom)
  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Print</title>

  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap');

    /* 1. FORCE HIDE BROWSER HEADERS/FOOTERS (Url, Date, Title) */
    @page {
      margin: 0; 
      size: auto;
    }

    :root{
      --ink:#231F20;
      --accent:#EE7D04;
      --grey:#e5e5e5;
    }

    *{
      box-sizing:border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    html, body{
      margin:0;
      padding:0;
      background:#fff;
      color:var(--ink);
      font-family:'Montserrat', sans-serif;
      height: 100%; /* Critical for footer positioning */
    }

    /* Flex Column Wrapper to push footer to bottom */
    body {
      display: flex;
      flex-direction: column;
      padding: 15mm 15mm 0 15mm; /* Top/Left/Right padding. Bottom handled by footer */
    }

    /* --- HEADER --- */
    .header-row{
      display:flex;
      justify-content:space-between;
      gap:12px;
      border-bottom:3px solid var(--accent);
      padding-bottom:10px;
      margin-bottom:14px;
      flex: 0 0 auto;
    }
    .logo img{ height:58px; width:auto; display:block; }

    .company-info{
      text-align:right;
      font-size:0.68rem;
      line-height:1.25;
    }
    .company-info h1{
      font-size:1.2rem;
      font-weight:800;
      margin:0 0 3px 0;
      letter-spacing:-0.5px;
    }

    /* --- FIXED INFO BOXES --- */
    .info-grid{
      display:grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap:10px;
      margin-bottom:14px;
      flex: 0 0 auto;
    }

    .box{
      border:1px solid #000;
      font-size:0.60rem; /* Reduced slightly for harmonization */
      display:flex;
      flex-direction:column;
      overflow:hidden;
      height:168px;      /* STRICT FIXED HEIGHT */
      min-height:168px;
      max-height:168px;
    }

    .box-header{
      background:var(--grey) !important;
      font-weight:800;
      padding:4px 6px;
      border-bottom:1px solid #000;
      text-transform:uppercase;
      letter-spacing:0.5px;
      flex:0 0 auto;
    }

    .box-body{
      padding:5px 6px;
      line-height:1.2;
      overflow:hidden;
      flex:1 1 auto;
    }

    .row-item{
      display:flex;
      justify-content:space-between;
      border-bottom:1px dashed #ddd;
      margin-bottom:1px;
      gap:4px; /* Reduced from 8px to save horizontal space */
      overflow:hidden;
      min-height:15px;
    }
    .row-item:last-child{ border-bottom:none; }

    .row-item strong{
      white-space:nowrap;
      color:#555;
      flex:0 0 auto;
    }

    /* Default Behavior: 1 Line Max */
    .row-item span{
      text-align:right;
      font-weight:600;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap; 
      display:block;
      flex:1 1 auto;
      max-width:65%;
    }

    /* EXCEPTION: Address Row (Allows 2 lines) */
    .row-item.address-row span {
      white-space: normal; /* Allow wrapping */
      display: -webkit-box;
      -webkit-line-clamp: 2; /* STRICT LIMIT: 2 Lines max */
      -webkit-box-orient: vertical;
      line-height: 1.1;
    }

    /* --- TABLE --- */
    table{
      width:100%;
      border-collapse:collapse;
      font-size:0.68rem;
      margin-bottom:14px;
      flex: 0 0 auto; /* Allow it to sit naturally */
    }

    thead{ display: table-header-group; }
    tr{ page-break-inside: avoid; break-inside: avoid; }

    th{
      background:#000 !important;
      color:#fff !important;
      padding:5px 6px;
      border:1px solid #000;
      text-transform:uppercase;
      font-weight:800;
      letter-spacing:0.3px;
    }

    td{
      border:1px solid #000;
      padding:4px 6px;
      vertical-align:top;
      line-height:1.15;
    }

    .td-desc{
      overflow:hidden;
      text-overflow:ellipsis;
      display:-webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      max-height:3.6em;
    }

    /* --- CONTENT SPACER --- */
    .content-fill {
      flex: 1 1 auto; /* Consumes all empty vertical space */
    }

    /* --- NEW FOOTER STRUCTURE --- */
    .footer-container {
      margin-top: auto; /* Pushes to very bottom */
      break-inside: avoid;
      page-break-inside: avoid;
      flex: 0 0 auto;
    }

    /* Top Section: Remarks (Left) + Totals (Right) - Now attached to table */
    .footer-main {
      display:flex;
      gap:12px;
      align-items:flex-start;
      margin-bottom: 10px;
      flex: 0 0 auto;
    }

    .footer-left {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .amt-words{
      font-weight:700;
      font-style:italic;
      font-size:0.62rem;
      border:1px solid #000;
      padding:5px;
      background:#f9f9f9 !important;
    }

    .remarks-box {
      border:1px solid #000;
      font-size:0.62rem;
      min-height: 80px;
    }
    .remarks-head { background:#eee !important; font-weight:700; padding:4px; border-bottom:1px solid #000; }
    .remarks-body { padding:4px; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;}

    .footer-right {
      width: 35%;
      display: flex;
      flex-direction: column;
    }

    .totals-table{ width:100%; border:1px solid #000; font-size:0.68rem; }
    .totals-table td{ padding:5px 8px; border-bottom:1px solid #ccc; }
    .totals-table tr:last-child td{
      background:#eee !important;
      font-weight:800;
      border-bottom:none;
      font-size:0.75rem;
    }

    .sig-block{ margin-top:10px; text-align:center; }
    .sig-title{ font-size:0.65rem; font-weight:800; margin-bottom:4px; text-decoration:underline; }
    .sig-img{ height:100px; width:auto; display:inline-block; }

    /* Bottom Section: The Statutory Bar */
    .statutory-bar {
      background: var(--grey) !important;
      border-top: 2px solid #000;
      font-size: 0.55rem;
      padding: 8px 15mm 8px 15mm; /* Padding matches body side padding */
      margin: 0 -15mm 0 -15mm;    /* Negative margin to stretch full width */
      text-align: center;
      font-family: monospace;
      color: #333;
      line-height: 1.4;
    }
    
    .statutory-row {
      display: flex;
      justify-content: center;
      gap: 15px;
      flex-wrap: wrap;
    }
    .statutory-row strong { color: #000; }

    @media print{
      body{ padding: 15mm 15mm 0 15mm; }
    }
  </style>
</head>

<body>
  <div class="header-row">
    <div class="logo">
      <img src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png" alt="Logo">
    </div>
    <div class="company-info">
      <h1>SMART LOGISTICS AND SERVICES LTD</h1>
      <div>1030, Avenue Douala Manga Bell, Bali</div>
      <div>PO Box 5120, Douala, Cameroon</div>
      <div>+237 233 420 281 | sales@smartls.cm</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="box">
      <div class="box-header">Bill To</div>
      <div class="box-body">
        <div class="row-item"><strong>Client:</strong> <span>${escapeHtml(safe(c.client_name || document.getElementById('ssdc-client')?.innerText))}</span></div>
        <div class="row-item"><strong>Client ID:</strong> <span>${escapeHtml(safe(c.client_id))}</span></div>
        <div class="row-item address-row"><strong>Address:</strong> <span>${escapeHtml(safe(c.client_address))}</span></div>
        <div class="row-item"><strong>Attn:</strong> <span>${escapeHtml(safe(c.client_contact))}</span></div>
        <div class="row-item"><strong>Email:</strong> <span>${escapeHtml(safe(c.client_email))}</span></div>
        <div class="row-item"><strong>NIU:</strong> <span>${escapeHtml(safe(c.client_niu))}</span></div>
        <div class="row-item"><strong>Phone:</strong> <span>${escapeHtml(safe(c.client_phone))}</span></div>
      </div>
    </div>

    <div class="box">
      <div class="box-header">Shipment Details</div>
      <div class="box-body">
        <div class="row-item"><strong>Trans. Ref.:</strong> <span>${escapeHtml(c.transport_ref || '-')}</span></div>
        <div class="row-item"><strong>Conveyance:</strong> <span>${escapeHtml(c.conveyance || '-')}</span></div>
        <div class="row-item"><strong>Route:</strong> <span>${escapeHtml(safe(c.route_label || document.getElementById('ssdc-route')?.innerText))}</span></div>
        <div class="row-item"><strong>Dest.:</strong> <span>${escapeHtml(c.pod || '-')}</span></div>
        <div class="row-item"><strong>ETA/ATA:</strong> <span>${escapeHtml(safe(ssdc.eta || document.getElementById('ssdc-eta')?.innerText))}</span></div>
        <div class="row-item"><strong>Marks & N°:</strong> <span>${escapeHtml(safe(ssdc.marks || document.getElementById('ssdc-marks')?.innerText))}</span></div>
        <div class="row-item"><strong>Commodity:</strong> <span>${escapeHtml(safe(ssdc.commodity || document.getElementById('ssdc-comm')?.innerText))}</span></div>
        <div class="row-item"><strong>Weight:</strong> <span>${escapeHtml(safe(ssdc.weight || document.getElementById('ssdc-wgt')?.innerText))}</span></div>
      </div>
    </div>

    <div class="box">
      <div class="box-header">${isQuote ? 'Quotation Info' : 'Analysis Info'}</div>
      <div class="box-body">
        <div class="row-item"><strong>Number:</strong> <span>${escapeHtml(safe(currentSim?.simulation_ref))}</span></div>
        <div class="row-item"><strong>Date:</strong> <span>${escapeHtml(new Date().toLocaleDateString())}</span></div>
        <div class="row-item"><strong>File Ref:</strong> <span>${escapeHtml(safe(c.operations_file_reference))}</span></div>

        ${
          isQuote
            ? `
              <div class="row-item"><strong>Terms:</strong> <span>${escapeHtml(safe(config.terms, 'N/A'))}</span></div>
              <div class="row-item"><strong>Validity:</strong> <span>${escapeHtml(safe(config.validity, 'N/A'))}</span></div>
              <div class="row-item"><strong>Currency:</strong> <span>${escapeHtml(safe(config.currency, 'XAF'))}</span></div>
            `
            : `
              <div class="row-item"><strong>Costing Ref:</strong> <span>${escapeHtml(safe(c.costing_ref))}</span></div>
              <div class="row-item"><strong>Cost Total:</strong> <span>${escapeHtml(money(Number(currentSim?.total_cost_xaf || 0)))}</span></div>
              <div class="row-item"><strong>Global Margin:</strong> <span>${escapeHtml(String(currentSim?.margin_percent ?? '-'))}%</span></div>
            `
        }
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:15%">Code</th>
        <th style="width:40%">Description</th>
        <th style="width:10%; text-align:center;">Qty</th>
        <th style="width:15%; text-align:right;">Unit Price</th>
        <th style="width:20%; text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${
        printLines.map(l => {
          const qty = (l.qty || 1);
          // APPLY FX HERE
          const unit = Number(l.sell) / fx;
          const lineTotal = qty * unit;

          return `
            <tr>
              <td>${escapeHtml(safe(l.code, ''))}</td>
              <td><div class="td-desc">${escapeHtml(safe(l.desc, ''))}</div></td>
              <td style="text-align:center;">${escapeHtml(String(qty))}</td>
              <td style="text-align:right;">${escapeHtml(money(unit))}</td>
              <td style="text-align:right;">${escapeHtml(money(lineTotal))}</td>
            </tr>
          `;
        }).join('')
      }
    </tbody>
  </table>

  <div class="footer-main">
    <div class="footer-left">
      <div class="amt-words">${escapeHtml(amtInWords)}</div>
      <div class="remarks-box">
        <div class="remarks-head">Remarks / Conditions</div>
        <div class="remarks-body">${escapeHtml(safe(config.headerNote, ''))}</div>
      </div>
    </div>

    <div class="footer-right">
      <table class="totals-table">
        <tr><td>Total H.T.</td><td style="text-align:right;">${escapeHtml(money(sumHT))}</td></tr>
        <tr><td>Total VAT</td><td style="text-align:right;">${escapeHtml(money(vat))}</td></tr>
        <tr><td><strong>NET PAYABLE</strong></td><td style="text-align:right;"><strong>${escapeHtml(money(ttc))} ${escapeHtml(config.currency)}</strong></td></tr>
      </table>

      <div class="sig-block">
        <div class="sig-title">MANAGEMENT</div>
        <img src="../../../assets/img/signature-dg.svg" class="sig-img" alt="Signature & Stamp">
      </div>
    </div>
  </div>

  <div class="content-fill"></div>

  <div class="footer-container">
    <div class="statutory-bar">
      <div class="statutory-row">
        <span><strong>RC:</strong> RC/DLA/2021/B/2060</span>
        <span><strong>NIU:</strong> M042116033580Q</span>
      </div>
      <div class="statutory-row" style="margin-top:4px; border-top:1px dashed #999; padding-top:4px;">
        <span><strong>BANK DETAILS:</strong> ${escapeHtml(safe(config.bank, 'See Above'))}</span>
      </div>
      <div class="statutory-row" style="margin-top:4px; color:#666; font-size:0.5rem;">
        <span>SECURE ID: ${escapeHtml(safe(currentSim?.verification_hash, 'PENDING_SAVE'))}</span>
        <span>Generated by Smart LS | ${escapeHtml(new Date().toLocaleString())}</span>
      </div>
    </div>
  </div>

  <script>
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 300);
    });
  <\/script>
</body>
</html>
  `;

  // ---- PRINT VIA HIDDEN IFRAME (no blob URL shown in page content) ----
  let frame = document.getElementById('printFrame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'printFrame';
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    document.body.appendChild(frame);
  }

  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Background quote save
  if (isQuote) {
      const modalEl = document.getElementById('quoteSetupModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    try {
      await apiJson(`${API_BASE}/quote.php`, {
        method: 'POST',
        body: JSON.stringify({
          simulation_ref: currentSim.simulation_ref,
          validity: config.validity,
          terms: config.terms,
          currency: config.currency,
          fx_rate: fx,  // SAVE THE RATE
          bank_details: config.bank,
          header_note: config.headerNote,
          total_ht: 0,
          total_vat: 0,
          total_ttc: 0,
          quote_amount_ttc: totalVal // SAVES CONVERTED TOTAL
        })
      });
      await renderDashboard(true);
      currentSim.status = 'QUOTED'; 
      updateFooter();
      setupSimUI(currentSim, currentLines, false);
    } catch (e) {
      console.warn("Quote background save failed", e);
    }
  }
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

        // 0) If this is a NEW simulation (lazy UI), create it FIRST (so we don't post NEW-SIM)
if (currentSim.id === 0 || !currentSim.simulation_ref || currentSim.simulation_ref === 'NEW-SIM') {
  const created = await apiJson(`${API_BASE}/create.php`, { method: 'POST' });

  // Expect: { ok:true, simulation:{ id, simulation_ref, ... } }
  currentSim.id = Number(created.simulation?.id || created.simulation?.simulation_id || 0);
  currentSim.simulation_ref = String(created.simulation?.simulation_ref || '');

  if (!currentSim.id || !currentSim.simulation_ref) {
    throw new Error('Failed to initialize simulation before linking costing.');
  }

  // Update UI ref immediately
  const refEl = document.getElementById('sim-ref-display');
  if (refEl) refEl.innerText = currentSim.simulation_ref;
}

// 1) Now link costing with REAL identifiers
const res = await apiJson(`${API_BASE}/link-costing.php`, {
  method: 'POST',
  body: JSON.stringify({
    simulation_id: currentSim.id,
    simulation_ref: currentSim.simulation_ref,
    costing_id: costingId
  })
});


        // 2) Check for Redirect (Option B logic)
        if (res.redirect) {
          // A simulation already exists! Load it instead.
          await openSim(res.redirect, true);
        } else {
          // Success: The backend created/updated the record.
          // If we were lazy (ID=0), we now have a real ID. Update state.
          if (currentSim.id === 0 && res.simulation_id) {
            currentSim.id = res.simulation_id;
            currentSim.simulation_ref = res.simulation_ref;
          }
          // Reload to show imported lines
          await openSim(currentSim.simulation_ref, true);
        }
      });

      // refresh list every 30s
      setInterval(() => renderDashboard(true), 30000);
    })();
    
    /* --- PATCH 3.1: HELPERS & TRANSLATION --- */
    
    // Challenge 19: Loading State Helper
    function setLoading(btnId, isLoading) {
        const btn = document.getElementById(btnId);
        if(!btn) return;
        if(isLoading) {
            btn.dataset.originalText = btn.innerHTML;
            btn.classList.add('btn-loading');
        } else {
            btn.classList.remove('btn-loading');
            if(btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
        }
    }

    // Challenge 27: Number to Words (French & English)
    function toWords(n, lang = 'EN') {
  const num = Math.floor(Number(n || 0));
  if (!Number.isFinite(num) || num < 0) return '';
  if (lang === 'FR') return toWordsFR(num);
  return toWordsEN(num);
}

function toWordsEN(n) {
  const a = [
    '', 'ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN',
    'ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN','SEVENTEEN','EIGHTEEN','NINETEEN'
  ];
  const b = ['', '', 'TWENTY','THIRTY','FORTY','FIFTY','SIXTY','SEVENTY','EIGHTY','NINETY'];

  const inWords = (x) => {
    if (x < 20) return a[x];
    if (x < 100) return (b[Math.floor(x/10)] + (x%10 ? ' ' + a[x%10] : '')).trim();
    if (x < 1000) return (a[Math.floor(x/100)] + ' HUNDRED' + (x%100 ? ' ' + inWords(x%100) : '')).trim();
    return '';
  };

  if (n === 0) return 'ZERO';

  let res = '';
  const parts = [
    { v: 1_000_000_000, label: 'BILLION' },
    { v: 1_000_000,     label: 'MILLION' },
    { v: 1_000,         label: 'THOUSAND' },
    { v: 1,             label: '' }
  ];

  let rem = n;
  for (const p of parts) {
    if (rem >= p.v) {
      const chunk = Math.floor(rem / p.v);
      rem = rem % p.v;
      res += (res ? ' ' : '') + inWords(chunk) + (p.label ? ' ' + p.label : '');
    }
  }
  return res.trim();
}

function toWordsFR(n) {
  // Practical FR (not perfect Académie rules, but good for invoices)
  const u = ['','UN','DEUX','TROIS','QUATRE','CINQ','SIX','SEPT','HUIT','NEUF','DIX','ONZE','DOUZE','TREIZE','QUATORZE','QUINZE','SEIZE','DIX-SEPT','DIX-HUIT','DIX-NEUF'];
  const t = ['','DIX','VINGT','TRENTE','QUARANTE','CINQUANTE','SOIXANTE'];

  const below100 = (x) => {
    if (x < 20) return u[x];
    if (x < 70) {
      const ten = Math.floor(x/10);
      const one = x%10;
      if (one === 1 && ten > 1) return (t[ten] + ' ET UN');
      return (t[ten] + (one ? '-' + u[one] : '')).trim();
    }
    if (x < 80) return ('SOIXANTE-' + below100(x-60)).trim();       // 70-79
    return ('QUATRE-VINGT' + (x===80 ? '' : '-' + below100(x-80))).trim(); // 80-99
  };

  const below1000 = (x) => {
    if (x < 100) return below100(x);
    const h = Math.floor(x/100);
    const r = x%100;
    let s = (h === 1) ? 'CENT' : (u[h] + ' CENT');
    if (r) s += ' ' + below100(r);
    return s.trim();
  };

  if (n === 0) return 'ZERO';

  let res = '';
  const parts = [
    { v: 1_000_000_000, label: 'MILLIARD' },
    { v: 1_000_000,     label: 'MILLION' },
    { v: 1_000,         label: 'MILLE' },
    { v: 1,             label: '' }
  ];

  let rem = n;
  for (const p of parts) {
    if (rem >= p.v) {
      const chunk = Math.floor(rem / p.v);
      rem = rem % p.v;

      if (p.label === 'MILLE') {
        res += (res ? ' ' : '') + (chunk === 1 ? 'MILLE' : (below1000(chunk) + ' MILLE'));
      } else if (p.label) {
        res += (res ? ' ' : '') + below1000(chunk) + ' ' + (chunk > 1 ? (p.label + 'S') : p.label);
      } else {
        res += (res ? ' ' : '') + below1000(chunk);
      }
    }
  }
  return res.trim();
}

  </script>
</body>
</html>
