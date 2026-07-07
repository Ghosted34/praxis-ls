<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - SUCCESS STORIES & PORTFOLIO BUILDER
 * ======================================================================================
 * MODULE: CRM & Acquisition
 * DESCRIPTION: Admin UI to select ops, dictate notes, generate AI case studies, 
 * and publish them to the public portfolio.
 * ======================================================================================
 */

declare(strict_types=1);
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

$conn = db();
$sql = "SELECT em.full_name, ua.role FROM user_auth ua JOIN employee_master em ON em.employee_id = ua.employee_id WHERE ua.user_id = ? LIMIT 1";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $userId);
$stmt->execute();
$me = $stmt->get_result()->fetch_assoc();
$fullName = trim($me['full_name'] ?? 'User');
$roleLabel = $me['role'] ?? 'USER';

// Fetch Clients for the dropdown
$clients = $conn->query("SELECT client_id, client_name FROM client_master WHERE status = 'ACTIVE' ORDER BY client_name ASC")->fetch_all(MYSQLI_ASSOC);

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Success Stories Builder | Smart LS</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="../../css/admin.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    
    <!-- Select2 for beautiful Multi-Select -->
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />

    <style>
        :root {
            --smart-blue: #1F99D8;
            --smart-dark: #055B83;
            --smart-orange: #EE7D04;
            --smart-charcoal: #231F20;
            --smart-bg: #F0F4F8;
            --sidebar-width: 260px;
        }

        body { font-family: 'Manrope', sans-serif; background: var(--smart-bg); color: var(--smart-charcoal); font-size: 0.85rem; overflow-x: hidden; }
        
        /* Sidebar & Topbar (Inherited from your system) */
        .sidebar { width: var(--sidebar-width); height: 100vh; position: fixed; top: 0; left: 0; background: #fff; border-right: 1px solid #e0e0e0; z-index: 1000; }
        .top-navbar { height: 70px; position: fixed; top: 0; right: 0; left: var(--sidebar-width); background: rgba(255,255,255,0.95); border-bottom: 1px solid #e0e0e0; z-index: 900; padding: 0 30px; display: flex; align-items: center; justify-content: space-between; }
        .main-content { margin-left: var(--sidebar-width); padding-top: 70px; min-height: 100vh; padding-left: 30px; padding-right: 30px; }

        .card-custom { background: white; border-radius: 12px; border: 1px solid rgba(0,0,0,0.05); box-shadow: 0 2px 12px rgba(0,0,0,0.02); }
        .smart-input { border-radius: 6px; font-size: 0.9rem; padding: 0.5rem 0.7rem; border: 1px solid #dee2e6; transition: all 0.2s ease; }
        .smart-input:focus { border-color: var(--smart-blue); box-shadow: 0 0 0 3px rgba(31,153,216,0.1); outline: none; }
        
        /* Offcanvas Editor overrides */
        .editor-sidebar { width: 400px; border-right: 1px solid #e0e0e0; background: #f8fafc; padding: 20px; overflow-y: auto; }
        .editor-main { flex: 1; display: flex; flex-direction: column; background: #fff; overflow-y: auto; }
        
        /* Dictation Pulse */
        @keyframes pulse-red {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
        }
        .dictation-pulse { animation: pulse-red 1.5s infinite; }
        .dictation-btn { width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; }

        /* Image Upload Previews */
        .img-preview-box { width: 100%; height: 120px; border: 2px dashed #cbd5e1; border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; cursor: pointer; background: #fff; }
        .img-preview-box img { width: 100%; height: 100%; object-fit: cover; }
        .img-preview-box:hover { border-color: var(--smart-blue); background: #f0f7fa; }
        
        .kpi-row { display: grid; grid-template-columns: 1fr 1fr 40px; gap: 10px; align-items: center; margin-bottom: 10px; }
    </style>
</head>
<body>

<div class="toast-container position-fixed bottom-0 end-0 p-3" id="toastContainer" style="z-index: 1100;"></div>

<!-- Assuming Sidebar is included here via a PHP require in your actual app. Keeping it minimal for layout structure. -->
<nav class="sidebar px-3 py-4">
    <h4 class="fw-bold text-dark mb-4">SMART <span style="color: var(--smart-orange);">LS</span></h4>
    <a href="javascript:void(0)" class="d-block text-decoration-none text-smart-orange fw-bold mb-2"><i class="fa-solid fa-bullhorn me-2"></i> Success Stories</a>
    <a href="smart-quote-leads.php" class="d-block text-decoration-none text-secondary fw-bold"><i class="fa-solid fa-arrow-left me-2"></i> Back to CRM</a>
</nav>

<div class="top-navbar">
    <div>
        <h5 class="mb-0 fw-bold text-dark">Success Stories Builder</h5>
        <small class="text-muted" style="font-size: 0.7rem;">MARKETING PORTFOLIO GENERATION</small>
    </div>
    <div class="fw-bold"><?php echo e($fullName); ?> <span class="badge bg-light text-dark border ms-2"><?php echo e($roleLabel); ?></span></div>
</div>

<div class="main-content pb-5 mt-4">
    <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="fw-bold text-dark">Portfolio Master Registry</h4>
        <button class="btn btn-dark fw-bold shadow-sm px-4" onclick="APP.openBuilder()">
            <i class="fa-solid fa-wand-magic-sparkles me-2"></i> Create Success Story
        </button>
    </div>

    <div class="card-custom p-0">
        <!-- Dashboard/List Table will go here. In Phase 3, we focus on the Builder Logic -->
        <div class="p-5 text-center text-muted">
            <i class="fa-solid fa-folder-open fa-3x mb-3 opacity-50"></i>
            <h6>Your published case studies will appear here.</h6>
            <p class="small">Click "Create Success Story" to generate a new marketing asset from operations data.</p>
        </div>
    </div>
</div>

<!-- ==========================================
     THE BUILDER OFFCANVAS
=========================================== -->
<div class="offcanvas offcanvas-end" tabindex="-1" id="storyBuilderOffcanvas" data-bs-backdrop="static" style="width: 95vw; max-width: 1300px;">
    <div class="offcanvas-header bg-white border-bottom py-3">
        <h5 class="offcanvas-title fw-bold text-dark"><i class="fa-solid fa-pen-nib text-smart-orange me-2"></i> Case Study AI Studio</h5>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
    </div>

    <div class="offcanvas-body p-0 d-flex" style="height: calc(100vh - 70px);">
        
        <!-- SIDEBAR: DATA INTAKE & OPS LINKAGE -->
        <div class="editor-sidebar d-flex flex-column gap-4">
            
            <!-- Link Operations -->
            <div>
                <h6 class="fw-bold text-dark border-bottom pb-2 mb-3"><span class="badge bg-smart-dark me-2">1</span> Link Operations Data</h6>
                
                <label class="form-label text-muted small fw-bold text-uppercase">Select Client</label>
                <select class="form-select smart-input mb-3 fw-bold" id="ssClient">
                    <option value="">-- Choose Client --</option>
                    <?php foreach ($clients as $c): ?>
                        <option value="<?= e($c['client_id']) ?>"><?= e($c['client_name']) ?></option>
                    <?php endforeach; ?>
                </select>

                <label class="form-label text-muted small fw-bold text-uppercase">Link Operations Files</label>
                <select class="form-select smart-input" id="ssOpsFiles" multiple="multiple" style="width: 100%;">
                    <!-- Populated via AJAX -->
                </select>
                <small class="text-muted d-block mt-1" style="font-size: 0.65rem;">Select one or multiple operations to pull gross weights, ETAs, and margins.</small>
            </div>

            <!-- Context & AI Audio Intake -->
            <div>
                <h6 class="fw-bold text-dark border-bottom pb-2 mb-3 mt-2"><span class="badge bg-smart-orange me-2">2</span> AI Dictation & Context</h6>
                
                <div class="mb-3">
                    <label class="form-label text-muted small fw-bold text-uppercase">Service Category Focus</label>
                    <input type="text" class="form-control smart-input" id="ssCategory" placeholder="e.g. End-to-End Multimodal">
                </div>
                
                <div class="mb-3">
                    <label class="form-label text-muted small fw-bold text-uppercase">Proposed Title Idea</label>
                    <input type="text" class="form-control smart-input" id="ssTitleIdea" placeholder="e.g. Revolutionizing Chad Transit...">
                </div>

                <div class="bg-white p-3 rounded border shadow-sm">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <label class="form-label text-dark fw-bold mb-0">Messy Notes Intake</label>
                        <button class="btn btn-outline-danger rounded-circle dictation-btn shadow-sm" id="btnDictate" onclick="APP.toggleDictation()" title="Click to dictate">
                            <i class="fa-solid fa-microphone"></i>
                        </button>
                    </div>
                    <textarea class="form-control smart-input border-0 bg-light fs-6" id="ssNotes" rows="5" placeholder="Click the mic and describe the challenges, the bottlenecks, and how Smart Logistics solved them..."></textarea>
                    
                    <!-- AI Follow up Alert -->
                    <div id="aiFollowUpAlert" class="alert alert-warning mt-2 mb-0 py-2 px-3 d-none shadow-sm" style="font-size: 0.75rem;">
                        <i class="fa-solid fa-robot me-1 text-smart-orange"></i> <strong class="text-dark">AI Follow-up:</strong> 
                        <span id="aiFollowUpText" class="text-dark fst-italic"></span>
                    </div>
                </div>

                <button class="btn btn-primary w-100 fw-bold mt-4 shadow-sm py-2" id="btnGenerateAI" onclick="APP.generateStory()">
                    <i class="fa-solid fa-brain me-2"></i> Generate Case Study
                </button>
            </div>
        </div>

        <!-- MAIN AREA: AI OUTPUT, ASSETS & REFINEMENT -->
        <div class="editor-main p-5 position-relative">
            
            <!-- Loading Overlay -->
            <div id="aiLoadingOverlay" class="position-absolute top-0 start-0 w-100 h-100 bg-white bg-opacity-75 d-none justify-content-center align-items-center" style="z-index: 10;">
                <div class="text-center">
                    <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status"></div>
                    <h5 class="mt-3 fw-bold text-smart-dark">Analyzing Ops Data & Generating Story...</h5>
                </div>
            </div>

            <div class="row g-4 max-w-4xl mx-auto w-100">
                
                <div class="col-12 border-bottom pb-3 mb-2 d-flex justify-content-between align-items-center">
                    <h5 class="fw-bold text-dark mb-0">Technical Overview & Assets</h5>
                    <div class="d-flex gap-2">
                        <select class="form-select smart-input bg-light border-0 fw-bold" id="ssStatus" style="width: auto;">
                            <option value="DRAFT">DRAFT</option>
                            <option value="PUBLISHED">PUBLISHED (Public)</option>
                            <option value="RETRACTED">RETRACTED (Hidden)</option>
                        </select>
                        <button class="btn btn-success fw-bold shadow-sm" id="btnSaveStory" onclick="APP.saveStory()">
                            <i class="fa-solid fa-cloud-arrow-up me-2"></i> Save Portfolio Item
                        </button>
                    </div>
                </div>

                <!-- Text Content Edit -->
                <div class="col-md-8 d-flex flex-column gap-3">
                    <div>
                        <label class="form-label text-muted small fw-bold text-uppercase">Generated Headline</label>
                        <input type="text" class="form-control smart-input fs-5 fw-bold text-smart-dark" id="outTitle" placeholder="Awaiting Generation...">
                    </div>
                    <div>
                        <label class="form-label text-muted small fw-bold text-uppercase">Executive Summary (The Challenge)</label>
                        <textarea class="form-control smart-input" id="outExecSum" rows="4" placeholder="Awaiting Generation..."></textarea>
                    </div>
                    <div>
                        <label class="form-label text-muted small fw-bold text-uppercase">Operations Execution (The Solution)</label>
                        <textarea class="form-control smart-input" id="outOpsExec" rows="6" placeholder="Awaiting Generation..."></textarea>
                    </div>

                    <div class="mt-2 border-top pt-3">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <label class="form-label text-muted small fw-bold text-uppercase mb-0">Hard KPIs Achieved</label>
                            <button class="btn btn-sm btn-outline-primary" onclick="APP.addKpiRow()"><i class="fa-solid fa-plus"></i> Add Row</button>
                        </div>
                        <div id="kpiContainer">
                            <!-- Populated dynamically -->
                        </div>
                    </div>
                </div>

                <!-- Media Assets Upload -->
                <div class="col-md-4 border-start ps-4">
                    <h6 class="fw-bold text-dark mb-3"><i class="fa-solid fa-images text-smart-blue me-2"></i> Media Assets</h6>
                    
                    <div class="mb-4">
                        <label class="form-label text-muted small fw-bold text-uppercase">Cover Image (Required)</label>
                        <input type="file" class="d-none" id="fileCover" accept="image/*" onchange="APP.previewImage(this, 'previewCover')">
                        <div class="img-preview-box" onclick="document.getElementById('fileCover').click()">
                            <img id="previewCover" style="display:none;">
                            <span class="text-muted fw-bold" id="textCover"><i class="fa-solid fa-upload me-2"></i>Upload Cover</span>
                        </div>
                    </div>

                    <div class="mb-4">
                        <label class="form-label text-muted small fw-bold text-uppercase">Client Logo (Optional)</label>
                        <input type="file" class="d-none" id="fileLogo" accept="image/png" onchange="APP.previewImage(this, 'previewLogo')">
                        <div class="img-preview-box bg-light" style="height: 80px;" onclick="document.getElementById('fileLogo').click()">
                            <img id="previewLogo" style="display:none; object-fit: contain; padding: 10px;">
                            <span class="text-muted fw-bold" id="textLogo"><i class="fa-solid fa-upload me-2"></i>Upload .PNG Logo</span>
                        </div>
                    </div>

                    <div>
                        <label class="form-label text-muted small fw-bold text-uppercase">Gallery (Up to 4, Optional)</label>
                        <input type="file" class="form-control smart-input" id="fileGallery" accept="image/*" multiple max="4">
                        <small class="text-muted d-block mt-1">Select multiple operation photos to attach.</small>
                    </div>
                </div>

            </div>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>

<script>
    const APP = (function() {
        'use strict';

        // --- UI Utilities ---
        const utils = {
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
                setTimeout(() => { if(container.firstChild) container.removeChild(container.firstElementChild); }, 4000);
            }
        };

        // --- Init ---
        function init() {
            // Initialize Select2 for Operations Multi-select
            $('#ssOpsFiles').select2({
                placeholder: "Search Operations Reference...",
                allowClear: true,
                dropdownParent: $('#storyBuilderOffcanvas')
            });
            
            // Listen for Client selection changes to trigger the filtered fetch
            document.getElementById('ssClient').addEventListener('change', function() {
                fetchEligibleOps(this.value);
            });
        }

        // --- Fetch Linked Operations ---
        async function fetchEligibleOps(clientId = '') {
            const select = document.getElementById('ssOpsFiles');
            select.innerHTML = ''; // Clear existing options immediately
            
            // If no client is selected, leave the operations dropdown empty
            if (!clientId) {
                $('#ssOpsFiles').trigger('change'); // Refresh Select2 UI
                return; 
            }

            try {
                const res = await fetch(`../../api/success_story_api.php?action=fetch_eligible_ops&client_id=${clientId}`);
                const data = await res.json();
                
                if (data.success) {
                    data.ops.forEach(op => {
                        const opt = document.createElement('option');
                        opt.value = op.operations_file_reference;
                        
                        // Check for Bill of Lading or Airway Bill
                        let transportDoc = '';
                        if (op.sea_bl) {
                            transportDoc = ` | BL: ${op.sea_bl}`;
                        } else if (op.air_mawb) {
                            transportDoc = ` | AWB: ${op.air_mawb}`;
                        }
                        
                        // Output format: REF - Client Name (Service) | BL/AWB: xxx
                        opt.text = `${op.operations_file_reference} - ${op.client_name} (${op.service_type})${transportDoc}`;
                        select.appendChild(opt);
                    });
                    
                    $('#ssOpsFiles').trigger('change'); // Refresh Select2 UI to show new options
                }
            } catch (e) { 
                console.error("Failed to load operations."); 
                utils.showToast('Error', 'Failed to load client operations', 'error');
            }
        }

        function openBuilder() {
            // Reset form
            document.getElementById('ssClient').value = '';
            $('#ssOpsFiles').val(null).trigger('change');
            document.getElementById('ssCategory').value = '';
            document.getElementById('ssTitleIdea').value = '';
            document.getElementById('ssNotes').value = '';
            document.getElementById('aiFollowUpAlert').classList.add('d-none');
            
            document.getElementById('outTitle').value = '';
            document.getElementById('outExecSum').value = '';
            document.getElementById('outOpsExec').value = '';
            document.getElementById('kpiContainer').innerHTML = '';
            
            // Reset images
            document.getElementById('fileCover').value = '';
            document.getElementById('previewCover').style.display = 'none';
            document.getElementById('textCover').style.display = 'inline';
            document.getElementById('fileLogo').value = '';
            document.getElementById('previewLogo').style.display = 'none';
            document.getElementById('textLogo').style.display = 'inline';
            document.getElementById('fileGallery').value = '';

            addKpiRow(); // add one blank row
            bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('storyBuilderOffcanvas')).show();
        }

        // --- Image Preview ---
        function previewImage(input, imgId) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const img = document.getElementById(imgId);
                    img.src = e.target.result;
                    img.style.display = 'block';
                    img.nextElementSibling.style.display = 'none'; // hide the span text
                }
                reader.readAsDataURL(input.files[0]);
            }
        }

        // --- KPI Rows ---
        function addKpiRow(label = '', value = '') {
            const container = document.getElementById('kpiContainer');
            const row = document.createElement('div');
            row.className = 'kpi-row';
            row.innerHTML = `
                <input type="text" class="form-control smart-input kpi-label" placeholder="Metric (e.g. Tonnage)" value="${label}">
                <input type="text" class="form-control smart-input fw-bold text-smart-dark kpi-value" placeholder="Value (e.g. 450 Tons)" value="${value}">
                <button class="btn btn-outline-danger btn-sm" onclick="this.parentElement.remove()"><i class="fa-solid fa-times"></i></button>
            `;
            container.appendChild(row);
        }

        function getKpis() {
            const kpis = [];
            document.querySelectorAll('.kpi-row').forEach(row => {
                const label = row.querySelector('.kpi-label').value;
                const val = row.querySelector('.kpi-value').value;
                if(label && val) kpis.push({ label: label, value: val });
            });
            return kpis;
        }

        // --- Dictation (Groq API via Backend) ---
        let mediaRecorder = null;
        let audioChunks = [];
        let isRecording = false;

        async function toggleDictation() {
            const btn = document.getElementById('btnDictate');
            
            if (isRecording) {
                if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                audioChunks = [];

                mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };

                mediaRecorder.onstop = async () => {
                    stream.getTracks().forEach(track => track.stop());
                    
                    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
                    btn.classList.replace('btn-danger', 'btn-outline-danger');
                    btn.classList.remove('dictation-pulse');
                    
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    await processAudio(audioBlob);
                    
                    isRecording = false;
                };

                mediaRecorder.start();
                isRecording = true;
                
                btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
                btn.classList.replace('btn-outline-danger', 'btn-danger');
                btn.classList.add('dictation-pulse');

            } catch (err) {
                utils.showToast('Microphone Error', 'Please allow mic access in your browser.', 'error');
            }
        }

        async function processAudio(blob) {
            const btn = document.getElementById('btnDictate');
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = async function() {
                try {
                    const res = await fetch('../../api/success_story_api.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            action: 'transcribe_audio', 
                            audio_b64: reader.result,
                            service_type: document.getElementById('ssCategory').value || 'Logistics'
                        })
                    });
                    const result = await res.json();
                    
                    if (result.success) {
                        const notesEl = document.getElementById('ssNotes');
                        notesEl.value = notesEl.value ? notesEl.value + ' ' + result.text : result.text;
                        
                        // Handle AI Follow-up if audio was too brief
                        const alertBox = document.getElementById('aiFollowUpAlert');
                        if (result.follow_up) {
                            document.getElementById('aiFollowUpText').innerText = result.follow_up;
                            alertBox.classList.remove('d-none');
                        } else {
                            alertBox.classList.add('d-none');
                        }
                    } else {
                        utils.showToast('Error', result.error, 'error');
                    }
                } catch (e) {
                    utils.showToast('Error', 'Transcription network error.', 'error');
                } finally {
                    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                }
            };
        }

        // --- Generate Story (Gemini API) ---
        async function generateStory() {
            const opsRefs = $('#ssOpsFiles').val();
            if (!opsRefs || opsRefs.length === 0) {
                utils.showToast('Error', 'Please link at least one Operations File.', 'error');
                return;
            }

            const payload = {
                action: 'generate_story',
                ops_refs: opsRefs,
                messy_notes: document.getElementById('ssNotes').value,
                title_idea: document.getElementById('ssTitleIdea').value
            };

            document.getElementById('aiLoadingOverlay').classList.remove('d-none');

            try {
                const res = await fetch('../../api/success_story_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();

                if (result.success && result.generated_content) {
                    const ai = result.generated_content;
                    document.getElementById('outTitle').value = ai.title || '';
                    document.getElementById('outExecSum').value = ai.exec_summary || '';
                    document.getElementById('outOpsExec').value = ai.ops_execution || '';
                    
                    document.getElementById('kpiContainer').innerHTML = ''; // Clear existing
                    if (ai.hard_kpis && ai.hard_kpis.length > 0) {
                        ai.hard_kpis.forEach(kpi => addKpiRow(kpi.label, kpi.value));
                    } else {
                        addKpiRow();
                    }
                    utils.showToast('Generation Complete', 'Review and edit the technical overview.', 'success');
                } else {
                    utils.showToast('AI Error', result.error || 'Generation failed.', 'error');
                }
            } catch (e) {
                utils.showToast('Network Error', 'Failed to connect to AI engine.', 'error');
            } finally {
                document.getElementById('aiLoadingOverlay').classList.add('d-none');
            }
        }

        // --- Save / Publish Pipeline ---
        async function saveStory() {
            // Validation
            const clientId = document.getElementById('ssClient').value;
            const title = document.getElementById('outTitle').value;
            const coverInput = document.getElementById('fileCover');
            
            if(!clientId) return utils.showToast('Error', 'Please select a Client.', 'error');
            if(!title) return utils.showToast('Error', 'Generated Title is empty. Please run generation first.', 'error');
            if(coverInput.files.length === 0) return utils.showToast('Error', 'A Cover Image is mandatory for portfolio items.', 'error');

            const btn = document.getElementById('btnSaveStory');
            const origHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Uploading & Saving...';
            btn.disabled = true;

            try {
                // 1. Upload Assets via FormData
                const formData = new FormData();
                formData.append('action', 'upload_assets');
                formData.append('cover', coverInput.files[0]);
                
                const logoInput = document.getElementById('fileLogo');
                if(logoInput.files.length > 0) formData.append('logo', logoInput.files[0]);
                
                const galleryInput = document.getElementById('fileGallery');
                for(let i=0; i < galleryInput.files.length; i++) {
                    formData.append('gallery[]', galleryInput.files[i]);
                }

                const uploadRes = await fetch('../../api/success_story_api.php', { method: 'POST', body: formData });
                const uploadData = await uploadRes.json();
                
                if(!uploadData.success) throw new Error(uploadData.error || 'Image upload failed');

                // 2. Save JSON Data
                const storyPayload = {
                    action: 'save_story',
                    client_id: clientId,
                    ops_refs: $('#ssOpsFiles').val(),
                    service_category: document.getElementById('ssCategory').value || 'Logistics',
                    title: title,
                    exec_summary: document.getElementById('outExecSum').value,
                    ops_execution: document.getElementById('outOpsExec').value,
                    hard_kpis: getKpis(),
                    status: document.getElementById('ssStatus').value,
                    cover_image_path: uploadData.paths.cover,
                    client_logo_path: uploadData.paths.logo || null,
                    gallery_images: uploadData.paths.gallery || []
                };

                const saveRes = await fetch('../../api/success_story_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(storyPayload)
                });
                const saveData = await saveRes.json();

                if(saveData.success) {
                    utils.showToast('Success', `Portfolio Item saved. ID: ${saveData.story_id}`, 'success');
                    bootstrap.Offcanvas.getInstance(document.getElementById('storyBuilderOffcanvas')).hide();
                    // In real app: fetchStories() to refresh the dashboard list
                } else {
                    throw new Error(saveData.error || 'Failed to save record.');
                }
            } catch (e) {
                utils.showToast('Error', e.message, 'error');
            } finally {
                btn.innerHTML = origHtml;
                btn.disabled = false;
            }
        }

        return { init, openBuilder, previewImage, addKpiRow, toggleDictation, generateStory, saveStory };
    })();

    document.addEventListener('DOMContentLoaded', APP.init);
</script>
</body>
</html>