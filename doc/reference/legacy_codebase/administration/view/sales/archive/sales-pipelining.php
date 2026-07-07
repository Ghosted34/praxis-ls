<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['SALES']);

// --- Fetch current admin details from DB (authoritative profile) ---
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
$fullName  = $me['full_name'] ?: 'SALES';
$firstName = trim(explode(' ', $fullName)[0] ?? 'SALES');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'SALES'));
$roleLabel = $roleLabelMap[$role] ?? 'SALES';

// --- Avatar: UI Avatars based on name (no local image storage needed yet) ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sales Pipeline | Smart LS Enterprise</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root {
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
      --smart-green: #2ECC71;
      --smart-red: #EF4444;
      --sidebar-width: 280px;
    }

    body {
      font-family: 'Manrope', sans-serif;
      background-color: var(--smart-bg);
      color: var(--smart-charcoal);
      overflow-x: hidden;
    }

    h1, h2, h3, h4, h5, h6, .font-heading { font-family: 'Montserrat', sans-serif; }

    /* --- KANBAN BOARD --- */
    .kanban-container {
      display: flex;
      gap: 1rem;
      padding-bottom: 2rem;
      min-width: 100%;
       overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        width: 100%;
        padding-bottom: 12px; /* space for scrollbar */
    }

    .kanban-column {
      min-width: 300px;
      width: 300px;
      background: #f8f9fa;
      border-radius: 12px;
      border: 1px solid #e9ecef;
      display: flex;
      flex-direction: column;
      max-height: calc(100vh - 250px);
    }

    .kanban-header {
      padding: 1rem;
      border-bottom: 2px solid;
      font-family: 'Montserrat', sans-serif;
      font-weight: 700;
      font-size: 0.8rem;
      text-transform: uppercase;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: white;
      border-top-left-radius: 12px;
      border-top-right-radius: 12px;
    }

    .kanban-body {
      padding: 1rem;
      overflow-y: auto;
      flex-grow: 1;
    }

    /* Stage Colors */
    .col-NEW { border-bottom-color: var(--smart-blue); color: var(--smart-blue); }
    .col-QUALIFIED { border-bottom-color: #6366f1; color: #6366f1; }
    .col-PRICING_IN_PROGRESS { border-bottom-color: var(--smart-orange); color: var(--smart-orange); }
    .col-QUOTATION_SENT { border-bottom-color: #f59e0b; color: #f59e0b; }
    .col-WON { border-bottom-color: var(--smart-green); color: var(--smart-green); background-color: #f0fdf4; }
    .col-LOST { border-bottom-color: var(--smart-red); color: var(--smart-red); opacity: 0.8; }

    /* Opportunity Card */
    .opp-card {
      background: white;
      border: 1px solid rgba(0,0,0,0.05);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.8rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
      transition: all 0.2s;
      cursor: pointer;
      position: relative;
      border-left: 3px solid transparent;
    }
    .opp-card:hover { transform: translateY(-3px); box-shadow: 0 8px 15px rgba(0,0,0,0.05); }

    .opp-card.val-high { border-left-color: var(--smart-green); }
    .opp-card.val-med { border-left-color: var(--smart-blue); }
    .opp-card.val-low { border-left-color: #ccc; }

    .opp-ref { font-family: monospace; font-size: 0.7rem; color: #999; }
    .opp-title { font-weight: 700; color: var(--smart-charcoal); font-size: 0.9rem; margin-bottom: 0.2rem; line-height: 1.3; }
    .opp-client { font-size: 0.8rem; color: #666; margin-bottom: 0.5rem; }
    .opp-value { font-weight: 800; color: var(--smart-dark); font-size: 0.95rem; }
    .opp-owner { width: 24px; height: 24px; background: var(--smart-charcoal); color: white; border-radius: 50%; font-size: 0.6rem; display: flex; align-items: center; justify-content: center; font-weight: bold; }

    /* KPI Cards */
    .kpi-card { background: white; border-radius: 12px; border: 1px solid rgba(0,0,0,0.05); padding: 1.2rem; display: flex; align-items: center; gap: 1rem; box-shadow: 0 2px 10px rgba(0,0,0,0.02); }
    .kpi-icon { width: 45px; height: 45px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; }
    .kpi-label { font-size: 0.7rem; text-transform: uppercase; font-weight: 700; color: #888; }
    .kpi-num { font-size: 1.4rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1; }

    .smart-input { border-radius: 8px; font-size: 0.9rem; padding: 0.6rem 0.8rem; border-color: #dee2e6; }
    .smart-input:focus { border-color: var(--smart-blue); box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.15); outline: none; }

    .btn-smart-orange { background: var(--smart-orange); border-color: var(--smart-orange); }
    
  </style>
</head>
<body>

  <!-- SIDEBAR (FROM index.php) -->
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

  <!-- MAIN CONTENT (Sales Pipeline stays intact) -->
  <div class="main-content px-4 pb-5">

    <div id="moduleShell" class="py-4">

      <div class="d-flex justify-content-between align-items-end mb-4">
        <div class="d-flex gap-4">
          <div class="kpi-card py-2 px-3">
            <div class="kpi-icon bg-success bg-opacity-10 text-success"><i class="fa-solid fa-money-bill-wave"></i></div>
            <div>
              <div class="kpi-label">Pipeline Value</div>
              <div class="kpi-num" id="kpiValue">0M</div>
            </div>
          </div>

          <div class="kpi-card py-2 px-3">
            <div class="kpi-icon bg-primary bg-opacity-10 text-primary"><i class="fa-solid fa-trophy"></i></div>
            <div>
              <div class="kpi-label">Win Rate</div>
              <div class="kpi-num" id="kpiRate">0%</div>
            </div>
          </div>
        </div>

        <div class="d-flex gap-2">
          <button onclick="exportCSV()" class="btn btn-white border fw-bold shadow-sm text-primary">
            <i class="fa-solid fa-download me-2"></i>Export CSV
          </button>
          <button onclick="openDrawer('create')" id="btnNewOpp" class="btn btn-smart-orange fw-bold shadow-sm text-white">
            <i class="fa-solid fa-plus me-2"></i>New Opportunity
          </button>
        </div>
      </div>

      <div class="kanban-container" id="kanbanBoard"></div>

    </div>
  </div>

  <!-- Drawer (unchanged) -->
  <div class="offcanvas offcanvas-end" tabindex="-1" id="oppDrawer" style="width: 850px;">
    <div class="offcanvas-header border-bottom bg-light py-3">
      <div>
        <h5 class="offcanvas-title font-heading fw-bold" id="drawerTitle">Opportunity Details</h5>
        <small class="text-muted font-monospace" id="drawerId">OPP-XXXX</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="offcanvas-body p-0 bg-white">

      <ul class="nav nav-tabs nav-fill bg-light border-bottom" id="oppTabs" role="tablist">
        <li class="nav-item"><button class="nav-link active fw-bold small text-uppercase" data-bs-toggle="tab" data-bs-target="#tab-details">Commercial Details</button></li>
        <li class="nav-item"><button class="nav-link fw-bold small text-uppercase" data-bs-toggle="tab" data-bs-target="#tab-source">Attribution (Locked)</button></li>
        <li class="nav-item"><button class="nav-link fw-bold small text-uppercase text-muted" data-bs-toggle="tab" data-bs-target="#tab-audit"><i class="fa-solid fa-clock-rotate-left me-1"></i> ISO Audit Log</button></li>
      </ul>

      <div class="tab-content p-4">
        <div class="tab-pane fade show active" id="tab-details">
          <form id="oppForm">
            <div class="row g-3">
              <div class="col-md-12">
                <label class="form-label small fw-bold text-muted">Client / Prospect Name</label>
                <input type="text" class="form-control smart-input fw-bold" id="dClient">
              </div>

              <div class="col-md-12">
                <label class="form-label small fw-bold text-muted">Opportunity Title</label>
                <input type="text" class="form-control smart-input" id="dTitle">
              </div>

              <div class="col-12"><hr class="opacity-10 my-2"></div>

              <div class="col-md-12">
                <label class="form-label small fw-bold text-muted">Est. Value (XAF)</label>
                <div class="input-group">
                  <input type="number" class="form-control smart-input fw-black text-dark" id="dValue">
                  <span class="input-group-text bg-light">XAF</span>
                </div>
              </div>

              

              <div class="col-12"><hr class="opacity-10 my-2"></div>

              <div class="col-md-6">
                <label class="form-label small fw-bold text-muted">Sales Stage</label>
                <select class="form-select smart-input fw-bold" id="dStage" onchange="checkStageLogic()">
                  <option value="NEW">NEW</option>
                  <option value="QUALIFIED">QUALIFIED</option>
                  <option value="PRICING_IN_PROGRESS">PRICING_IN_PROGRESS</option>
                  <option value="QUOTATION_SENT">QUOTATION_SENT</option>
                  
                  <option value="WON">WON (Closed)</option>
                  <option value="LOST">LOST (Closed)</option>
                </select>
              </div>

              <div class="col-md-6">
                <label class="form-label small fw-bold text-muted">Probability</label>
                <div class="progress mt-2" style="height: 25px;">
                  <div class="progress-bar bg-success" role="progressbar" style="width: 0%;" id="dProbBar">0%</div>
                </div>
              </div>

              <div class="col-12">
                <label class="form-label small fw-bold text-muted">Service Scope / Notes</label>
                <textarea class="form-control smart-input" id="dScope" rows="4"></textarea>
              </div>
            </div>
          </form>
        </div>

        <div class="tab-pane fade" id="tab-source">
          <div class="alert alert-info border-info border-opacity-25 bg-info bg-opacity-10 small fw-bold">
            <i class="fa-solid fa-lock me-2"></i> These fields are locked for ROI attribution integrity.
          </div>
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label small fw-bold text-muted">Source Channel</label>
              <input type="text" class="form-control smart-input bg-light text-muted" id="dSourceChannel" readonly>
            </div>
            <div class="col-md-6">
              <label class="form-label small fw-bold text-muted">Source Reference ID</label>
              <input type="text" class="form-control smart-input bg-light text-muted" id="dSourceRef" readonly>
            </div>
            <div class="col-md-12">
              <label class="form-label small fw-bold text-muted">Attributed Marketing Campaign</label>
              <div class="input-group">
                <span class="input-group-text bg-light"><i class="fa-solid fa-bullhorn text-muted"></i></span>
                <input type="text" class="form-control smart-input bg-light text-muted" id="dCampaign" readonly>
              </div>
            </div>
          </div>
        </div>

        <div class="tab-pane fade" id="tab-audit">
          <div class="table-responsive border rounded">
            <table class="table table-sm table-striped mb-0" style="font-size: 0.8rem;">
              <thead class="bg-light">
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action / Change</th>
                </tr>
              </thead>
              <tbody id="auditLogBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="p-4 border-top sticky-bottom bg-white d-flex justify-content-between align-items-center">
        <small class="text-muted fst-italic" id="lastUpdateText">Updated: Just now</small>
        <div class="d-flex gap-2" id="actionButtons">
          <button type="button" class="btn btn-light fw-bold border" data-bs-dismiss="offcanvas">Cancel</button>
          <button type="button" class="btn btn-primary fw-bold" onclick="saveOpp()">Save Changes</button>
        </div>
      </div>

    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
  // --- CONFIG ---
  const STAGES = ['NEW', 'QUALIFIED', 'PRICING_IN_PROGRESS', 'QUOTATION_SENT', 'WON', 'LOST'];
  const STAGE_CONFIG = {
    'NEW': { color: 'var(--smart-blue)', label: 'New Lead', prob: 10 },
    'QUALIFIED': { color: '#6366f1', label: 'Qualified', prob: 30 },
    'PRICING_IN_PROGRESS': { color: 'var(--smart-orange)', label: 'Pricing', prob: 50 },
    'QUOTATION_SENT': { color: '#f59e0b', label: 'Quote Sent', prob: 70 },
    'WON': { color: 'var(--smart-green)', label: 'Closed Won', prob: 100 },
    'LOST': { color: 'var(--smart-red)', label: 'Closed Lost', prob: 0 }
  };

  let opportunities = [];
  let currentRole = 'SALES';
  let currentId = null;

  // =========================
  // API WIRING (DB BACKED)
  // =========================
  // Adjust only if your API folder is different.
  // This assumes your page lives in: administration/pages/... and APIs are: administration/api/sales_pipeline/*.php
  const API_BASE = '../../api/sales_pipeline';

  async function apiGet(path) {
    const res = await fetch(`${API_BASE}/${path}`, { credentials: 'same-origin' });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }
    if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json.data;
  }

  async function apiPost(path, obj) {
    const body = new URLSearchParams();
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      body.append(k, String(v));
    });

    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      credentials: 'same-origin'
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }
    if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json.data;
  }

  async function refreshPipeline() {
    opportunities = await apiGet('list.php');

    // Optional normalization if some fields are missing from API
    opportunities = opportunities.map(o => ({
      id: o.id,
      title: o.title || (o.client || 'Opportunity'),
      client: o.client || '',
      value: Number(o.value || 0),
      stage: o.stage || 'NEW',
      owner: o.owner || '',               // not in DB yet
      source: o.source || 'MANUAL_ENTRY',
      sourceRef: o.sourceRef || '',
      campaign: o.campaign || 'N/A',
      scope: o.scope || '',
      logs: o.logs || []
    }));

    renderBoard();

    // KPIs from DB (authoritative)
    const k = await apiGet('kpis.php');
    document.getElementById('kpiValue').innerText = (Number(k.pipeline_value_xaf || 0) / 1000000).toFixed(1) + 'M';
    document.getElementById('kpiRate').innerText = (Number(k.win_rate_percent || 0)) + '%';
  }

  // --- INIT (replaces seedData mock) ---
  async function seedData() {
    try {
      await refreshPipeline();
    } catch (err) {
      console.error(err);
      alert("Failed to load pipeline: " + err.message);
    }
  }

  // =========================
  // RENDER BOARD (unchanged)
  // =========================
  function renderBoard() {
    const container = document.getElementById('kanbanBoard');
    container.innerHTML = '';

    // We still compute these for safety, but KPIs are overwritten by refreshPipeline() from DB
    let totalVal = 0, totalCount = 0, wonCount = 0;

    STAGES.forEach(stage => {
      const config = STAGE_CONFIG[stage];
      const stageOpps = opportunities.filter(o => o.stage === stage);

      stageOpps.forEach(o => {
        totalVal += (Number(o.value) || 0);
        totalCount++;
        if (stage === 'WON') wonCount++;
      });

      const colDiv = document.createElement('div');
      colDiv.className = 'kanban-column';

      const headerHtml = `
        <div class="kanban-header col-${stage}">
          <span>${config.label}</span>
          <span class="badge bg-white text-dark border">${stageOpps.length}</span>
        </div>
      `;

      let cardsHtml = '<div class="kanban-body">';
      stageOpps.forEach(o => {
        const v = Number(o.value) || 0;
        const valClass = v > 20000000 ? 'val-high' : (v > 5000000 ? 'val-med' : 'val-low');

        const owner = (o.owner && String(o.owner).trim()) ? String(o.owner) : '—';
        const ownerInitial = owner === '—' ? '—' : owner.charAt(0);

        cardsHtml += `
          <div class="opp-card ${valClass}" onclick="openDrawer('${String(o.id).replace(/'/g, "\\'")}')">
            <div class="d-flex justify-content-between mb-1">
              <span class="opp-ref">${o.id}</span>
              <div class="opp-owner" title="${owner}">${ownerInitial}</div>
            </div>
            <div class="opp-client">${o.client || ''}</div>
            <div class="opp-title">${o.title || ''}</div>
            <div class="d-flex justify-content-between align-items-center mt-2">
              <div class="opp-value">${(v / 1000000).toFixed(1)}M <span style="font-size:0.7em; font-weight:normal;">XAF</span></div>
              ${o.source === 'SMART_QUOTE' ? '<i class="fa-solid fa-file-import text-primary" title="From Smart Quote"></i>' : ''}
            </div>
          </div>
        `;
      });
      cardsHtml += '</div>';

      colDiv.innerHTML = headerHtml + cardsHtml;
      container.appendChild(colDiv);
    });

    // fallback only (DB KPIs override after refreshPipeline)
    document.getElementById('kpiValue').innerText = (totalVal / 1000000).toFixed(1) + 'M';
    document.getElementById('kpiRate').innerText = totalCount > 0 ? Math.round((wonCount / totalCount) * 100) + '%' : '0%';
  }

  // =========================
  // DRAWER ACTIONS (DB backed)
  // =========================
  const drawer = new bootstrap.Offcanvas(document.getElementById('oppDrawer'));

  async function openDrawer(id) {
    const isReadOnly = ['FINANCE', 'OPERATIONS'].includes(currentRole);
    document.getElementById('actionButtons').style.display = isReadOnly ? 'none' : 'flex';
    const inputs = document.querySelectorAll('#oppForm input, #oppForm select, #oppForm textarea');
    inputs.forEach(i => i.disabled = isReadOnly);

    if (id === 'create') {
      currentId = null;
      document.getElementById('drawerTitle').innerText = 'New Opportunity';
      document.getElementById('drawerId').innerText = 'OPP-NEW';
      document.getElementById('oppForm').reset();
      document.getElementById('dStage').value = 'NEW';

      document.getElementById('dSourceChannel').value = 'MANUAL_ENTRY';
      document.getElementById('dSourceRef').value = 'N/A';
      document.getElementById('dCampaign').value = 'N/A';

      document.getElementById('auditLogBody').innerHTML = ''; // ignored for now

      checkStageLogic();
      drawer.show();
      return;
    }

    try {
      const opp = await apiGet(`get.php?id=${encodeURIComponent(id)}`);
      // authoritative id from DB
      currentId = opp.quote_request_id;

      document.getElementById('drawerTitle').innerText =
        (opp.requester_company || opp.requester_name || 'Opportunity');
      document.getElementById('drawerId').innerText =
        (opp.converted_opportunity_id || opp.converted_opportunity_id);

      // Map DB -> UI
      document.getElementById('dClient').value = (opp.requester_company || opp.requester_name || '');
      document.getElementById('dTitle').value  = (opp.requester_company || opp.requester_name || '');
      document.getElementById('dValue').value  = Number(opp.estimated_value_xaf || 0);

      document.getElementById('dStage').value  = (opp.stage || 'NEW');
      document.getElementById('dScope').value  = (opp.additional_notes || '');

      document.getElementById('dSourceChannel').value = (opp.intake_channel || 'MANUAL_ENTRY');
      document.getElementById('dSourceRef').value     = (opp.public_quote_ref || '');
      document.getElementById('dCampaign').value      = 'N/A';

      // Ignore audit log for now (per your instruction)
      document.getElementById('auditLogBody').innerHTML = '';

      checkStageLogic();
      drawer.show();
    } catch (err) {
      console.error(err);
      alert("Failed to load opportunity: " + err.message);
    }
  }

  function checkStageLogic() {
    const stage = document.getElementById('dStage').value;
    const conf = STAGE_CONFIG[stage] || STAGE_CONFIG['NEW'];

    const bar = document.getElementById('dProbBar');
    bar.style.width = conf.prob + '%';
    bar.innerText = conf.prob + '%';

    if (stage === 'WON') bar.className = 'progress-bar bg-success';
    else if (stage === 'LOST') bar.className = 'progress-bar bg-danger';
    else bar.className = 'progress-bar bg-primary';
  }

  async function saveOpp() {
    const stage = document.getElementById('dStage').value;
    const val = parseFloat(document.getElementById('dValue').value) || 0;

    const client = document.getElementById('dClient').value.trim();
    const title  = document.getElementById('dTitle').value.trim();
    const scope  = document.getElementById('dScope').value.trim();

    if (!title) return alert("Title required");

    try {
      if (currentId) {
        // UPDATE existing quote_request row
        await apiPost('update.php', {
          quote_request_id: currentId,
          status: stage,
          requester_company: client,
          requester_name: title,
          estimated_value_xaf: val,
          additional_notes: scope
        });
      } else {
        // CREATE new quote_request row
        // Your schema requires: requester_name, requester_email, requester_phone, service_category, service_type
        // Since your drawer does not collect these yet, placeholders are used.
        // Replace these with real form fields when you add them.
        await apiPost('create.php', {
          status: stage,
          requester_name: title || client || 'Unknown',
          requester_company: client,
          estimated_value_xaf: val,
          additional_notes: scope,

          intake_channel: 'MANUAL_ENTRY',
          requester_email: 'unknown@example.com',
          requester_phone: '0000000000',
          service_category: 'UNKNOWN',
          service_type: 'UNKNOWN'
        });
      }

      await refreshPipeline();
      drawer.hide();
    } catch (err) {
      console.error(err);
      alert("Save failed: " + err.message);
    }
  }

  // --- CSV EXPORT LOGIC (unchanged; exports loaded DB data) ---
  function exportCSV() {
    if (opportunities.length === 0) return alert("No data to export.");

    const headers = ['Opportunity ID', 'Title', 'Client', 'Value (XAF)', 'Stage', 'Source Channel', 'Source Ref'];
    const rows = opportunities.map(o => [
      o.id,
      `"${String(o.title || '').replace(/"/g, '""')}"`,
      `"${String(o.client || '').replace(/"/g, '""')}"`,
      Number(o.value || 0),
      o.stage,
      o.source,
      `"${String(o.sourceRef || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute("download", `Sales_Pipeline_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Init
  seedData();
</script>

</body>
</html>

