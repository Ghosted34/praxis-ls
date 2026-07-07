/**
 * SMART LS ERP - FINANCE COMMAND CENTER
 * -------------------------------------------------------------------------
 * Logic for the Treasury & Compliance Dashboard.
 * Handles: Liquidity Heartbeat, KPI Updates, and Audit Task Actions.
 * -------------------------------------------------------------------------
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize the Command Center
    initFinanceDashboard();
});

const FIN_CONFIG = {
    endpoints: {
        heartbeat: '../../api/treasury/get_liquidity.php',
        kpis:      '../../api/dashboard/fin_kpis.php',
        tasks:     '../../api/dashboard/fin_tasks.php'
    },
    refreshRates: {
        heartbeat: 100000, // Check liquidity every 1 min
        tasks:     60000 // Check tasks every 5 mins
    }
};

function initFinanceDashboard() {
    console.log('Initializing Finance Command...');

    // 1. Initial Data Load
    refreshHeartbeat();
    refreshKPIs();
    refreshTasks();
    initReceivablesChart();

    // 2. Start Polling Timers
    setInterval(refreshHeartbeat, FIN_CONFIG.refreshRates.heartbeat);
    setInterval(refreshTasks, FIN_CONFIG.refreshRates.tasks);
}

/**
 * 1. LIQUIDITY HEARTBEAT
 * Updates the "System Heartbeat" indicator in the top right.
 */
function refreshHeartbeat() {
    fetch(FIN_CONFIG.endpoints.heartbeat)
        .then(response => response.json())
        .then(res => {
            if (res.success) {
                const data = res.data;
                const statusEl = document.getElementById('heartbeat-status');
                const iconEl   = document.getElementById('heartbeat-icon');
                
                if (statusEl && iconEl) {
                    // Update Text
                    statusEl.innerText = data.status;
                    statusEl.className = `fw-bold fs-5 text-${data.color}`; // text-success, text-danger, etc.
                    
                    // Update Icon
                    let iconClass = 'fa-circle-check';
                    if(data.status === 'STRAINED') iconClass = 'fa-triangle-exclamation';
                    if(data.status === 'STAGNANT') iconClass = 'fa-circle-xmark';
                    
                    iconEl.className = `fa-solid ${iconClass} text-${data.color} fs-5`;
                }
            }
        })
        .catch(err => console.error('Heartbeat Sync Failed:', err));
}

/**
 * 2. STRATEGIC KPIS
 * Updates the 4 key cards at the top.
 */
function refreshKPIs() {
    fetch(FIN_CONFIG.endpoints.kpis)
        .then(response => response.json())
        .then(res => {
            if (res.success) {
                const d = res.data;
                
                // Update DOM elements (IDs will be added in the HTML Patch phase)
                updateText('kpi-pending-val', d.pending_disbursements.count);
                updateText('kpi-overdue-val', d.critical_overdue.formatted);
                updateText('kpi-ratio-val',   d.conversion_ratio.label);
                updateText('kpi-leverage-val',d.leverage_ratio.label);
            }
        })
        .catch(err => console.error('KPI Sync Failed:', err));
}

/**
 * 3. PENDING TASKS & AUDIT STREAM
 * Populates the "Pending Tasks" table.
 */
function refreshTasks() {
    const tableBody = document.getElementById('fin-tasks-body');
    if (!tableBody) return;

    fetch(FIN_CONFIG.endpoints.tasks)
        .then(response => response.json())
        .then(res => {
            if (res.success) {
                renderTaskTable(res.data);
                // Update badge count
                updateText('task-count-badge', res.count + ' Pending');
            }
        })
        .catch(err => console.error('Task Sync Failed:', err));
}

function renderTaskTable(tasks) {
    const tbody = document.getElementById('fin-tasks-body');
    tbody.innerHTML = ''; // Clear current

    if (tasks.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="4" class="text-center text-muted py-4">
                <i class="fa-solid fa-check-circle text-success mb-2 fs-4"></i><br>
                All clear. No pending financial tasks.
            </td></tr>`;
        return;
    }

    tasks.forEach(task => {
        // Urgency Styling
        let rowClass = '';
        let badgeHtml = '';
        
        if (task.urgency === 'CRITICAL') {
            rowClass = 'table-danger';
            badgeHtml = '<span class="badge bg-danger me-2">CRITICAL</span>';
        }

        const tr = document.createElement('tr');
        tr.className = rowClass;
        tr.innerHTML = `
            <td class="fw-bold text-secondary">${task.display_time}</td>
            <td>
                ${badgeHtml}
                <span class="fw-bold text-dark">${task.category}</span>
            </td>
            <td>${task.description}</td>
            <td class="text-end">
                <button class="btn btn-sm btn-outline-primary fw-bold" 
                   onclick="handleTaskAction('${task.action_type}', '${task.action_id}')">
                   ${task.action_label}
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * 4. ACTION HANDLERS (Deep Linking)
 */
function handleTaskAction(type, id) {
    console.log(`Executing Action: ${type} on ID: ${id}`);

    switch (type) {
        case 'modal_cash_request':
            // Logic to open the existing Cash Request Modal
            // Assuming a global function exists, or we redirect
            window.location.href = `cash-request.php?focus=${id}&action=validate`;
            break;
            
        case 'link_ocr_worksheet':
            // Open OCR Validation screen
            window.open(`ocr-validation.php?id=${id}`, '_blank');
            break;
            
        case 'toast_ack':
            // Simple acknowledgement
            alert('System Notification Acknowledged.');
            // In a real app, this would call an API to dismiss the alert
            break;
            
        default:
            console.warn('Unknown Action Type');
    }
}

// Helper: Safely update text if element exists
function updateText(id, val) {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
}

/**
 * ==============================================
 * EXTENSION: RECEIVABLES AGING CHART
 * ==============================================
 */

// Add chart endpoint to config
FIN_CONFIG.endpoints.aging = '../../api/receivables/aging_summary.php';

// Hook into the main init function
// (Add this call inside your existing initFinanceDashboard function)
// initReceivablesChart(); <--- DON'T FORGET TO ADD THIS LINE TO YOUR MAIN INIT FUNCTION

let agingChartInstance = null;

function initReceivablesChart() {
    const ctx = document.getElementById('receivablesChart');
    if (!ctx) return; // Safety check if patch isn't applied yet

    fetch(FIN_CONFIG.endpoints.aging)
        .then(response => response.json())
        .then(res => {
            if (res.success) {
                renderAgingChart(ctx, res.data);
                // Update the total header text
                const totalEl = document.getElementById('chart-total-receivable');
                if(totalEl) totalEl.innerText = formatCurrency(res.data.total_receivable) + ' XAF';
            }
        })
        .catch(err => console.error('Aging Chart Sync Failed:', err));
}

function renderAgingChart(ctx, data) {
    // Destroy existing chart if re-initializing to prevent memory leaks
    if (agingChartInstance) {
        agingChartInstance.destroy();
    }

    const brandColors = {
        safe: '#198754',    // Bootstrap Success Green
        warning: '#ffc107', // Bootstrap Warning Yellow
        danger: '#dc3545'   // Bootstrap Danger Red
    };

    agingChartInstance = new Chart(ctx, {
        type: 'bar', // 'bar' for vertical, change to 'line' or 'pie' if preferred
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Outstanding Balance (XAF)',
                data: data.values,
                backgroundColor: [
                    brandColors.safe,    // 0-30 Days
                    brandColors.warning, // 31-60 Days
                    brandColors.danger   // 60+ Days
                ],
                borderColor: [
                    brandColors.safe,
                    brandColors.warning,
                    brandColors.danger
                ],
                borderWidth: 1,
                borderRadius: 5,
                barPercentage: 0.6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // Hide legend as colors explain themselves
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                // Format tooltip currency
                                label += formatCurrency(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: '#f0f2f5'
                    },
                    ticks: {
                        // Abbreviate large numbers on Y-axis (e.g., 1M, 500k)
                        callback: function(value) {
                            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
                            if (value >= 1000) return (value / 1000).toFixed(0) + 'k';
                            return value;
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Helper utility for formatting numbers with commas
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US').format(amount);
}