<?php
declare(strict_types=1);

/**
 * FILE: dashboard_merged.php
 * Merges: (a) top bar, sidebar and name section from the "second" PHP file
 *         into (b) the first static dashboard HTML you provided.
 *
 * Usage: place under same path as other app pages. Requires includes/init.php and role_guard.php
 * Note: This file only injects sidebar + topbar (with user name/avatar/greeting). Rest of the page (KPIs/charts) is the original first HTML.
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['MANAGEMENT']);

// --- Fetch current user details ---
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
$stmt->close();

if (!$me) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

$fullName = $me['full_name'] ?: 'Management User';
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'MANAGEMENT'));
$roleLabel = $roleLabelMap[$role] ?? 'MANAGEMENT';

$avatarName = urlencode($fullName);
$avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

// keep DB connection open for other includes if necessary
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Management Dashboard | Smart LS</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../../css/admin.css">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

    <style>
        :root {
            --smart-blue: #1F99D8;
            --smart-dark: #055B83;
            --smart-orange: #EE7D04;
            --smart-charcoal: #231F20;
            --smart-bg: #F0F4F8;
            --sidebar-width: 280px; /* Slightly wider for long names */

            /* SmartComm defaults (from previous file) */
            --comm-w: min(520px, 92vw);
            --comm-radius: 18px;
            --comm-shadow: 0 20px 60px rgba(0,0,0,.18);
            --comm-ink: #0f172a;
            --comm-muted: rgba(15, 23, 42, .65);
            --comm-accent1: #0b5ed7;
            --comm-accent2: #ff6600;
            --comm-accent3: #20c997;
        }

        body {
            font-family: 'Manrope', sans-serif;
            background-color: var(--smart-bg);
            color: var(--smart-charcoal);
            overflow-x: hidden;
        }

        h1, h2, h3, h4, h5, h6 { font-family: 'Montserrat', sans-serif; }

        /* --- SIDEBAR --- */
        .sidebar {
            width: var(--sidebar-width);
            height: 100vh;
            position: fixed;
            top: 0;
            left: 0;
            background-color: #ffffff;
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
            font-weight: 800;
            font-size: 1.1rem;
            color: var(--smart-charcoal);
            text-decoration: none;
            letter-spacing: -0.5px;
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

        .sidebar-footer { border-top: 1px solid #f0f0f0; padding: 16px; }

        /* --- MAIN LAYOUT --- */
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
            background-color: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid #e0e0e0;
            z-index: 900;
            padding: 0 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        /* --- MANAGEMENT WIDGETS --- */
        .mgmt-banner {
            background: linear-gradient(135deg, #1a1a1a 0%, #333333 100%);
            color: white;
            border-radius: 12px;
            padding: 1.5rem 2rem;
            position: relative;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.15);
            width: 100%;
        }

        .card-custom {
            background: white;
            border-radius: 12px;
            border: 1px solid rgba(0,0,0,0.05);
            box-shadow: 0 2px 12px rgba(0,0,0,0.02);
            height: 100%;
            transition: transform 0.2s;
        }
        .card-custom:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,0,0,0.05); }

        .kpi-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.5px; white-space: nowrap; }
        .kpi-value { font-size: 1.6rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.2; font-variant-numeric: tabular-nums; }
        .trend-badge { font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; }
        .trend-up { color: #10B981; background: #ecfdf5; }
        .trend-down { color: #EF4444; background: #fef2f2; }

        .table-custom th { font-size: 0.75rem; text-transform: uppercase; color: #888; font-weight: 700; border-bottom: 2px solid #f0f0f0; }
        .table-custom td { font-size: 0.85rem; vertical-align: middle; padding: 12px 8px; }

        .clock-pill {
            background: #f1f5f9; padding: 6px 12px; border-radius: 30px;
            display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 600; color: var(--smart-dark);
        }
        .btn-clock {
            background: #e2e8f0; border: none; border-radius: 20px;
            padding: 4px 12px; font-size: 0.75rem; font-weight: 700; color: #64748b; transition: 0.3s;
        }
        .btn-clock.active { background: var(--smart-orange); color: white; box-shadow: 0 2px 10px rgba(238, 125, 4, 0.3); }

        /* --- SMART COMM STYLES (copied from previous SmartComm file) --- */
        /* Button: glass + premium */
        .smart-comm-btn{
          background: linear-gradient(135deg, rgba(11,94,215,.22), rgba(255,102,0,.18));
          border: 1px solid rgba(255,255,255,.42);
          color: #fff;
          padding: 10px 22px;
          border-radius: 999px;
          font-weight: 800;
          letter-spacing: .4px;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 12px 26px rgba(0,0,0,.14);
          backdrop-filter: blur(10px);
          transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
          position: relative;
        }
        .smart-comm-btn:hover{
          transform: translateY(-1px);
          box-shadow: 0 16px 34px rgba(0,0,0,.18);
          filter: brightness(1.06);
        }
        .comm-badge{
          position: absolute;
          top: -6px;
          right: -6px;
          min-width: 22px;
          height: 22px;
          padding: 0 6px;
          border-radius: 999px;
          display: none;
          align-items: center;
          justify-content: center;
          font-size: .72rem;
          font-weight: 900;
          background: #ff3333;
          border: 2px solid rgba(255,255,255,.85);
          box-shadow: 0 8px 18px rgba(255,51,51,.30);
        }

        /* Overlay behavior */
        body.chat-active { overflow: hidden; }

        .comm-backdrop{
          position: fixed;
          inset: 0;
          z-index: 1029;
          background:
            radial-gradient(1200px 800px at 85% 20%, rgba(255,102,0,.22), transparent 60%),
            radial-gradient(1000px 700px at 70% 85%, rgba(11,94,215,.20), transparent 60%),
            rgba(0,0,0,.25);
          opacity: 0;
          pointer-events: none;
          transition: opacity .25s ease;
          backdrop-filter: blur(2px);
        }
        body.chat-active .comm-backdrop{ opacity: 1; pointer-events: auto; }

        .comm-drawer{
          position: fixed;
          top: 70px;
          right: 0;
          width: var(--comm-w);
          height: calc(100vh - 70px);
          z-index: 1030;
          transform: translateX(110%);
          transition: transform .32s cubic-bezier(.2,.9,.2,1);
          border-left: 1px solid rgba(255,255,255,.20);
          box-shadow: var(--comm-shadow);
          overflow: hidden;
          border-top-left-radius: var(--comm-radius);
          border-bottom-left-radius: var(--comm-radius);
          background:
            radial-gradient(900px 600px at 15% 10%, rgba(32,201,151,.22), transparent 60%),
            radial-gradient(900px 600px at 90% 20%, rgba(255,102,0,.18), transparent 55%),
            radial-gradient(1200px 900px at 60% 90%, rgba(11,94,215,.18), transparent 60%),
            linear-gradient(135deg, rgba(255,255,255,.82), rgba(255,255,255,.62));
          backdrop-filter: blur(14px);
        }
        body.chat-active .comm-drawer{ transform: translateX(0); }

        .comm-content{ height: 100%; display: flex; flex-direction: column; }

        .comm-header{
          position: relative;
          padding: 14px 14px;
          border-bottom: 1px solid rgba(15, 23, 42, .08);
          background:
            linear-gradient(90deg, rgba(11,94,215,.14), rgba(255,102,0,.12), rgba(32,201,151,.10)),
            rgba(255,255,255,.55);
          backdrop-filter: blur(10px);
        }
        .comm-header::after{
          content:''; position:absolute; left:14px; right:14px; bottom:-1px; height:2px;
          background: linear-gradient(90deg, var(--comm-accent1), var(--comm-accent2), var(--comm-accent3));
          opacity:.9;
        }

        .comm-icon-badge{
          width: 42px; height: 42px; border-radius: 14px;
          display:flex; align-items:center; justify-content:center;
          color: white;
          background: linear-gradient(135deg, var(--comm-accent1), var(--comm-accent2));
          box-shadow: 0 10px 25px rgba(11,94,215,.20);
        }

        .comm-close-btn{
          width: 38px; height: 38px; border-radius: 14px;
          border: 1px solid rgba(15, 23, 42, .10);
          background: rgba(255,255,255,.55);
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 18px rgba(0,0,0,.08);
        }

        /* Mode switch pills */
        .comm-modes{
          display:flex; gap: 8px; padding: 10px 14px;
          border-bottom: 1px solid rgba(15, 23, 42, .08);
          background: rgba(255,255,255,.35);
        }
        .mode-pill{
          border: 1px solid rgba(15, 23, 42, .12);
          background: rgba(255,255,255,.60);
          backdrop-filter: blur(10px);
          border-radius: 999px;
          padding: 7px 12px;
          font-weight: 900;
          font-size: .78rem;
          color: rgba(15,23,42,.72);
          cursor:pointer;
          transition: transform .12s ease, box-shadow .12s ease;
        }
        .mode-pill.active{
          color: #0b1b33;
          border-color: rgba(255,102,0,.35);
          background: linear-gradient(135deg, rgba(11,94,215,.14), rgba(255,102,0,.10));
        }
        .mode-pill:hover{ transform: translateY(-1px); box-shadow: 0 10px 18px rgba(0,0,0,.08); }

        /* Search */
        .chat-top-search{
          padding: 12px 14px;
          border-bottom: 1px solid rgba(15, 23, 42, .08);
          background: rgba(255,255,255,.45);
          backdrop-filter: blur(10px);
        }
        .global-search-input{
          border: 1px solid rgba(15, 23, 42, .12);
          border-radius: 999px;
          padding: 8px 14px;
          width: 100%;
          font-size: .9rem;
          background: rgba(255,255,255,.70);
          outline: none;
        }

        /* --- PATCH: SINGLE LINE HORIZONTAL SCROLL (DM LIST) --- */
        .channel-tabs {
            display: flex;
            flex-wrap: nowrap !important;
            overflow-x: auto;              
            overflow-y: hidden;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(15, 23, 42, .08);
            background: rgba(255,255,255,.35);
            scrollbar-width: none; 
        }
        .channel-tabs::-webkit-scrollbar { display: none; }

        /* --- COMPACT BOX STYLING --- */
        .channel-box {
            flex: 0 0 auto;
            min-width: 140px; 
            max-width: 140px;
            height: 48px;
            padding: 0 10px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: flex-start;
            line-height: 1.3;
            
            border: 1px solid rgba(15, 23, 42, .12);
            background: rgba(255,255,255,.65);
            border-radius: 14px;
            font-weight: 900;
            letter-spacing: .2px;
            font-size: .82rem;
            color: rgba(15,23,42,.78);
            cursor: pointer;
            transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease, filter .12s ease;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .channel-box .small {
            font-size: 0.65rem !important;
            opacity: 0.8;
            letter-spacing: 0.3px;
            margin-top: 2px;
            font-weight: 500 !important;
        }
        .channel-box:hover{
            transform: translateY(-1px);
            box-shadow: 0 12px 22px rgba(0,0,0,.10);
            border-color: rgba(255,102,0,.25);
            filter: brightness(1.02);
        }
        .channel-box.active{
            color: #0b1b33;
            border-color: rgba(255,102,0,.35);
            background: linear-gradient(135deg, rgba(11,94,215,.16), rgba(255,102,0,.10));
        }
        
        .channel-skeleton{
          flex: 0 0 auto; min-width: 140px; height: 48px;
          border-radius: 14px;
          border: 1px solid rgba(15, 23, 42, .10);
          background: linear-gradient(90deg, rgba(255,255,255,.45), rgba(255,255,255,.70), rgba(255,255,255,.45));
          background-size: 200% 100%;
          animation: shimmer 1.2s infinite linear;
        }
        @keyframes shimmer{ 0%{background-position: 0 0;} 100%{background-position: -200% 0;} }

        /* Messages */
        .messages-scroll-area{
          flex:1; overflow-y:auto; padding: 14px;
          display:flex; flex-direction: column; gap: 12px;
        }

        .msg-row{ display:flex; gap: 10px; align-items:flex-start; }
        .msg-row.mine{ flex-direction: row-reverse; }
        .msg-avatar{
          width: 36px; height: 36px; border-radius: 12px; object-fit: cover;
          box-shadow: 0 8px 18px rgba(0,0,0,.10);
        }
        .msg-bubble{
          background: rgba(255,255,255,.78);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(15,23,42,.08);
          padding: 12px;
          border-radius: 14px;
          border-top-left-radius: 4px;
          box-shadow: 0 10px 18px rgba(0,0,0,.06);
          font-size: .9rem;
          max-width: 85%;
        }
        .msg-row.mine .msg-bubble{
          background: linear-gradient(135deg, rgba(11,94,215,.92), rgba(0,33,71,.92));
          color: #fff;
          border-top-left-radius: 14px;
          border-top-right-radius: 4px;
          border-color: rgba(255,255,255,.12);
        }
        /* Name styling fix */
        .msg-bubble .fw-bold{ color: rgba(15, 23, 42, .92) !important; font-weight: 900 !important; letter-spacing: .2px; }
        .msg-row.mine .msg-bubble .fw-bold{ color: rgba(255, 255, 255, .92) !important; }

        .msg-meta{ font-size: .72rem; color: rgba(15,23,42,.55); margin-top: 4px; }
        .msg-row.mine .msg-meta{ text-align: right; color: rgba(255,255,255,.72); }

        .urgency-badge{
          font-size: .62rem; padding: 2px 6px; border-radius: 6px;
          font-weight: 900; letter-spacing: .4px; text-transform: uppercase;
          margin-bottom: 4px; display: inline-block;
        }
        .urgency-critical{ background: #dc3545; color: #fff; }
        .urgency-urgent{ background: #ffc107; color: #1f2937; }
        .msg-row.critical .msg-bubble{
          border: 2px solid #dc3545;
          animation: critical-pulse 1.5s infinite;
        }
        @keyframes critical-pulse{
          0% { box-shadow: 0 0 0 0 rgba(220,53,69,.40); }
          70% { box-shadow: 0 0 0 10px rgba(0,0,0,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
        }

        /* Ack Button */
        .msg-bubble button.btn-outline-danger {
            border-width: 2px; font-size: 0.75rem;
            box-shadow: 0 4px 6px rgba(220, 53, 69, 0.1);
            transition: all 0.2s ease;
        }
        .msg-bubble button.btn-outline-danger:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 10px rgba(220, 53, 69, 0.2);
        }

        /* Input */
        .chat-input-zone{
          padding: 12px 12px 14px;
          border-top: 1px solid rgba(15, 23, 42, .08);
          background: rgba(255,255,255,.55);
          backdrop-filter: blur(12px);
        }
        .input-wrapper{
          border-radius: 18px;
          border: 1px solid rgba(15, 23, 42, .12);
          background: rgba(255,255,255,.65);
          display:flex; align-items:flex-end; gap: 8px; padding: 8px 10px;
        }
        .chat-textarea{
          width:100%; border:none; outline:none; background: transparent;
          resize:none; min-height: 42px; max-height: 120px;
          padding: 6px 8px; font-size: .92rem; color: var(--comm-ink);
        }

        @media (max-height: 640px){
          .comm-drawer{ top: 0; height: 100vh; border-radius: 0; }
        }
    </style>
</head>
<body>

    <!-- === SIDEBAR (from second file) === -->
    <nav class="sidebar">
        <div class="sidebar-header">
            <a href="../../index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
        </div>

        <div class="px-3 mb-2 mt-2">
            <a href="index" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
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
                <div id="mgmt6" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                    <div class="sub-menu">
                        <a href="ash-request.php" class="sub-link">Cash Request</a>
                        <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                        <a href="proforma-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
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

    <!-- === TOP NAV (from second file) === -->
    <div class="top-navbar">
        <div>
            <h5 class="mb-0 fw-bold text-dark">Executive Oversight Command</h5>
            <small class="text-muted" style="font-size: 0.7rem;">STRATEGIC PROFITABILITY & CORPORATE GOVERNANCE</small>
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

    <!-- === MAIN CONTENT (kept from your first HTML) === -->
    <div class="main-content px-4 pb-5">

        <div class="row pt-4 mb-4">
            <div class="col-12">
                <div class="mgmt-banner d-flex justify-content-between align-items-center">
                    <div>
                        <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>!</h2>
                        <p class="mb-0 opacity-75">Executive Summary: Performance metrics are trending positive.</p>
                    </div>

                    <!-- SMART COMM LAUNCH BUTTON (added) -->
                    <div class="mx-3 d-flex align-items-center">
                      <button type="button" onclick="toggleChat()" class="smart-comm-btn">
                        <i class="fa-solid fa-satellite-dish fs-5"></i>
                        <span>SMART COMM HUB</span>
                        <div class="comm-badge" id="commBadge">0</div>
                      </button>
                    </div>

                    <div class="text-end" style="min-width: 150px;">
                        <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">Target Status</div>
                        <div class="d-flex align-items-center justify-content-end gap-2">
                            <i class="fa-solid fa-bullseye text-success fs-5"></i>
                            <span class="fw-bold fs-5">ON TRACK</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- KPI row -->
        <div class="row g-3 mb-4">
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-chart-line"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Total Revenue (YTD)</div>
                        <div class="kpi-value" id="kpi-revenue">—</div>
                        <div class="trend-badge trend-up"><i class="fa-solid fa-arrow-up"></i> 12% vs Target</div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-percent"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Net Margin</div>
                        <div class="kpi-value" id="kpi-margin">—</div>
                        <div class="trend-badge trend-up"><i class="fa-solid fa-arrow-up"></i> 1.5% vs Last Mo</div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-info bg-opacity-10 text-info d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-boxes-stacked"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Active Files</div>
                        <div class="kpi-value" id="kpi-files">—</div>
                        <span class="text-muted" style="font-size: 0.7rem; font-weight: 600;" id="kpi-files-breakdown">—</span>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Critical Risks</div>
                        <div class="kpi-value text-danger" id="kpi-risks">—</div>
                        <span class="text-danger" style="font-size: 0.7rem; font-weight: 600;">Action Required</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Approvals table -->
        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-signature text-primary me-2"></i>Executive Approvals Required</h5>
                        <span class="badge bg-danger rounded-pill" id="approvals-count">—</span>
                    </div>

                    <div class="table-responsive">
                        <table class="table table-hover table-custom mb-0" id="approvals-table">
                            <thead class="bg-light">
                                <tr>
                                    <th style="width: 10%;">Date</th>
                                    <th style="width: 25%;">Request Type</th>
                                    <th style="width: 40%;">Description & Justification</th>
                                    <th style="width: 15%;" class="text-end">Value (XAF)</th>
                                    <th style="width: 10%;" class="text-end">Decision</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- Charts -->
        <div class="row g-4">
            <div class="col-lg-8">
                <div class="card-custom p-4 h-100">
                    <div class="d-flex justify-content-between align-items-center mb-4">
                        <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-chart-column text-primary me-2"></i>Revenue vs Cost (YTD)</h5>
                        <select class="form-select form-select-sm" id="chart-year-select" style="width: 100px;">
                        </select>
                    </div>
                    <div style="height: 300px;">
                        <canvas id="revenueChart"></canvas>
                    </div>
                </div>
            </div>

            <div class="col-lg-4">
                <div class="card-custom p-4 h-100">
                    <h5 class="fw-bold mb-4 text-dark"><i class="fa-solid fa-chart-pie text-info me-2"></i>Volume by Mode</h5>
                    <div style="height: 300px; display: flex; justify-content: center;">
                        <canvas id="modeChart"></canvas>
                    </div>
                </div>
            </div>
        </div>

    </div> <!-- /.main-content -->

    <!-- SMART COMM BACKDROP & DRAWER (copied exactly from previous file) -->
    <div class="comm-backdrop" id="commBackdrop" onclick="toggleChat(false)"></div>

    <div class="comm-drawer" id="commDrawer" aria-hidden="true">
      <div class="comm-content">

        <div class="comm-header d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-3">
            <div class="comm-icon-badge">
              <i class="fa-solid fa-satellite-dish"></i>
            </div>
            <div>
              <div id="commDrawerTitle" class="fw-bold" style="color: var(--smart-blue); font-size: 1.02rem;">Communication Hub</div>
              <div class="d-flex align-items-center gap-2" style="font-size: 0.75rem;">
                <span class="badge bg-success rounded-pill" style="width: 8px; height: 8px; padding: 0;"></span>
                <span class="text-muted">Connected (Live)</span>
              </div>
            </div>
          </div>
          <button type="button" class="comm-close-btn" onclick="toggleChat(false)" aria-label="Close">
            <i class="fa-solid fa-times"></i>
          </button>
        </div>

        <div class="comm-modes">
          <button type="button" class="mode-pill active" id="commModeChannels">CHANNELS</button>
          <button type="button" class="mode-pill" id="commModeDm">DIRECT MESSAGES</button>
        </div>

        <div class="chat-top-search">
          <input type="text" class="global-search-input" id="commSearch" placeholder="Filter loaded messages..." />
        </div>

        <div class="channel-tabs" id="channelTabs">
          <div class="channel-skeleton"></div>
          <div class="channel-skeleton"></div>
          <div class="channel-skeleton"></div>
          <div class="channel-skeleton"></div>
          <div class="channel-skeleton"></div>
        </div>

        <div class="messages-scroll-area" id="chatFeed">
          <div class="text-center mt-4 opacity-75">
            <div class="spinner-border text-primary" role="status"></div>
            <div class="mt-2 small">Connecting to secure server...</div>
          </div>
        </div>

        <div class="chat-input-zone">
          <div class="input-wrapper">
            <textarea class="chat-textarea" id="chatInput" placeholder="Type a message..."></textarea>
            <div class="d-flex align-items-center gap-2 p-1">
              <select class="form-select form-select-sm border-0 bg-transparent fw-bold text-secondary" style="width: auto;" id="urgencySelect">
                <option value="NORMAL">Normal</option>
                <option value="URGENT">Urgent</option>
                <option value="CRITICAL" class="text-danger">CRITICAL</option>
              </select>
              <button type="button" class="btn btn-primary btn-sm rounded-circle" onclick="sendMessage()" style="width: 35px; height: 35px;">
                <i class="fa-solid fa-paper-plane"></i>
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>

    <!-- SmartComm core (kept the same path & version param you used) -->
    <script src="../../js/smart-comm-core.js?v=4.0"></script>

    <script>
        function updateClock() {
            const now = new Date();
            document.getElementById('realtime-clock').innerText = now.toLocaleTimeString();
        }
        setInterval(updateClock, 1000);
        updateClock();

        function toggleClock() {
            const btn = document.getElementById('btn-clock');
            if(btn.classList.contains('active')) {
                btn.classList.remove('active');
                btn.innerHTML = '<i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>';
            } else {
                btn.classList.add('active');
                btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Clocked In</span>';
            }
        }

        // Minimal client-side loader code retained from your first file for charts & approvals.
        async function fetchJSON(url, opts={}) {
            const res = await fetch(url, opts);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            return res.json();
        }

        function fmtMoney(n){ return (n===null||n===undefined) ? '—' : new Intl.NumberFormat('en-US').format(Math.round(n)); }

        async function loadKPIs() {
            try {
                // Fetch the new JSON structure
                const data = await fetchJSON('../../api/management-dashboard/kpi_summary.php');

                // 1. UPDATE FINANCIAL CARDS (Revenue & Margin)
                // Note: The API now returns 'financials_detailed'
                const fin = data.financials_detailed;
                
                // Revenue
                document.getElementById('kpi-revenue').innerText = fmtMoney(fin.current.revenue);
                // Revenue Trend Badge
                const revBadge = document.querySelector('#kpi-revenue').nextElementSibling;
                updateTrendBadge(revBadge, fin.rev_growth_pct);

                // Margin
                document.getElementById('kpi-margin').innerText = fmtMoney(fin.current.margin);
                // Margin Trend Badge
                const marginBadge = document.querySelector('#kpi-margin').nextElementSibling;
                updateTrendBadge(marginBadge, fin.margin_growth_pct);

                // 2. UPDATE ACTIVE FILES (Legacy structure preserved in API)
                document.getElementById('kpi-files').innerText = data.active_files.total;
                document.getElementById('kpi-files-breakdown').innerText = 
                    `${data.active_files.by_mode.SEA||0} Sea, ${data.active_files.by_mode.AIR||0} Air, ${data.active_files.by_mode.ROAD||0} Road`;

                // 3. UPDATE CRITICAL RISKS CARD
                const riskVal = document.getElementById('kpi-risks');
                riskVal.innerText = data.critical_risks_count;
                
                // Make the Risk Card clickable/interactive
                const riskCard = riskVal.closest('.card-custom');
                if(data.critical_risks_count > 0) {
                    riskCard.style.cursor = 'pointer';
                    riskCard.style.border = '1px solid #dc3545'; // Red border visual cue
                    riskCard.onclick = () => showRiskModal(data.risk_details, data.critical_risks_count);
                } else {
                    riskCard.style.cursor = 'default';
                    riskCard.style.border = '1px solid rgba(0,0,0,0.05)';
                    riskCard.onclick = null;
                }

                // 4. UPDATE TARGET STATUS BADGE (Top Right)
                // data.status_engine.badge will be ON_TRACK, AT_RISK, or OFF_TRACK
                const statusContainer = document.querySelector('.mgmt-banner .text-end .d-flex');
                let badgeHtml = '';
                const s = data.status_engine.badge;
                
                if (s === 'ON_TRACK') {
                    badgeHtml = `<i class="fa-solid fa-bullseye text-success fs-5"></i><span class="fw-bold fs-5 text-white">ON TRACK</span>`;
                } else if (s === 'AT_RISK') {
                    badgeHtml = `<i class="fa-solid fa-triangle-exclamation text-warning fs-5"></i><span class="fw-bold fs-5 text-warning">AT RISK</span>`;
                } else { // OFF_TRACK
                    badgeHtml = `<i class="fa-solid fa-ban text-danger fs-5"></i><span class="fw-bold fs-5 text-danger">OFF TRACK</span>`;
                }
                statusContainer.innerHTML = badgeHtml;

                // 5. UPDATE EXECUTIVE SUMMARY TEXT
                const summaryEl = document.querySelector('.mgmt-banner p.opacity-75');
                if(summaryEl) summaryEl.innerText = "Executive Summary: " + data.status_engine.summary;

            } catch (e) {
                console.error('KPIs error', e);
            }
        }

        // Helper: Update the small trend badges (green arrow / red arrow)
        function updateTrendBadge(el, pct) {
            if (!el) return;
            const val = parseFloat(pct);
            // Infinite growth (prev was 0) check
            const safeVal = isFinite(val) ? val.toFixed(1) : '0.0';
            
            if (val >= 0) {
                el.className = 'trend-badge trend-up';
                el.innerHTML = `<i class="fa-solid fa-arrow-up"></i> ${safeVal}% vs Last Mo`;
            } else {
                el.className = 'trend-badge trend-down';
                el.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${Math.abs(safeVal)}% vs Last Mo`;
            }
        }

        // Helper: Populate and Show Modal
        function showRiskModal(risks, totalCount) {
            const modalEl = document.getElementById('riskModal');
            const listEl = document.getElementById('risk-list-items');
            document.getElementById('modal-risk-count').innerText = totalCount;
            
            listEl.innerHTML = ''; // Clear previous

            // Limit to 100
            const limit = 100;
            const displayList = risks.slice(0, limit);

            displayList.forEach((r, index) => {
                const li = document.createElement('li');
                li.className = 'list-group-item p-3 border-bottom';
                
                // Icon based on type
                let icon = '<i class="fa-solid fa-triangle-exclamation text-danger"></i>';
                let badge = '<span class="badge bg-danger">CRITICAL</span>';
                
                if (r.type === 'DEMURRAGE') {
                    icon = '<i class="fa-solid fa-anchor text-primary"></i>';
                    badge = '<span class="badge bg-primary">DEMURRAGE</span>';
                } else if (r.type === 'UNBILLED') {
                    icon = '<i class="fa-solid fa-file-invoice-dollar text-warning"></i>';
                    badge = '<span class="badge bg-warning text-dark">UNBILLED</span>';
                } else if (r.type === 'INTEGRITY') {
                    icon = '<i class="fa-solid fa-database text-secondary"></i>';
                    badge = '<span class="badge bg-secondary">DATA ERROR</span>';
                }

                li.innerHTML = `
                    <div class="d-flex align-items-start gap-3">
                        <div class="mt-1 fs-5">${index + 1}.</div>
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between mb-1">
                                <span class="fw-bold text-dark font-monospace">${r.file_ref}</span>
                                ${badge}
                            </div>
                            <div class="text-muted small" style="line-height: 1.4;">
                                ${r.message} 
                            </div>
                        </div>
                    </div>
                `;
                listEl.appendChild(li);
            });

            // Show "And X more..." if needed
            if (totalCount > limit) {
                const li = document.createElement('li');
                li.className = 'list-group-item text-center text-muted fst-italic py-3';
                li.innerText = `... and ${totalCount - limit} more critical items.`;
                listEl.appendChild(li);
            }

            // Bootstrap 5 Modal Show
            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        }

        async function loadApprovals(){
            try {
                const data = await fetchJSON('../../api/management-dashboard/approvals.php');
                document.getElementById('approvals-count').innerText = data.count;
                const tbody = document.querySelector('#approvals-table tbody');
                tbody.innerHTML = '';
                data.rows.forEach(r=>{
                    const tr = document.createElement('tr');
                    const tdDate = document.createElement('td'); tdDate.className='text-muted'; tdDate.innerText = r.display_date;
                    const tdType = document.createElement('td'); tdType.innerHTML = `<span class="badge ${r.badge_class}">${r.type}</span>`;
                    const tdDesc = document.createElement('td'); tdDesc.innerHTML = `<strong>${r.title}</strong><br><span class="text-muted" style="font-size:.75rem;">${r.subtitle||''}</span>`;
                    const tdVal = document.createElement('td'); tdVal.className='text-end fw-bold'; tdVal.innerText = r.value_text || 'N/A';
                    const tdAct = document.createElement('td'); tdAct.className='text-end';
                    tdAct.innerHTML = `<button class="btn btn-sm btn-success py-0 px-2 me-1 approve-btn" data-id="${r.id}" data-src="${r.source}" data-action="approve"><i class="fa-solid fa-check"></i></button>
                                       <button class="btn btn-sm btn-outline-danger py-0 px-2 reject-btn" data-id="${r.id}" data-src="${r.source}" data-action="reject"><i class="fa-solid fa-xmark"></i></button>`;
                    tr.append(tdDate, tdType, tdDesc, tdVal, tdAct);
                    tbody.appendChild(tr);
                });
            } catch(e){
                console.error('Approvals error', e);
            }
        }

        document.addEventListener('click', async (ev) => {
            const t = ev.target.closest('button[data-action]');
            if(!t) return;
            const id = t.getAttribute('data-id');
            const source = t.getAttribute('data-src');
            const action = t.getAttribute('data-action');
            if(!id || !source || !action) return;
            t.disabled = true;
            try {
                const payload = { id, source, action, performed_by_user_id: <?php echo (int)$userId; ?> };
                const res = await fetchJSON('../../api/management-dashboard/approve_action.php', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                if(res.success){
                    await loadApprovals();
                    await loadKPIs();
                } else {
                    alert('Action failed: ' + (res.message || 'unknown'));
                }
            } catch(e){
                console.error('action error', e);
                alert('Action failed');
            } finally {
                t.disabled = false;
            }
        });

        let revenueChart = null, modeChart = null;

        async function loadCharts(year=null){
            try {
                const q = year ? `?year=${encodeURIComponent(year)}` : '';
                const d = await fetchJSON('../../api/management-dashboard/chart_data.php' + q);
                const ctxR = document.getElementById('revenueChart').getContext('2d');
                const ctxM = document.getElementById('modeChart').getContext('2d');
                if(revenueChart) revenueChart.destroy();
                revenueChart = new Chart(ctxR, {
                    type:'bar',
                    data:{ labels: d.labels, datasets:[ { label:'Revenue', data: d.revenue }, { label:'Cost', data: d.cost } ] },
                    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ y:{ beginAtZero:true } } }
                });
                if(modeChart) modeChart.destroy();
                modeChart = new Chart(ctxM, {
                    type:'doughnut',
                    data:{ labels: d.mode_labels, datasets:[ { data: d.mode_values } ] },
                    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } }
                });
                const sel = document.getElementById('chart-year-select');
                sel.innerHTML = '';
                d.available_years.forEach(y => { const o=document.createElement('option'); o.value=y; o.textContent=y; if(y===d.selected_year) o.selected=true; sel.appendChild(o); });
                sel.onchange = () => loadCharts(sel.value);
            } catch(e){ console.error('charts error', e); }
        }

        (function init(){ loadKPIs(); loadApprovals(); loadCharts(); setInterval(loadKPIs,60000); })();
    </script>

    <!-- SMART COMM: toggle + small UX handlers (same behavior as earlier file) -->
    <script>
      // Toggle SmartComm drawer
      function toggleChat(forceState) {
        try {
          const open = (typeof forceState === 'boolean')
            ? forceState
            : !document.body.classList.contains('chat-active');

          document.body.classList.toggle('chat-active', open);
          const drawer = document.getElementById('commDrawer');
          if (drawer) drawer.setAttribute('aria-hidden', open ? 'false' : 'true');

          if (open) {
            setTimeout(() => {
              const input = document.getElementById('chatInput');
              if (input) input.focus();
            }, 120);

            // Hide badge when opened
            const badge = document.getElementById('commBadge');
            if (badge) badge.style.display = 'none';
          }
        } catch (e) {
          console.error('toggleChat error:', e);
        }
      }

      // Esc closes drawer
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && document.body.classList.contains('chat-active')) {
          toggleChat(false);
        }
      });

      // Prevent backdrop close when clicking inside drawer
      (function () {
        const drawer = document.getElementById('commDrawer');
        if (drawer) drawer.addEventListener('click', function (ev) { ev.stopPropagation(); });
      })();
    </script>
<div class="modal fade" id="riskModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-lg"> <div class="modal-content border-0 shadow-lg">
            <div class="modal-header bg-danger text-white">
                <h5 class="modal-title fw-bold">
                    <i class="fa-solid fa-triangle-exclamation me-2"></i>Critical Operational Risks
                </h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body bg-light p-0">
                <div class="p-3 border-bottom bg-white">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <span class="text-muted small text-uppercase fw-bold">Total Risks Detected</span>
                            <div class="fs-4 fw-bold text-dark" id="modal-risk-count">0</div>
                        </div>
                        <div class="text-end">
                            <span class="badge bg-warning text-dark"><i class="fa-solid fa-filter me-1"></i>Showing Top 100</span>
                        </div>
                    </div>
                </div>
                
                <div class="risk-list-container" style="max-height: 60vh; overflow-y: auto;">
                    <ul class="list-group list-group-flush" id="risk-list-items">
                        </ul>
                </div>
            </div>
            <div class="modal-footer bg-white">
                <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Close</button>
            </div>
        </div>
    </div>
</div>
</body>
</html>
