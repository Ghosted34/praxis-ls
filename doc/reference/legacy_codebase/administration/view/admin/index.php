<?php
/**
 * SMART LS ERP - ADMIN DASHBOARD (Governance View)
 * -------------------------------------------------------------------------
 * @author      Development Team (JBS Consulting Inc.)
 * @version     2.1 (Production-Ready)
 * @description Main entry point for System Administrators.
 * Contains Governance KPIs, System Health Monitoring,
 * and the Entry Point for the "Smart Comm Hub".
 * -------------------------------------------------------------------------
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

// --- Fetch current admin details from DB (authoritative profile) ---
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
    em.avatar_path,
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

// --- Safe display values ---
$fullName  = $me['full_name'] ?: 'Admin';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Admin');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'ADMIN'));
$roleLabel = $roleLabelMap[$role] ?? 'ADMIN';

// --- Avatar Logic (Actual Photo vs Placeholder) ---
$dbAvatar = $me['avatar_path'] ?? '';

if (!empty($dbAvatar)) {
    // Uses the uploaded photo from the server
    $avatarUrl = '../../' . $dbAvatar; 
} else {
    // Fallback to initials if no photo is uploaded
    $avatarName = urlencode($fullName);
    $avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";
}

// --- Greeting ---
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

// ----------------------------------------------------------------------------------
// REAL-TIME GOVERNANCE METRICS (Live DB Connection)
// ----------------------------------------------------------------------------------

// 1. KPI: Active Sessions (Real-time count)
$res = $conn->query("SELECT COUNT(*) AS cnt FROM active_sessions");
$kpi_active_sessions = $res->fetch_assoc()['cnt'] ?? 0;

// 2. KPI: Failed Logins (Today)
$stmt = $conn->prepare("SELECT COUNT(*) AS cnt FROM audit_log WHERE action_type = 'LOGIN_FAILED' AND DATE(created_at) = CURRENT_DATE");
$stmt->execute();
$kpi_failed_logins = $stmt->get_result()->fetch_assoc()['cnt'] ?? 0;
$stmt->close();

// 3. KPI: Suspended Users (Cumulative)
$res = $conn->query("SELECT COUNT(*) AS cnt FROM employee_master WHERE status = 'SUSPENDED'");
$kpi_suspended_users = $res->fetch_assoc()['cnt'] ?? 0;

// 4. KPI: System Health (Calculated based on Critical Errors in last 24h)
$res = $conn->query("SELECT COUNT(*) AS cnt FROM audit_log WHERE severity = 'CRITICAL' AND created_at > (NOW() - INTERVAL 24 HOUR)");
$critical_errors = $res->fetch_assoc()['cnt'] ?? 0;
// Logic: Start at 100%, deduct 10% for every critical error
$health_score = max(0, 100 - ($critical_errors * 10)); 
$kpi_api_uptime = $health_score . '%';


// 5. PENDING TASKS AGGREGATOR (Virtual Task List)
$pending_tasks = [];

// Source A: Employees Waiting for Provisioning (Status = PENDING)
$res = $conn->query("SELECT full_name, created_at FROM employee_master WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 5");
while($row = $res->fetch_assoc()){
    $pending_tasks[] = [
        'time' => date('H:i', strtotime($row['created_at'])),
        'req'  => 'HR System',
        'desc' => "Provision access for new hire: <strong>" . e($row['full_name']) . "</strong>",
        'btn'  => '<a href="user-role-management.php" class="btn btn-sm btn-dark px-3">Provision</a>'
    ];
}

// Source B: Critical Security Alerts (Unresolved/Recent)
$res = $conn->query("SELECT details, created_at FROM audit_log WHERE severity = 'CRITICAL' AND created_at > (NOW() - INTERVAL 24 HOUR) ORDER BY created_at DESC LIMIT 3");
while($row = $res->fetch_assoc()){
    $pending_tasks[] = [
        'time' => date('H:i', strtotime($row['created_at'])),
        'req'  => 'Security Bot',
        'desc' => "<span class='text-danger'><i class='fa-solid fa-triangle-exclamation'></i> " . e(substr($row['details'], 0, 50)) . "...</span>",
        'btn'  => '<a href="user-role-management.php?tab=audit" class="btn btn-sm btn-outline-danger px-3">Investigate</a>'
    ];
}

$pending_tasks_count = count($pending_tasks);
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root{
      --comm-w: min(520px, 92vw);
      --comm-radius: 18px;
      --comm-shadow: 0 20px 60px rgba(0,0,0,.18);
      --comm-ink: #0f172a;
      --comm-muted: rgba(15, 23, 42, .65);
      --comm-accent1: #0b5ed7;
      --comm-accent2: #ff6600;
      --comm-accent3: #20c997;
    }

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

    /* Overlay behavior (NO dashboard resize) */
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
    body.chat-active .comm-backdrop{
      opacity: 1;
      pointer-events: auto;
    }

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
      content:'';
      position:absolute;
      left:14px; right:14px; bottom:-1px;
      height:2px;
      background: linear-gradient(90deg, var(--comm-accent1), var(--comm-accent2), var(--comm-accent3));
      opacity:.9;
    }

    .comm-icon-badge{
      width: 42px;
      height: 42px;
      border-radius: 14px;
      display:flex;
      align-items:center;
      justify-content:center;
      color: white;
      background: linear-gradient(135deg, var(--comm-accent1), var(--comm-accent2));
      box-shadow: 0 10px 25px rgba(11,94,215,.20);
    }

    .comm-close-btn{
      width: 38px;
      height: 38px;
      border-radius: 14px;
      border: 1px solid rgba(15, 23, 42, .10);
      background: rgba(255,255,255,.55);
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 18px rgba(0,0,0,.08);
    }

    /* Mode switch pills */
    .comm-modes{
      display:flex;
      gap: 8px;
      padding: 10px 14px;
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

    /* Boxed channel/user selector */
    .channel-tabs{
      display:flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(15, 23, 42, .08);
      background: rgba(255,255,255,.35);
    }
    .channel-box{
      border: 1px solid rgba(15, 23, 42, .12);
      background: rgba(255,255,255,.65);
      border-radius: 14px;
      padding: 10px 12px;
      font-weight: 900;
      letter-spacing: .2px;
      font-size: .82rem;
      color: rgba(15,23,42,.78);
      cursor: pointer;
      transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease, filter .12s ease;
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
      width: 46%;
      min-width: 160px;
      height: 40px;
      border-radius: 14px;
      border: 1px solid rgba(15, 23, 42, .10);
      background: linear-gradient(90deg, rgba(255,255,255,.45), rgba(255,255,255,.70), rgba(255,255,255,.45));
      background-size: 200% 100%;
      animation: shimmer 1.2s infinite linear;
    }
    @keyframes shimmer{ 0%{background-position: 0 0;} 100%{background-position: -200% 0;} }

    /* Messages */
    .messages-scroll-area{
      flex:1;
      overflow-y:auto;
      padding: 14px;
      display:flex;
      flex-direction: column;
      gap: 12px;
    }

    .msg-row{ display:flex; gap: 10px; align-items:flex-start; }
    .msg-row.mine{ flex-direction: row-reverse; }
    .msg-avatar{
      width: 36px; height: 36px;
      border-radius: 12px;
      object-fit: cover;
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
    .msg-meta{ font-size: .72rem; color: rgba(15,23,42,.55); margin-top: 4px; }
    .msg-row.mine .msg-meta{ text-align: right; color: rgba(255,255,255,.72); }

    .urgency-badge{
      font-size: .62rem;
      padding: 2px 6px;
      border-radius: 6px;
      font-weight: 900;
      letter-spacing: .4px;
      text-transform: uppercase;
      margin-bottom: 4px;
      display: inline-block;
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
      display:flex;
      align-items:flex-end;
      gap: 8px;
      padding: 8px 10px;
    }
    .chat-textarea{
      width:100%;
      border:none;
      outline:none;
      background: transparent;
      resize:none;
      min-height: 42px;
      max-height: 120px;
      padding: 6px 8px;
      font-size: .92rem;
      color: var(--comm-ink);
    }
        /* --- PATCH: Make sender name readable in both received + sent bubbles --- */
    
    /* Name line inside each bubble (we target the fw-bold header inside msg-bubble) */
    .msg-bubble .fw-bold{
      color: rgba(15, 23, 42, .92) !important;   /* dark ink on light bubble */
    }
    
    /* When it's MY message (dark gradient bubble), force name to high-contrast */
    .msg-row.mine .msg-bubble .fw-bold{
      color: rgba(255, 255, 255, .92) !important; /* near-white on dark bubble */
    }
    
    /* Optional: make DM/long names stand out a bit more */
    .msg-bubble .fw-bold{
      font-weight: 900 !important;
      letter-spacing: .2px;
    }


    @media (max-height: 640px){
      .comm-drawer{ top: 0; height: 100vh; border-radius: 0; }
    }
    
    /* --- SMART COMM PATCH: DM User List Styling --- */

/* 1. Allow buttons to handle multi-line text (Name + Dept) */
.channel-box {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start; /* Left-align the text */
    line-height: 1.3;
    min-height: 52px; /* Ensure consistent height */
}

/* 2. Style the "Department" text inside the button */
.channel-box .small {
    font-weight: 500 !important; /* Make it lighter than the bold name */
    opacity: 0.8;
    letter-spacing: 0.3px;
    margin-top: 2px;
}

/* 3. Ensure the Acknowledge button in chat stands out */
.msg-bubble button.btn-outline-danger {
    border-width: 2px;
    font-size: 0.75rem;
    box-shadow: 0 4px 6px rgba(220, 53, 69, 0.1);
    transition: all 0.2s ease;
}
.msg-bubble button.btn-outline-danger:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 10px rgba(220, 53, 69, 0.2);
}

/* --- PATCH: SINGLE LINE HORIZONTAL SCROLL --- */

.channel-tabs {
    /* 1. Force items into a single row */
    display: flex;
    flex-wrap: nowrap !important;  /* STOP wrapping to next line */
    
    /* 2. Enable left-right scrolling */
    overflow-x: auto;              
    overflow-y: hidden;
    
    /* 3. Visual cleanup */
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(15, 23, 42, .08);
    
    /* Optional: Hide the scrollbar for a cleaner look (works in Chrome/Safari) */
    scrollbar-width: none; 
}

/* Hide scrollbar for Chrome/Safari/Opera */
.channel-tabs::-webkit-scrollbar {
    display: none;
}

.channel-box {
    /* 4. MANUALLY CONTROL WIDTH HERE */
    flex: 0 0 auto;         /* Don't stretch, don't shrink */
    min-width: 140px;       /* <--- CHANGE THIS: Smaller number = narrower box */
    max-width: 140px;       /* <--- CHANGE THIS: Keeps them uniform */
    
    /* Compact layout */
    height: 48px;
    padding: 0 10px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    white-space: nowrap;    /* Prevent text inside box from wrapping */
    overflow: hidden;       /* Cut off really long names */
    text-overflow: ellipsis; 
}

    /* --- PRAXIS FLOATING ACTION BUTTON --- */
    .praxis-fab {
      position: fixed;
      bottom: 35px;
      right: 35px;
      z-index: 1020; /* Sits below the chat backdrop but above content */
      background: linear-gradient(135deg, var(--smart-charcoal), var(--smart-dark));
      color: #fff;
      padding: 14px 26px;
      border-radius: 999px;
      font-weight: 800;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      box-shadow: 0 12px 28px rgba(238, 125, 4, 0.35);
      border: 2px solid rgba(238, 125, 4, 0.8);
      transition: all 0.2s ease;
      animation: praxisPulse 2s infinite;
    }
    .praxis-fab:hover {
      transform: translateY(-3px) scale(1.02);
      box-shadow: 0 16px 36px rgba(238, 125, 4, 0.5);
      color: #fff;
    }
    @keyframes praxisPulse {
      0% { box-shadow: 0 0 0 0 rgba(238, 125, 4, 0.6); }
      70% { box-shadow: 0 0 0 15px rgba(238, 125, 4, 0); }
      100% { box-shadow: 0 0 0 0 rgba(238, 125, 4, 0); }
    }
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

<div class="main-content px-4 pb-5">

  <div class="row pt-4 mb-4">
    <div class="col-12">
      <div class="welcome-card d-flex justify-content-between align-items-center">
        <div>
          <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>!</h2>
          <p class="mb-0 opacity-75">System Integrity check complete. Here is the governance status for today.</p>
        </div>

        <div class="mx-4">
          <button type="button" onclick="toggleChat()" class="smart-comm-btn">
            <i class="fa-solid fa-satellite-dish fs-5"></i>
            <span>SMART COMM HUB</span>
            <div class="comm-badge" id="commBadge">0</div>
          </button>
        </div>

        <div class="text-end" style="min-width: 150px;">
          <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">System Heartbeat</div>
          <div class="d-flex align-items-center justify-content-end gap-2">
            <i class="fa-solid fa-circle-check text-success fs-5"></i>
            <span class="fw-bold fs-5">ONLINE</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="row g-3 mb-4">
    <div class="col-3">
      <div class="card-custom p-3 d-flex align-items-center">
        <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
          <i class="fa-solid fa-network-wired"></i>
        </div>
        <div>
          <div class="kpi-title">Active Sessions</div>
          <div class="kpi-value"><?php echo (int)$kpi_active_sessions; ?></div>
        </div>
      </div>
    </div>

    <div class="col-3">
      <div class="card-custom p-3 d-flex align-items-center">
        <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
          <i class="fa-solid fa-user-shield"></i>
        </div>
        <div>
          <div class="kpi-title">Failed Logins</div>
          <div class="kpi-value"><?php echo (int)$kpi_failed_logins; ?></div>
        </div>
      </div>
    </div>

    <div class="col-3">
      <div class="card-custom p-3 d-flex align-items-center">
        <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
          <i class="fa-solid fa-ban"></i>
        </div>
        <div>
          <div class="kpi-title">Suspended Users</div>
          <div class="kpi-value"><?php echo (int)$kpi_suspended_users; ?></div>
        </div>
      </div>
    </div>

    <div class="col-3">
      <div class="card-custom p-3 d-flex align-items-center">
        <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
          <i class="fa-solid fa-server"></i>
        </div>
        <div>
          <div class="kpi-title">API Uptime</div>
          <div class="kpi-value"><?php echo e($kpi_api_uptime); ?></div>
        </div>
      </div>
    </div>
  </div>

  <div class="row mb-4">
    <div class="col-12">
      <div class="card-custom p-4">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-clipboard-check text-primary me-2"></i>Pending Tasks</h5>
          <span class="badge bg-primary rounded-pill"><?php echo (int)$pending_tasks_count; ?> Pending</span>
        </div>
        <div class="table-responsive">
          <table class="table table-hover table-custom mb-0">
            <thead class="bg-light">
              <tr>
                <th style="width: 15%;">Time</th>
                <th style="width: 25%;">Requestor</th>
                <th style="width: 45%;">Task Description</th>
                <th style="width: 15%;" class="text-end">Action</th>
              </tr>
            </thead>
            <tbody>
  <?php if (empty($pending_tasks)): ?>
    <tr>
      <td colspan="4" class="text-center text-muted py-4">
        <i class="fa-solid fa-check-circle text-success mb-2 fs-4"></i><br>
        All clear! No pending governance tasks.
      </td>
    </tr>
  <?php else: ?>
    <?php foreach ($pending_tasks as $task): ?>
      <tr>
        <td class="text-muted small font-monospace align-middle"><?php echo $task['time']; ?></td>
        <td class="fw-bold text-secondary align-middle" style="font-size: 0.85rem;"><?php echo $task['req']; ?></td>
        <td class="align-middle"><?php echo $task['desc']; ?></td>
        <td class="text-end align-middle">
          <?php echo $task['btn']; ?>
        </td>
      </tr>
    <?php endforeach; ?>
  <?php endif; ?>
</tbody>
          </table>
        </div>
      </div>
    </div>
</div>

</div>

<a href="praxis-command-desk.php" class="praxis-fab" title="Launch PRAXIS Engine">
  <i class="fa-solid fa-bolt" style="color: var(--smart-orange); font-size: 1.2rem;"></i>
  <span>PRAXIS DESK</span>
</a>

<div class="comm-backdrop" id="commBackdrop" onclick="toggleChat(false)"></div>

<!-- Overlay Backdrop -->
<div class="comm-backdrop" id="commBackdrop" onclick="toggleChat(false)"></div>

<!-- Drawer -->
<div class="comm-drawer" id="commDrawer">
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
      <!-- Enabled for Option B: filter messages already loaded -->
      <input type="text" class="global-search-input" id="commSearch" placeholder="Filter loaded messages..." />
    </div>

    <div class="channel-tabs" id="channelTabs">
      <!-- JS renders boxes -->
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
<script src="../../js/admin.js"></script>

<!-- Smart Comm Core -->
<script src="../../js/smart-comm-core.js?v=4.0"></script>

<script>
  // Overlay open/close (safe; cannot crash dashboard)
  function toggleChat(forceState) {
    try {
      const open = (typeof forceState === 'boolean')
        ? forceState
        : !document.body.classList.contains('chat-active');

      document.body.classList.toggle('chat-active', open);

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

</body>
</html>
