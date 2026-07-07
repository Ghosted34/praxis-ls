/**
 * SMART LS ERP - OPERATIONS DASHBOARD CONTROLLER
 * -------------------------------------------------------------------------
 * Handles data fetching, rendering, and interaction for the Ops Control Center.
 * * CORE FUNCTIONS:
 * 1. loadOpsKPIs()      -> Fetches top 4 cards & updates Heartbeat
 * 2. loadOpsTasks()     -> Fetches the "Pending Tasks" list
 * 3. loadOpsActivity()  -> Fetches the bottom timeline
 * 4. handleTaskAction() -> Routes clicks (Track, Fix Doc, Confirm)
 * -------------------------------------------------------------------------
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize Dashboard if we are on the correct page
    if (document.querySelector('.kpi-value')) {
        initOpsDashboard();
    }
});

function initOpsDashboard() {
    console.log('Ops Dashboard: Initializing...');
    
    // Initial Load
    loadOpsKPIs();
    loadOpsTasks();
    loadOpsActivity();

    // Auto-Refresh Cycle (Every 60 seconds)
    setInterval(() => {
        loadOpsKPIs();
        loadOpsTasks();
        loadOpsActivity();
    }, 60000);
}

// ==========================================================================
// 1. KPI LOADING & HEARTBEAT LOGIC
// ==========================================================================
function loadOpsKPIs() {
    fetch('../../api/dashboard/ops_kpis.php')
        .then(response => response.json())
        .then(res => {
            if (res.success) {
                const data = res.data;
                
                // Update DOM Elements safely
                updateText('kpi_active', data.kpi_active_transit);
                updateText('kpi_due', data.kpi_milestones_due);
                updateText('kpi_late', data.kpi_late_deliveries);
                updateText('kpi_ocr', data.kpi_pending_ocr);

                // --- HEARTBEAT LOGIC ---
                // If Late Deliveries > 15% of Active, trigger RED ALERT
                // If No updates (handled in PHP logic), we might show Yellow.
                // For now, we use the "Late" count as the primary stress indicator.
                const totalActive = parseInt(data.kpi_active_transit) || 1;
                const totalLate = parseInt(data.kpi_late_deliveries) || 0;
                const stressRatio = totalLate / totalActive;

                const heartbeatLabel = document.getElementById('heartbeat-label');
                const heartbeatIcon = document.getElementById('heartbeat-icon');

                if (heartbeatLabel && heartbeatIcon) {
                    if (stressRatio > 0.15) {
                        // OVERLOAD (Red)
                        heartbeatLabel.innerHTML = 'OVERLOAD';
                        heartbeatLabel.className = 'fw-bold fs-5 text-danger';
                        heartbeatIcon.className = 'fa-solid fa-triangle-exclamation text-danger fs-5 pulsing-icon';
                    } else {
                        // ONLINE (Green)
                        heartbeatLabel.innerHTML = 'ONLINE';
                        heartbeatLabel.className = 'fw-bold fs-5 text-success';
                        heartbeatIcon.className = 'fa-solid fa-circle-check text-success fs-5';
                    }
                }
            }
        })
        .catch(err => console.error('KPI Error:', err));
}

// ==========================================================================
// 2. TASK LIST RENDERER
// ==========================================================================
function loadOpsTasks() {
    fetch('../../api/dashboard/ops_tasks.php')
        .then(response => response.json())
        .then(res => {
            if (res.success) {
                const tbody = document.getElementById('ops-tasks-body');
                const badge = document.getElementById('ops-pending-badge');
                
                if (!tbody) return;

                const tasks = res.data;
                if (badge) badge.textContent = `${tasks.length} Pending`;

                if (tasks.length === 0) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="4" class="text-center text-muted py-4">
                                <i class="fa-solid fa-check-circle text-success mb-2 fs-4"></i><br>
                                All caught up! No pending tasks.
                            </td>
                        </tr>`;
                    return;
                }

                let html = '';
                tasks.forEach(task => {
                    // Badge Color Logic
                    let badgeClass = 'bg-primary'; // Normal
                    if (task.urgency === 'critical') badgeClass = 'bg-danger';
                    if (task.urgency === 'urgent') badgeClass = 'bg-warning text-dark';

                    // Action Button Logic
                    let btnColor = 'btn-outline-primary';
                    if (task.urgency === 'critical') btnColor = 'btn-danger text-white';

                    html += `
                    <tr>
                        <td class="align-middle">
                            <span class="badge ${badgeClass}">${task.time}</span>
                        </td>
                        <td class="align-middle fw-bold text-dark">${task.source}</td>
                        <td class="align-middle">
                            ${task.description}
                        </td>
                        <td class="text-end align-middle">
                            <button class="btn ${btnColor} btn-sm px-3 fw-bold" 
                                onclick="handleTaskAction('${task.action_type}', '${task.ref}', '${task.id}')">
                                ${task.action_label}
                            </button>
                        </td>
                    </tr>`;
                });

                tbody.innerHTML = html;
            }
        })
        .catch(err => console.error('Task Error:', err));
}

// ==========================================================================
// 3. ACTIVITY FEED RENDERER
// ==========================================================================
function loadOpsActivity() {
    fetch('../../api/dashboard/ops_activity.php')
        .then(response => response.json())
        .then(res => {
            if (res.success) {
                const container = document.getElementById('ops-activity-list');
                if (!container) return;

                const activities = res.data;
                let html = '';

                activities.forEach(act => {
                    let icon = 'fa-file';
                    let bgClass = 'bg-primary';

                    // Icon & Color Mapping
                    if (act.type === 'FILE_CREATED') {
                        icon = 'fa-folder-plus';
                        bgClass = 'bg-success';
                    } else if (act.type === 'OT_GENERATED') {
                        icon = 'fa-truck-fast';
                        bgClass = 'bg-info';
                    } else if (act.type === 'DN_ISSUED') {
                        icon = 'fa-clipboard-check';
                        bgClass = 'bg-warning';
                    }

                    html += `
                    <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                        <div class="rounded-circle ${bgClass} bg-opacity-10 text-${bgClass.replace('bg-', '')} d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                            <i class="fa-solid ${icon}"></i>
                        </div>
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between">
                                <p class="mb-0 fw-bold text-dark fs-6">${act.ref}</p>
                                <small class="text-muted">${act.time}</small>
                            </div>
                            <p class="text-muted mb-0" style="font-size: 0.85rem;">
                                ${formatActivityText(act)}
                            </p>
                        </div>
                    </div>`;
                });

                container.innerHTML = html;
            }
        });
}

function handleTaskAction(type, ref, taskId) {
    switch(type) {
        case 'FIX_DOC':
            // Opens Vault -> Action Center Tab
            window.location.href = `documents-vault?filter=rejected`;
            break;
            
        case 'RESOLVE_EVIDENCE':
            // Extract ID and go to Missing Evidence Tab
            const lineId = taskId.replace('miss_', '');
            window.location.href = `documents-vault?filter=missing&focus=${lineId}`;
            break;
            
        case 'TRACK_FILE':
        case 'BOT_ALERT':
            window.location.href = `operational-milestone-tracking?ref=${ref}`;
            break;
            
        case 'CONFIRM_EDD':
            window.location.href = `operations-registry?search=${ref}#dates`;
            break;

        case 'ISSUE_TO':
            window.location.href = `transit-order?ref=${ref}&action=new`;
            break;
            
        case 'ISSUE_DN':
            window.location.href = `delivery-note?ref=${ref}&action=new`;
            break;

        default:
            console.warn('Action not mapped:', type);
    }
}

// --- Helpers ---
function updateText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatActivityText(act) {
    if (act.type === 'FILE_CREATED') return `New File opened for <strong>${act.description}</strong>`;
    if (act.type === 'OT_GENERATED') return `Transit Order generated for ${act.description}`;
    if (act.type === 'DN_ISSUED') return `Delivery Note issued for ${act.description}`;
    return act.description;
}