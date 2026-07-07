<?php
/**
 * SMART LS ERP - OPERATIONS DASHBOARD
 * -------------------------------------------------------------------------
 * @author      Development Team (JBS Consulting Inc.)
 * @version     2.1 (Production-Ready)
 * @description Main entry point for Operations Team.
 * Contains Operational KPIs, Milestone Tracking,
 * and the Entry Point for the "Smart Comm Hub".
 * -------------------------------------------------------------------------
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['OPERATIONS']);

// --- Fetch current user details from DB ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  // session is incomplete; force logout for safety
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

// --- Safe display values ---
$fullName = $me['full_name'] ?: 'Ops User';
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'OPERATIONS'));
$roleLabel = $roleLabelMap[$role] ?? 'OPERATIONS';

// --- Avatar ---
$avatarName = urlencode($fullName);
$avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// --- Greeting ---
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

// ----------------------------------------------------------------------------------
// MVP placeholders
// ----------------------------------------------------------------------------------
$kpi_active_sessions = 0;
$kpi_failed_logins   = 0;
$kpi_suspended_users = 0;
$kpi_api_uptime      = '0%';
$pending_tasks_count = 0;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Operations Dashboard | Smart LS</title>
    
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

 <nav class="sidebar">
    <div class="sidebar-header">
        <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Operations Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="opsMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops1">
                <span><i class="fa-solid fa-database category-icon"></i>MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops1" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops2">
                <span><i class="fa-solid fa-laptop-code category-icon"></i>SIMULATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops2" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops3">
                <span><i class="fa-solid fa-gears category-icon"></i>OPS EXECUTION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops3" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops4">
                <span><i class="fa-solid fa-truck-ramp-box category-icon"></i>OPS DELIVERY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops4" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops5">
                <span><i class="fa-solid fa-money-bill-trend-up category-icon"></i>OPS COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops5" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="operational-cost-reconciliation" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops6" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="cash-request" class="sub-link">Cash Request</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops7">
                <span><i class="fa-solid fa-box-archive category-icon"></i>COMPANY ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops7" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="documents-vault" class="sub-link">Documents Vault</a>
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
      <h5 class="mb-0 fw-bold text-dark">Operational Control Center</h5>
      <small class="text-muted" style="font-size: 0.7rem;">LOGISTICS EXECUTION & MILESTONE GOVERNANCE</small>
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
                  <p class="mb-0 opacity-75">Monitor transit milestones, update cargo status, and ensure on-time delivery.</p>
              </div>
              
              <div class="mx-4">
                <button type="button" onclick="toggleChat()" class="smart-comm-btn">
                  <i class="fa-solid fa-satellite-dish fs-5"></i>
                  <span>SMART COMM HUB</span>
                  <div class="comm-badge" id="commBadge">0</div>
                </button>
              </div>

              <div class="text-end" style="min-width: 150px;">
    <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">Transit Heartbeat</div>
    <div class="d-flex align-items-center justify-content-end gap-2">
        <i id="heartbeat-icon" class="fa-solid fa-circle-check text-success fs-5"></i>
        <span id="heartbeat-label" class="fw-bold fs-5 text-success">ONLINE</span>
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
                  <div class="kpi-title">Files in Transit (Active)</div>
                  <div class="kpi-value" id="kpi_active"><div class="spinner-border spinner-border-sm text-primary"></div></div>
              </div>
          </div>
      </div>
      <div class="col-3">
          <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                  <i class="fa-solid fa-user-shield"></i>
              </div>
              <div>
                  <div class="kpi-title">Milestones Due (Today)</div>
                  <div class="kpi-value" id="kpi_due"><div class="spinner-border spinner-border-sm text-danger"></div></div>
              </div>
          </div>
      </div>
      <div class="col-3">
          <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                  <i class="fa-solid fa-ban"></i>
              </div>
              <div>
                  <div class="kpi-title">Late Deliveries (At Risk)</div>
                  <div class="kpi-value" id="kpi_late"><div class="spinner-border spinner-border-sm text-warning"></div></div>
              </div>
          </div>
      </div>
      <div class="col-3">
          <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                  <i class="fa-solid fa-server"></i>
              </div>
              <div>
                  <div class="kpi-title">Pending OCR (Closure)</div>
                  <div class="kpi-value" id="kpi_ocr"><div class="spinner-border spinner-border-sm text-success"></div></div>
          </div>
      </div>
  </div>

  <div class="row g-3 mb-4 mt-5">
    <div class="col-12">
        <div class="card-custom p-4">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-clipboard-check text-primary me-2"></i>Pending Tasks</h5>
                <span class="badge bg-primary rounded-pill" id="ops-pending-badge">Loading...</span>
            </div>
            
            <div class="table-responsive" style="max-height: 500px; overflow-y: auto;">
                <table class="table table-hover table-custom mb-0">
                    <thead class="bg-light" style="position: sticky; top: 0; z-index: 5;">
                        <tr>
                            <th style="width: 15%;">Time</th>
                            <th style="width: 25%;">Requestor</th>
                            <th style="width: 45%;">Task Description</th>
                            <th style="width: 15%;" class="text-end">Action</th>
                        </tr>
                    </thead>
                    <tbody id="ops-tasks-body">
                      <tr><td colspan="4" class="text-center py-4"><div class="spinner-border text-primary"></div></td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>

        <div class="row g-3 mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <h5 class="fw-bold mb-4 text-dark"><i class="fa-solid fa-clock-rotate-left text-primary me-2"></i>Recent System Activity</h5>
        
                    <div id="ops-activity-list" style="max-height: 400px; overflow-y: auto;">
                        <div class="text-center py-5 opacity-50">
                            <div class="spinner-border text-secondary mb-2"></div>
                            <div>Loading system feed...</div>
                        </div>
                    </div>
        
                </div>
            </div>
        </div>

<div class="comm-backdrop" id="commBackdrop" onclick="toggleChat(false)"></div>

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
<script src="../../js/admin.js"></script>
<script src="../../js/dashboards/ops_control.js?v=1.0"></script>

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