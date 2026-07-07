<?php
require_once __DIR__ . '/../includes/init.php';
require_once __DIR__ . '/../includes/role_guard.php';
require_role(['ADMIN']);

// --- Authenticated Admin ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  header('Location: ../api/auth/logout.php');
  exit;
}

$conn = db();
$sql = "SELECT em.full_name, ua.role FROM user_auth ua 
        JOIN employee_master em ON em.employee_id = ua.employee_id 
        WHERE ua.user_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $userId);
$stmt->execute();
$me = $stmt->get_result()->fetch_assoc();

$fullName  = $me['full_name'] ?: 'Admin';
$role = strtoupper($me['role'] ?? 'ADMIN');
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

function e($v){ return htmlspecialchars($v ?? '', ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IAM & Security | Smart LS</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&family=Montserrat:wght@600;800&display=swap" rel="stylesheet">
  
  <style>
    /* Security Specific Styles */
    .log-card { border-left: 4px solid transparent; transition: all 0.2s; }
    .log-card:hover { background-color: #f8fafc; }
    .log-INFO { border-left-color: #3b82f6; }
    .log-WARNING { border-left-color: #f59e0b; }
    .log-CRITICAL { border-left-color: #ef4444; }
    .log-SUCCESS { border-left-color: #10b981; }
    
    .session-badge { font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 20px; }
    .sess-ACTIVE { background: #dcfce7; color: #166534; }
    .sess-IDLE { background: #f1f5f9; color: #64748b; }
    
    .remote-tag { background: #fee2e2; color: #991b1b; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 700; margin-left: 8px; }
  </style>
</head>
<body>

   <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
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
      <h5 class="mb-0 fw-bold text-dark">IAM Security Console</h5>
      <small class="text-muted" style="font-size: 0.7rem;">ACCESS CONTROL, AUDIT & SESSION TRACEABILITY</small>
    </div>
    <div class="d-flex align-items-center gap-3">
      <div class="text-end lh-1 d-none d-md-block">
        <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
        <small class="text-primary fw-bold" style="font-size: 0.65rem;">SYSTEM ADMIN</small>
      </div>
      <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38">
    </div>
  </div>

  <div class="main-content px-4 pb-5">
    
    <div class="bg-white border-bottom px-2 px-md-4 mt-4 rounded-3">
      <ul class="nav nav-tabs smart-tabs" id="securityTabs" role="tablist">
        <li class="nav-item">
          <button class="nav-link active" id="audit-tab" data-bs-toggle="tab" data-bs-target="#audit" type="button">Audit Log (Traceability)</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="sessions-tab" data-bs-toggle="tab" data-bs-target="#sessions" type="button">Session Monitor</button>
        </li>
      </ul>
    </div>

    <div class="pt-4 tab-content">
      
      <div class="tab-pane fade show active" id="audit" role="tabpanel">
        <div class="card-custom p-4">
          <div class="d-flex justify-content-between align-items-center mb-4">
            <h6 class="fw-bold m-0"><i class="fa-solid fa-list-check me-2"></i>System Activity Stream</h6>
            <button class="btn btn-light btn-sm border" onclick="loadAuditLogs()"><i class="fa-solid fa-rotate-right"></i></button>
          </div>
          
          <div class="d-flex gap-2 mb-3">
            <input type="text" id="audit-search" class="form-control form-control-sm" style="max-width: 200px;" placeholder="Search user or action...">
            <select id="audit-filter" class="form-select form-select-sm" style="max-width: 150px;">
              <option value="">All Actions</option>
              <option value="LOGIN_SUCCESS">Logins</option>
              <option value="UPDATE">Updates</option>
              <option value="DELETE">Deletes</option>
            </select>
          </div>

          <div class="vstack gap-2" id="audit-feed">
            <div class="text-center text-muted py-5">Loading logs...</div>
          </div>
        </div>
      </div>

      <div class="tab-pane fade" id="sessions" role="tabpanel">
        <div class="card-custom p-4">
          <div class="d-flex justify-content-between align-items-center mb-4">
            <h6 class="fw-bold m-0"><i class="fa-solid fa-tower-broadcast me-2"></i>Active Sessions (Live)</h6>
            <button class="btn btn-light btn-sm border" onclick="loadSessions()"><i class="fa-solid fa-rotate-right"></i></button>
          </div>

          <div class="table-responsive">
            <table class="table table-hover align-middle">
              <thead class="bg-light">
                <tr>
                  <th class="ps-3">User Identity</th>
                  <th>IP Address</th>
                  <th>Device</th>
                  <th>Login Time</th>
                  <th>Last Active</th>
                  <th class="text-end pe-3">Status</th>
                </tr>
              </thead>
              <tbody id="session-table-body">
                <tr><td colspan="6" class="text-center py-4">Loading sessions...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  
  <script>
    // --- 1. Audit Log Logic ---
    // --- 1. Audit Log Logic (CORRECTED PATH) ---
    async function loadAuditLogs() {
        const feed = document.getElementById('audit-feed');
        const q = document.getElementById('audit-search').value;
        const type = document.getElementById('audit-filter').value;
        
        feed.innerHTML = '<div class="text-center text-muted py-3">Updating...</div>';

        try {
            // FIX: Removed "../" - assumes iam-security.php is in root, next to 'api' folder
            const res = await fetch(`../../api/security/audit_list.php?q=${encodeURIComponent(q)}&action_type=${encodeURIComponent(type)}`);
            
            // Debugging: Log what we got back
            console.log("Audit Response Status:", res.status); 
            
            if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
            
            const data = await res.json();

            if(!data.ok || !data.rows.length) {
                feed.innerHTML = '<div class="text-center text-muted py-4">No records found.</div>';
                return;
            }

            feed.innerHTML = data.rows.map(log => {
                const isRemote = log.is_remote ? '<span class="remote-tag">REMOTE IP</span>' : '';
                const severityIcon = {
                    'SUCCESS': '<i class="fa-solid fa-check-circle text-success"></i>',
                    'WARNING': '<i class="fa-solid fa-triangle-exclamation text-warning"></i>',
                    'CRITICAL': '<i class="fa-solid fa-ban text-danger"></i>',
                    'INFO': '<i class="fa-solid fa-info-circle text-primary"></i>'
                }[log.severity] || '';

                return `
                <div class="p-3 border rounded bg-white log-card log-${log.severity}">
                    <div class="d-flex justify-content-between">
                        <div>
                            <div class="small fw-bold text-uppercase text-muted mb-1">${log.action}</div>
                            <div class="fw-bold text-dark">${severityIcon} ${log.user} <span class="fw-normal text-muted">performed action:</span></div>
                            <div class="mt-1 small text-dark">${log.details}</div>
                        </div>
                        <div class="text-end">
                            <div class="small fw-bold font-monospace">${log.date}</div>
                            <div class="small text-muted font-monospace mt-1">${log.ip} ${isRemote}</div>
                        </div>
                    </div>
                </div>`;
            }).join('');

        } catch(e) {
            console.error(e);
            feed.innerHTML = `<div class="text-danger p-3">Error loading logs: ${e.message}. Check Console (F12).</div>`;
        }
    }

    // --- 2. Session Monitor Logic ---
    async function loadSessions() {
        const tbody = document.getElementById('session-table-body');
        
        try {
            // Using the new API we created
            const res = await fetch(`../../api/security/session_list.php`);
            const data = await res.json();

            if(!data.ok || !data.rows.length) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No active sessions.</td></tr>';
                return;
            }

            tbody.innerHTML = data.rows.map(s => {
                const badge = s.status === 'ACTIVE' 
                    ? '<span class="session-badge sess-ACTIVE">ONLINE</span>' 
                    : '<span class="session-badge sess-IDLE">IDLE</span>';
                
                const remoteBadge = s.is_remote ? '<span class="remote-tag">REMOTE</span>' : '';

                return `
                <tr>
                    <td class="ps-3">
                        <div class="fw-bold text-dark">${s.user}</div>
                        <div class="small text-muted">${s.dept || 'N/A'}</div>
                    </td>
                    <td class="font-monospace small">${s.ip} ${remoteBadge}</td>
                    <td class="small text-muted text-truncate" style="max-width: 150px;" title="${s.device}">${s.device}</td>
                    <td class="small">${s.login}</td>
                    <td class="small fw-bold text-dark">${s.last_active}</td>
                    <td class="text-end pe-3">${badge}</td>
                </tr>`;
            }).join('');

        } catch(e) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center">Error: ${e.message}</td></tr>`;
        }
    }

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        loadAuditLogs();
        
        // Listeners for audit filters
        document.getElementById('audit-search').addEventListener('keyup', loadAuditLogs);
        document.getElementById('audit-filter').addEventListener('change', loadAuditLogs);

        // Load sessions when tab is clicked (to keep data fresh)
        document.getElementById('sessions-tab').addEventListener('shown.bs.tab', loadSessions);
    });

  </script>
</body>
</html>