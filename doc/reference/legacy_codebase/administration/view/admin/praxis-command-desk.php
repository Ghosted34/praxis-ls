<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - PRAXIS COMMAND DESK (Phase 3)
 * ======================================================================================
 * MODULE: Operations & AI Command
 * DESCRIPTION: Vanilla JS frontend for the PRAXIS Agent. Allows voice dictation, 
 * command parsing, review of staged JSON, and final ERP execution.
 * ======================================================================================
 */
declare(strict_types=1);

// --- System Initialization ---
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN', 'OPERATIONS', 'MANAGEMENT']);

$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

$conn = db();
$sql = "
  SELECT 
    em.full_name, em.job_title, ua.role
  FROM user_auth ua
  JOIN employee_master em ON em.employee_id = ua.employee_id
  WHERE ua.user_id = ? LIMIT 1
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $userId);
$stmt->execute();
$me = $stmt->get_result()->fetch_assoc();

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

$fullName  = trim((string)($me['full_name'] ?? 'Operations User'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');
$role = strtoupper((string)($me['role'] ?? 'OPERATIONS'));
$avatarUrl  = "https://ui-avatars.com/api/?name=" . urlencode($fullName) . "&background=231F20&color=fff";
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PRAXIS Command Desk | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@400;600;700;800;900&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    /* --- INHERITED DESIGN SYSTEM --- */
    :root {
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
      --sidebar-width: 260px;
    }

    body {
       font-family: 'Manrope', sans-serif;
       background: var(--smart-bg);
       color: var(--smart-charcoal);
       font-size: 0.85rem;
       overflow-x: hidden;
    }

    /* Sidebar & Topbar */
    .sidebar { width: var(--sidebar-width); height: 100vh; position: fixed; top: 0; left: 0; background: #fff; border-right: 1px solid #e0e0e0; z-index: 1000; display: flex; flex-direction: column; }
    .sidebar-header { height: 70px; display: flex; align-items: center; padding: 0 20px; border-bottom: 1px solid #f0f0f0; }
    .brand-logo { font-weight: 800; font-size: 1.1rem; color: var(--smart-charcoal); text-decoration: none; letter-spacing: -0.5px; }
    
    .main-content { margin-left: var(--sidebar-width); padding-top: 70px; min-height: 100vh; width: calc(100% - var(--sidebar-width)); }
    .top-navbar { height: 70px; position: fixed; top: 0; right: 0; left: var(--sidebar-width); background: rgba(255,255,255,0.95); backdrop-filter: blur(12px); border-bottom: 1px solid #e0e0e0; z-index: 900; padding: 0 30px; display: flex; align-items: center; justify-content: space-between; }
    
    .card-custom { background: white; border-radius: 12px; border: 1px solid rgba(0,0,0,0.05); box-shadow: 0 2px 12px rgba(0,0,0,0.02); height: 100%; }
    .smart-input { border-radius: 6px; font-size: 0.9rem; padding: 0.5rem 0.7rem; border: 1px solid #dee2e6; transition: all 0.2s ease; }
    .smart-input:focus { border-color: var(--smart-blue); box-shadow: 0 0 0 3px rgba(31,153,216,0.1); outline: none; }

    /* --- PRAXIS SPECIFIC STYLES --- */
    .ai-log-box { background: var(--smart-charcoal); border-radius: 8px; padding: 15px; font-family: 'Courier New', monospace; font-size: 0.75rem; color: #6aaccc; height: 180px; overflow-y: auto; }
    .log-success { color: #2ecc71; }
    .log-error { color: #e74c3c; }
    .log-warn { color: var(--smart-orange); }

    .doc-preview { background: #fff; border: 1px solid #dde8ef; border-radius: 8px; overflow: hidden; }
    .doc-header { background: linear-gradient(135deg, var(--smart-dark) 0%, #1A7BAF 100%); padding: 20px 24px; color: #fff; }
    .doc-body { padding: 20px 24px; }
    
    @keyframes pulse-red {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
        70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
    }
    .dictation-pulse { animation: pulse-red 1.5s infinite; }
    
    @keyframes smartPulseGlow {
        0% { box-shadow: 0 0 0 0 rgba(238,125,4,.5) }
        70% { box-shadow: 0 0 0 10px rgba(238,125,4,0) }
        100% { box-shadow: 0 0 0 0 rgba(238,125,4,0) }
    }
    .pulse-execute { animation: smartPulseGlow 2s infinite; }
  </style>
</head>
<body>

<div class="toast-container position-fixed bottom-0 end-0 p-3" id="toastContainer" style="z-index: 1100;"></div>

<nav class="sidebar">
    <div class="sidebar-header">
        <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>
    <div class="px-3 mb-2 mt-3">
        <div class="text-muted fw-bold small text-uppercase mb-2">Operations</div>
        <a href="praxis-command-desk.php" class="btn btn-dark w-100 text-start d-flex align-items-center shadow-sm">
            <i class="fa-solid fa-bolt category-icon me-2"></i> 
            <span class="fw-bold text-smart-orange">PRAXIS Engine</span> 
        </a>
    </div>
    </nav>

<div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">PRAXIS Command Agent</h5>
      <small class="text-muted" style="font-size: 0.7rem;">NATURAL LANGUAGE ERP CONTROL</small>
    </div>
    <div class="d-flex align-items-center gap-3 ps-3 border-start">
        <div class="text-end lh-1 d-none d-md-block">
          <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem;"><?php echo e($role); ?></small>
        </div>
        <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38">
    </div>
</div>

<div class="main-content px-4 pb-5">
    
    <div class="row mt-4 mb-4">
        <div class="col-12">
            <h3 class="fw-black text-smart-dark font-montserrat">Operations Command Desk</h3>
            <p class="text-muted">Issue freight, customs, warehouse, or procurement commands in plain language.</p>
        </div>
    </div>

    <div class="card-custom p-4 mb-4 border-top border-4 border-smart-orange">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h6 class="fw-bold text-dark mb-0"><i class="fa-solid fa-terminal me-2 text-primary"></i> Command Terminal</h6>
            <button class="btn btn-outline-danger rounded-circle dictation-btn" id="btnDictate" onclick="APP.toggleDictation(this)" title="Click to dictate">
                <i class="fa-solid fa-microphone"></i>
            </button>
        </div>
        
        <textarea id="commandInput" class="form-control smart-input font-monospace bg-light" rows="3" placeholder="e.g. Book a 40ft FCL container from Douala to Bangui via CMA CGM for UNFPA..." style="font-size: 0.95rem;"></textarea>
        
        <div class="d-flex justify-content-between align-items-center mt-3">
            <div class="d-flex gap-2">
                <button class="btn btn-sm btn-light border text-muted fw-bold" onclick="APP.setExample('Generate a customs brokerage request for UNFPA pharmaceutical shipment, urgent')">Example 1</button>
                <button class="btn btn-sm btn-light border text-muted fw-bold" onclick="APP.setExample('Purchase order for 2 Toyota forklifts at 14,500 XAF each from vendor Magil')">Example 2</button>
            </div>
            <button id="btnAnalyze" class="btn btn-dark fw-bold px-4 shadow-sm" onclick="APP.analyzeCommand()">
                <i class="fa-solid fa-brain me-2 text-smart-orange"></i> Analyze Command
            </button>
        </div>
    </div>

    <div class="row g-4 d-none" id="outputArea">
        
        <div class="col-lg-4">
            <div class="card-custom p-3 bg-light h-100">
                <h6 class="fw-bold text-muted small text-uppercase mb-3"><i class="fa-solid fa-server me-1"></i> Agent Activity Log</h6>
                <div class="ai-log-box" id="agentLogs">
                    <div class="mb-1"><span class="text-secondary">[00:00:00]</span> <span class="log-success">[INFO]</span> PRAXIS Agent initialized.</div>
                </div>
            </div>
        </div>

        <div class="col-lg-8">
            <div class="doc-preview shadow-sm h-100">
                <div class="doc-header d-flex justify-content-between align-items-start">
                    <div>
                        <div style="font-size: 0.65rem; letter-spacing: 0.2em; color: rgba(255,255,255,0.7); font-family: 'Montserrat';">SMART LOGISTICS & SERVICES LTD</div>
                        <h4 class="fw-black mb-0 mt-1" id="docActionType" style="font-family: 'Montserrat';">PROCESSING...</h4>
                        <div class="font-monospace text-white-50 mt-1" id="docRef">---</div>
                    </div>
                    <div class="text-end">
                        <span class="badge bg-white text-dark mb-1" id="docStatus">STAGED</span><br>
                        <span class="badge" id="docPriority" style="background: rgba(238,125,4,0.8);">STANDARD</span>
                    </div>
                </div>
                
                <div class="doc-body bg-white" id="docContent">
                    </div>

                <div class="bg-light p-3 border-top d-flex justify-content-between align-items-center">
                    <div class="text-muted small fw-bold"><i class="fa-solid fa-shield-halved text-success me-1"></i> Staged & awaiting human approval.</div>
                    <button id="btnExecute" class="btn btn-primary fw-bold px-4 pulse-execute" onclick="APP.executeOrder()">
                        <i class="fa-solid fa-play me-2"></i> EXECUTE ORDER
                    </button>
                </div>
            </div>
        </div>

    </div>

</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
/**
 * ==================================================================================
 * PRAXIS AGENT - VANILLA JS FRONTEND
 * ==================================================================================
 */
const APP = (function() {
    'use strict';

    let state = {
        stagingId: null,
        payload: null,
        isRecording: false
    };

    let mediaRecorder = null;
    let audioChunks = [];

    // --- UI Utilities (Same as Smart Quote) ---
    const utils = {
        formatCurrency: (n) => new Intl.NumberFormat('en-US').format(Math.round(n)),
        getTime: () => new Date().toTimeString().slice(0, 8),
        showToast: (title, message, type = 'success') => {
            const container = document.getElementById('toastContainer');
            const bg = type === 'success' ? 'bg-success' : (type === 'error' ? 'bg-danger' : 'bg-primary');
            const html = `
                <div class="toast align-items-center text-white ${bg} border-0 show" role="alert">
                  <div class="d-flex">
                    <div class="toast-body fw-bold"><strong>${title}</strong>: ${message}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                  </div>
                </div>`;
            const div = document.createElement('div');
            div.innerHTML = html;
            container.appendChild(div.firstElementChild);
            setTimeout(() => { if(container.firstChild) container.removeChild(container.firstElementChild); }, 5000);
        },
        addLog: (type, msg) => {
            const logsBox = document.getElementById('agentLogs');
            const colorClass = type === 'success' ? 'log-success' : type === 'error' ? 'log-error' : type === 'warn' ? 'log-warn' : 'text-primary';
            const logEntry = document.createElement('div');
            logEntry.className = 'mb-1';
            logEntry.innerHTML = `<span class="text-secondary">[${utils.getTime()}]</span> <span class="${colorClass}">[${type.toUpperCase()}]</span> ${msg}`;
            logsBox.appendChild(logEntry);
            logsBox.scrollTop = logsBox.scrollHeight;
        }
    };

    function setExample(text) {
        document.getElementById('commandInput').value = text;
    }

    // --- 1. VOICE DICTATION (Groq Whisper Integration) ---
    async function toggleDictation(btnElement) {
        const inputEl = document.getElementById('commandInput');

        if (state.isRecording) {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            audioChunks = [];

            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                stream.getTracks().forEach(track => track.stop());
                
                btnElement.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
                btnElement.classList.replace('btn-danger', 'btn-outline-danger');
                btnElement.classList.remove('dictation-pulse');
                
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async function() {
                    utils.addLog('info', 'Transcribing audio via Whisper...');
                    try {
                        const res = await fetch('../../api/smart_quote_api.php', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'transcribe_audio', audio_b64: reader.result })
                        });
                        const result = await res.json();
                        
                        if (result.success && result.text) {
                            const currentText = inputEl.value.trim();
                            inputEl.value = currentText ? currentText + ' ' + result.text : result.text;
                            utils.addLog('success', 'Transcription complete.');
                        } else {
                            utils.showToast('Error', result.error, 'error');
                            utils.addLog('error', 'Transcription failed.');
                        }
                    } catch (err) {
                        utils.showToast('Error', 'Failed to reach backend.', 'error');
                    } finally {
                        btnElement.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                        state.isRecording = false;
                    }
                };
            };

            mediaRecorder.start();
            state.isRecording = true;
            
            btnElement.innerHTML = '<i class="fa-solid fa-stop"></i>';
            btnElement.classList.replace('btn-outline-danger', 'btn-danger');
            btnElement.classList.add('dictation-pulse');
            utils.addLog('info', 'Listening...');

        } catch (err) {
            utils.showToast('Permissions Error', 'Microphone access denied.', 'error');
        }
    }

    // --- 2. ANALYZE COMMAND (Phase 2 Engine) ---
    async function analyzeCommand() {
        const command = document.getElementById('commandInput').value.trim();
        if (!command) return;

        const btn = document.getElementById('btnAnalyze');
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-2"></i> Analyzing...`;
        btn.disabled = true;

        document.getElementById('outputArea').classList.remove('d-none');
        document.getElementById('agentLogs').innerHTML = ''; // Clear logs
        document.getElementById('docContent').innerHTML = '<div class="text-center p-5 text-muted"><i class="fa-solid fa-robot fa-2x fa-bounce mb-3"></i><br>Generating PRAXIS Logic...</div>';
        document.getElementById('btnExecute').disabled = true;
        
        utils.addLog('info', `Command received: "${command.substring(0, 30)}..."`);
        utils.addLog('info', 'RAG Context injected. Querying Gemini Flash 2.5...');

        try {
            const res = await fetch('../../api/praxis/command_engine.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: command })
            });
            const data = await res.json();

            if (data.success) {
                state.stagingId = data.staging_id;
                state.payload = data.payload;
                
                utils.addLog('success', `Staging Buffer ID: [${state.stagingId}] created.`);
                utils.addLog('success', `JSON Structure Verified.`);
                renderDocumentPreview();
                document.getElementById('btnExecute').disabled = false;
                
            } else {
                utils.showToast('AI Engine Error', data.error, 'error');
                utils.addLog('error', data.error);
                document.getElementById('docContent').innerHTML = `<div class="alert alert-danger fw-bold m-3"><i class="fa-solid fa-triangle-exclamation me-2"></i> ${data.error}</div>`;
            }
        } catch (err) {
            utils.showToast('Network Error', 'Failed to connect to Command Engine.', 'error');
            utils.addLog('error', 'Server offline or timed out.');
        } finally {
            btn.innerHTML = `<i class="fa-solid fa-brain me-2 text-smart-orange"></i> Analyze Command`;
            btn.disabled = false;
        }
    }

    // --- 3. RENDER THE PREVIEW ---
    function renderDocumentPreview() {
        const p = state.payload;
        if (!p) return;

        // Update Header
        document.getElementById('docActionType').innerText = (p.action || 'UNKNOWN').replace(/_/g, ' ');
        document.getElementById('docRef').innerText = p.order_number || 'AUTO-GENERATED';
        document.getElementById('docPriority').innerText = p.priority || 'STANDARD';

        // Build Details Grid
        let html = `<div class="row g-3 mb-4 pb-4 border-bottom">`;
        
        const details = [
            { label: 'Department', val: p.department },
            { label: 'Client', val: p.client?.name },
            { label: 'Vendor/Carrier', val: p.vendor_carrier?.name },
            { label: 'Delivery Target', val: p.delivery_date }
        ];

        details.forEach(d => {
            html += `
                <div class="col-md-3 border-start border-3 border-light ps-3">
                    <div class="text-muted font-monospace" style="font-size: 0.65rem; letter-spacing: 0.1em;">${d.label.toUpperCase()}</div>
                    <div class="fw-bold text-dark" style="font-size: 0.9rem;">${d.val || '---'}</div>
                </div>
            `;
        });
        html += `</div>`;

        // Build Line Items Table
        if (p.line_items && p.line_items.length > 0) {
            html += `<h6 class="fw-bold text-muted small text-uppercase mb-2">Line Items</h6>`;
            html += `<div class="table-responsive mb-4"><table class="table table-sm table-bordered">
                <thead class="table-light text-muted" style="font-size: 0.75rem;">
                    <tr><th>Code</th><th>Description</th><th class="text-center">Qty</th><th class="text-end">Price</th><th class="text-end">Total</th></tr>
                </thead><tbody>`;
            
            p.line_items.forEach(item => {
                html += `<tr>
                    <td class="font-monospace small text-primary">${item.item_code || '-'}</td>
                    <td class="fw-bold" style="font-size:0.85rem;">${item.description}</td>
                    <td class="text-center">${item.quantity} ${item.unit || ''}</td>
                    <td class="text-end font-monospace">${utils.formatCurrency(item.unit_price)}</td>
                    <td class="text-end font-monospace fw-bold text-dark">${utils.formatCurrency(item.total)}</td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
        }

        // Build Footer (Totals)
        html += `
            <div class="d-flex justify-content-end">
                <div style="width: 250px;">
                    <div class="d-flex justify-content-between mb-1 text-muted font-monospace small"><span>Subtotal:</span> <span>${p.currency} ${utils.formatCurrency(p.subtotal)}</span></div>
                    <div class="d-flex justify-content-between mb-2 text-muted font-monospace small pb-2 border-bottom"><span>Tax:</span> <span>${p.currency} ${utils.formatCurrency(p.tax_amount)}</span></div>
                    <div class="d-flex justify-content-between fw-black fs-5 text-smart-dark"><span>TOTAL:</span> <span>${p.currency} ${utils.formatCurrency(p.total_amount)}</span></div>
                </div>
            </div>
        `;

        document.getElementById('docContent').innerHTML = html;
    }

    // --- 4. EXECUTE ORDER (Phase 4 Pipeline) ---
    async function executeOrder() {
        if (!state.stagingId) return;

        const btn = document.getElementById('btnExecute');
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-2"></i> PUSHING TO ERP...`;
        btn.disabled = true;
        btn.classList.remove('pulse-execute');
        
        utils.addLog('warn', 'Execution requested. Committing transaction to DB...');

        try {
            const res = await fetch('../../api/praxis/execute_order.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staging_id: state.stagingId })
            });
            const data = await res.json();

            if (data.success) {
                utils.showToast('Execution Complete', `Order pushed successfully as ${data.reference_id}`, 'success');
                utils.addLog('success', `Database confirmed. Document generated: ${data.reference_id}`);
                
                // Update UI to success state
                document.getElementById('docStatus').innerText = "EXECUTED";
                document.getElementById('docStatus').classList.replace('bg-white', 'bg-success');
                document.getElementById('docStatus').classList.replace('text-dark', 'text-white');
                document.getElementById('docRef').innerText = data.reference_id;
                
                btn.innerHTML = `<i class="fa-solid fa-check me-2"></i> EXECUTED`;
                btn.classList.replace('btn-primary', 'btn-success');
                
                // Clear state so we don't double execute
                state.stagingId = null;
            } else {
                utils.showToast('Execution Error', data.error, 'error');
                utils.addLog('error', 'DB Rollback: ' + data.error);
                btn.innerHTML = `<i class="fa-solid fa-play me-2"></i> RETRY EXECUTION`;
                btn.disabled = false;
            }
        } catch (err) {
            utils.showToast('Network Error', 'Execution request failed.', 'error');
            utils.addLog('error', 'Connection lost during execution.');
            btn.innerHTML = `<i class="fa-solid fa-play me-2"></i> RETRY EXECUTION`;
            btn.disabled = false;
        }
    }

    // Expose public methods
    return {
        setExample,
        toggleDictation,
        analyzeCommand,
        executeOrder
    };

})();
</script>
</body>
</html>