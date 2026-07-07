<?php
/**
 * api/vault_handler.php
 * v4.4 - Production Release
 * Integrity: High | Logic: Strict | Naming: User_Random6
 */
header('Content-Type: application/json');

// BUFFERING: Prevent "garbage text" in downloads
ob_start();

require_once __DIR__ . '/../includes/init.php';
require_once __DIR__ . '/../includes/role_guard.php';

// Clear buffer to ensure no previous whitespace is sent
ob_clean();

$userId   = $_SESSION['auth']['user_id'] ?? 0;
$empId    = $_SESSION['auth']['employee_id'] ?? '';
$role     = $_SESSION['auth']['role'] ?? 'USER';
$userName = $_SESSION['auth']['username'] ?? 'User';

if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

$isPrivileged = in_array($role, ['ADMIN', 'FINANCE', 'MANAGEMENT']);

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$action = (string)($_REQUEST['action'] ?? '');

try {
    switch ($action) {
        // --- Core Fetching ---
        case 'fetch_tree':         fetchTree($conn); break;
        case 'fetch_content':      fetchFolderContent($conn, $role, $empId); break;

        // --- Compliance & Actions ---
        case 'fetch_missing':      fetchMissingEvidence($conn, $role, $empId); break;
        case 'fetch_action_items': fetchActionItems($conn, $role, $empId); break;
        case 'fetch_pr_lines':     fetchPRLines($conn); break;

        // --- Operations ---
        case 'upload_wizard':      handleWizardUpload($conn, $empId, $userName); break;
        case 'validate_doc':       validateDocument($conn, $role, $userName); break;
        case 'delete_doc':         deleteDocument($conn, $role, $empId); break;

        // --- File Handling ---
        case 'view_file':          serveSecureFile($conn, $role, false); break;
        case 'download_file':      serveSecureFile($conn, $role, true); break;
        case 'fetch_history':      fetchAuditHistory($conn); break;

        // --- Reporting ---
        case 'fetch_kpis':         fetchLiveKPIs($conn); break;

        default: throw new Exception("Invalid Action");
    }
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}

// ------------------------------------------------------------------------------
// 1. REPOSITORY LOGIC
// ------------------------------------------------------------------------------

function fetchTree($conn) {
    $mode = strtoupper(trim((string)($_GET['mode'] ?? 'OPS')));
    $tree = [];

    if ($mode === 'OPS') {
        $sql = "SELECT operations_file_reference, client_name
                FROM operations_file_master
                WHERE operations_status <> 'NOT_AWARDED'
                  AND operations_file_reference IS NOT NULL
                  AND operations_file_reference <> ''
                ORDER BY operations_file_reference DESC
                LIMIT 5000";

        $res = $conn->query($sql);

        while ($row = $res->fetch_assoc()) {
            $opsRef = (string)$row['operations_file_reference'];
            $client = (string)($row['client_name'] ?? '');
            $tree[] = [
                'id'   => $opsRef,
                'name' => ($client !== '') ? ($opsRef . ' - ' . $client) : $opsRef,
                'type' => 'folder'
            ];
        }
    } else {
        $folders = ['Legal', 'HR', 'Procurement', 'Finance', 'General', 'Facility'];
        foreach ($folders as $f) {
            $tree[] = ['id' => $f, 'name' => "$f Docs", 'type' => 'folder'];
        }
    }
    echo json_encode(['status' => 'success', 'data' => $tree]);
}

function fetchFolderContent($conn, $role, $empId) {
    $folder  = $_POST['folder'] ?? '';
    $context = $_POST['context'] ?? 'OPS';
    global $isPrivileged;

    $sql = "SELECT * FROM document_vault_master WHERE folder_ref = ? AND file_context = ?";
    if (!$isPrivileged) {
        $sql .= " AND uploaded_by = ?"; // SILO: Only show my uploads
    }
    $sql .= " ORDER BY uploaded_at DESC";

    $stmt = $conn->prepare($sql);
    if (!$isPrivileged) { $stmt->bind_param('sss', $folder, $context, $empId); } 
    else { $stmt->bind_param('ss', $folder, $context); }
    
    $stmt->execute();
    $res = $stmt->get_result();
    $files = [];
    while ($row = $res->fetch_assoc()) {
        $files[] = [
            'uuid' => $row['doc_uuid'], 'doc_ref' => $row['doc_reference'],
            'filename' => $row['user_filename'], 'type' => $row['doc_type'],
            'status' => $row['status'], 'uploader' => $row['uploaded_by_name'],
            'date' => date('d M Y', strtotime($row['uploaded_at'])), 'mime' => $row['file_mime']
        ];
    }
    echo json_encode(['status' => 'success', 'data' => $files]);
}

function fetchActionItems($conn, $role, $empId) {
    // 1. Define Who Can Validate (Managers/Admins)
    $canValidate = in_array($role, ['ADMIN', 'FINANCE', 'MANAGEMENT']);

    // Subquery: Get line description safely
    $descSubquery = "(SELECT crl.line_desc 
                      FROM document_line_link dll
                      JOIN cash_request_lines crl ON dll.line_id = crl.line_id
                      WHERE dll.doc_uuid = dvm.doc_uuid 
                      LIMIT 1)";

    $cols = "dvm.*, $descSubquery as linked_description";

    // ---------------------------------------------------------
    // LOGIC PATCH: Strict Separation of Concerns
    // ---------------------------------------------------------
    
    if ($canValidate) {
        // VALIDATORS (Anita): 
        // See ONLY 'PENDING'. 
        // They should NOT see 'REJECTED' files (those belong to the uploader to fix).
        $sql = "SELECT $cols FROM document_vault_master dvm 
                WHERE dvm.status = 'PENDING' 
                ORDER BY dvm.uploaded_at ASC";
        $stmt = $conn->prepare($sql);

    } else {
        // REGULAR USERS (John): 
        // See 'PENDING' (Monitoring) and 'REJECTED' (Action Required).
        // STRICT FILTER: MUST match dvm.uploaded_by to prevent leakage.
        $sql = "SELECT $cols FROM document_vault_master dvm 
                WHERE dvm.uploaded_by = ? 
                AND dvm.status IN ('PENDING', 'REJECTED') 
                ORDER BY dvm.uploaded_at DESC";
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('s', $empId);
    }

    // ---------------------------------------------------------

    $stmt->execute();
    $res = $stmt->get_result();
    $items = [];

    while ($row = $res->fetch_assoc()) {
        $descDisplay = !empty($row['linked_description'])
            ? '<span class="text-primary fw-bold"><i class="fa-solid fa-link me-1"></i>' . $row['linked_description'] . '</span>'
            : '<span class="text-muted"><i class="fa-solid fa-cloud-arrow-up me-1"></i> Direct Upload</span>';

        $statusBadge = ($row['status'] === 'PENDING')
            ? '<span class="badge bg-warning text-dark">WAITING</span>'
            : '<span class="badge bg-danger">ACTION REQ</span>';

        $items[] = [
            'uuid'        => $row['doc_uuid'],
            'filename'    => $row['user_filename'],
            'folder'      => $row['folder_ref'],
            'uploader'    => $row['uploaded_by_name'],
            'status'      => $row['status'],
            'status_html' => $statusBadge,
            'note'        => $row['rejection_note'],
            'date'        => date('d M Y', strtotime($row['uploaded_at'])),
            'mime'        => $row['file_mime'],
            'desc_html'   => $descDisplay
        ];
    }
    
    // Return Role View so Frontend knows whether to show "Approve/Reject" buttons
    echo json_encode(['status' => 'success', 'data' => $items, 'role_view' => $canValidate ? 'VALIDATOR' : 'USER']);
}

function fetchPRLines($conn) {
    global $userId, $isPrivileged; // Import Numeric User ID
    
    $fileRef = trim((string)($_GET['file_ref'] ?? ''));
    $context = strtoupper(trim((string)($_GET['context'] ?? 'OPS')));

    $sql = "SELECT crl.line_id, crl.pr_id, crl.line_desc, crl.amount, crm.beneficiary, crm.ops_file_ref
            FROM cash_request_lines crl
            JOIN cash_request_master crm ON crl.pr_id = crm.pr_id
            WHERE crl.justification_required = 1
              AND crm.status IN ('VALIDATED','DISBURSED')";

    // Context Filtering
    if ($context === 'OVH') {
        $sql .= " AND (crm.ops_file_ref IS NULL OR crm.ops_file_ref = '' OR crm.ops_file_ref = 'Overhead')";
    } else {
        $sql .= " AND crm.ops_file_ref = ?";
    }

    // Silo Filtering: Use Numeric ID
    if (!$isPrivileged) {
        $sql .= " AND crm.created_by = ?";
    }

    $sql .= " ORDER BY crl.pr_id DESC";
    $stmt = $conn->prepare($sql);

    // BINDING LOGIC (Strict Type Matching)
    // 's' = string (fileRef), 'i' = integer (userId)
    
    if ($context === 'OPS' && !$isPrivileged) {
        $stmt->bind_param('si', $fileRef, $userId); 
    } elseif ($context === 'OPS' && $isPrivileged) {
        $stmt->bind_param('s', $fileRef);
    } elseif ($context === 'OVH' && !$isPrivileged) {
        $stmt->bind_param('i', $userId);
    }
    // If OVH and Privileged, no parameters needed.

    $stmt->execute();
    $res = $stmt->get_result();
    $lines = [];

    while ($row = $res->fetch_assoc()) {
        $lineId = (string)$row['line_id'];
        // Deduplication check
        $chkSql = "SELECT 1 FROM document_line_link dll
                   JOIN document_vault_master dvm ON dll.doc_uuid = dvm.doc_uuid
                   WHERE dll.line_id = ? AND dvm.status <> 'REJECTED' LIMIT 1";
        $chkStmt = $conn->prepare($chkSql);
        $chkStmt->bind_param('s', $lineId);
        $chkStmt->execute();
        if ($chkStmt->get_result()->num_rows === 0) { $lines[] = $row; }
    }
    echo json_encode(['status' => 'success', 'data' => $lines]);
}

function fetchMissingEvidence($conn, $role, $empId) {
    global $userId, $isPrivileged; // Import Numeric User ID

    $sql = "SELECT crl.pr_id, crl.line_id, crl.line_desc, 
                   crm.beneficiary, crm.created_by as requisitor, 
                   crm.ops_file_ref, crm.disbursed_time,
                   ofm.client_name
            FROM cash_request_lines crl
            JOIN cash_request_master crm ON crl.pr_id = crm.pr_id
            LEFT JOIN operations_file_master ofm ON crm.ops_file_ref = ofm.operations_file_reference
            WHERE crl.justification_required = 1 
            AND crm.disbursed_total > 0
            AND crl.line_id NOT IN (
                SELECT dll.line_id 
                FROM document_line_link dll 
                JOIN document_vault_master dvm ON dll.doc_uuid = dvm.doc_uuid
                WHERE dvm.status <> 'REJECTED'
            )";

    // SILO: Filter by Numeric User ID
    if (!$isPrivileged) {
        $sql .= " AND crm.created_by = ? "; 
    }

    $stmt = $conn->prepare($sql);

    if (!$isPrivileged) {
        $stmt->bind_param('s', $empId); // Bind as Integer
    }

    $stmt->execute();
    $res = $stmt->get_result();
    $missing = [];
    while ($row = $res->fetch_assoc()) {
        $age = floor((time() - strtotime($row['disbursed_time'] ?? 'now')) / 86400);
        $missing[] = [
            'unique_key' => $row['pr_id'] . '_' . $row['line_id'],
            'pr_id'      => $row['pr_id'],
            'line_id'    => $row['line_id'],
            'line_desc'  => $row['line_desc'],
            'beneficiary'=> $row['beneficiary'],
            'requisitor' => $row['requisitor'],
            'file_ref'   => $row['ops_file_ref'] ?? 'Overhead',
            'client'     => $row['client_name'] ?? 'Internal/Overhead',
            'debt_age'   => $age . ' Days',
            'is_overdue' => $age > 2
        ];
    }
    echo json_encode(['status' => 'success', 'data' => $missing]);
}

function handleWizardUpload($conn, $empId, $uploaderName) {
    if (!isset($_FILES['file_0'])) throw new Exception("No files received");

    $folder      = $_POST['folder_ref'];
    $context     = $_POST['context'];
    $docType     = $_POST['doc_type'];
    $physLoc     = $_POST['phys_loc'];
    $fileCount   = (int)$_POST['file_count'];
    $linkedLines = isset($_POST['linked_lines']) ? explode(',', $_POST['linked_lines']) : [];

    $targetDir = __DIR__ . '/../../../assets/img-webp/vault/';
    if (!is_dir($targetDir)) mkdir($targetDir, 0755, true);

    $success = 0;
    $generatedRefs = [];

    for ($i = 0; $i < $fileCount; $i++) {
        if (!isset($_FILES["file_$i"])) continue;

        $file = $_FILES["file_$i"];
        $desc = $_POST["desc_$i"] ?? $docType;

        if ($file['error'] !== UPLOAD_ERR_OK) continue;

        // Generate Reference
        $prefix = ($context === 'OPS') ? 'OP' : 'OV';
        $random8 = strtoupper(bin2hex(random_bytes(4)));
        $docReference = $prefix . $random8;

        // Standard File Logic
        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        $cleanName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', pathinfo($file['name'], PATHINFO_FILENAME));
        $randomCode = random_int(100000, 999999);
        $storageName = $cleanName . '_' . $randomCode . '.' . $ext;
        $uuid = bin2hex(random_bytes(16));

        if (move_uploaded_file($file['tmp_name'], $targetDir . $storageName)) {
            $sql = "INSERT INTO document_vault_master 
                   (doc_uuid, doc_reference, file_context, folder_ref, doc_type, user_filename, description, storage_path, file_mime, file_size, physical_location, uploaded_by, uploaded_by_name)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

            $stmt = $conn->prepare($sql);
            $mime = $file['type'];
            $size = (int)$file['size'];

            $stmt->bind_param('sssssssssisss', $uuid, $docReference, $context, $folder, $docType, $file['name'], $desc, $storageName, $mime, $size, $physLoc, $empId, $uploaderName);

            if ($stmt->execute()) {
                $success++;
                $generatedRefs[] = ['ref' => $docReference, 'file' => $file['name']];

                if (!empty($linkedLines)) {
                    $linkSql = "INSERT IGNORE INTO document_line_link 
                               (doc_uuid, line_id, pr_id, file_ref, context, created_by_user_id) 
                               VALUES (?, ?, ?, ?, ?, ?)";
                    $linkStmt = $conn->prepare($linkSql);

                    $lookupSql = "SELECT crl.pr_id, crm.ops_file_ref 
                                  FROM cash_request_lines crl
                                  JOIN cash_request_master crm ON crl.pr_id = crm.pr_id
                                  WHERE crl.line_id = ?";
                    $lookupStmt = $conn->prepare($lookupSql);

                    foreach ($linkedLines as $lineId) {
                        $lid = (int)$lineId;
                        if ($lid <= 0) continue;

                        $lookupStmt->bind_param('i', $lid);
                        $lookupStmt->execute();
                        $meta = $lookupStmt->get_result()->fetch_assoc();

                        $prId = $meta['pr_id'] ?? null;
                        $ref  = $meta['ops_file_ref'] ?? null;
                        $ctx  = $context;
                        $uId  = $empId;

                        $linkStmt->bind_param('sissss', $uuid, $lid, $prId, $ref, $ctx, $uId);
                        $linkStmt->execute();
                    }
                }
            }
        }
    }
    echo json_encode(['status' => 'success', 'count' => $success, 'refs' => $generatedRefs]);
}

// ------------------------------------------------------------------------------
// 4. VALIDATION, DELETION, HISTORY
// ------------------------------------------------------------------------------

function validateDocument($conn, $role, $adminName) {
    if (!in_array($role, ['ADMIN', 'FINANCE', 'MANAGEMENT'])) throw new Exception("Access Denied");

    $uuid = $_POST['uuid'];
    $action = $_POST['valid_action'];
    $note = $_POST['note'] ?? '';
    $status = ($action === 'VERIFY') ? 'VERIFIED' : 'REJECTED';

    $sqlGet = "SELECT audit_log FROM document_vault_master WHERE doc_uuid = ?";
    $stmt = $conn->prepare($sqlGet);
    $stmt->bind_param('s', $uuid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();

    $logArr = $row['audit_log'] ? json_decode($row['audit_log'], true) : [];
    if (!is_array($logArr)) $logArr = [];

    $logArr[] = [
        'action' => $status,
        'by'     => $adminName,
        'role'   => $role,
        'note'   => $note,
        'time'   => date('Y-m-d H:i:s')
    ];

    $newLogJson = json_encode($logArr);

    $sql = "UPDATE document_vault_master SET status = ?, rejection_note = ?, audit_log = ? WHERE doc_uuid = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ssss', $status, $note, $newLogJson, $uuid);
    $stmt->execute();

    echo json_encode(['status' => 'success']);
}

function deleteDocument($conn, $role, $empId) {
    $uuid = $_POST['uuid'];

    $sql = "SELECT uploaded_by, status, storage_path FROM document_vault_master WHERE doc_uuid = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $uuid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();

    if (!$row) throw new Exception("File not found");

    $isOwner = ($row['uploaded_by'] === $empId);
    $canDelete = ($isOwner && in_array($row['status'], ['PENDING', 'REJECTED'])) || in_array($role, ['ADMIN']);

    if (!$canDelete) throw new Exception("Cannot delete this file.");

    $path = __DIR__ . '/../../../assets/img-webp/vault/' . $row['storage_path'];
    if (file_exists($path)) unlink($path);

    $conn->query("DELETE FROM document_line_link WHERE doc_uuid = '$uuid'");
    $conn->query("DELETE FROM document_vault_master WHERE doc_uuid = '$uuid'");

    echo json_encode(['status' => 'success']);
}

function fetchAuditHistory($conn) {
    $uuid = $_GET['uuid'] ?? '';
    $sql = "SELECT audit_log FROM document_vault_master WHERE doc_uuid = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $uuid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();

    $logs = $row['audit_log'] ? json_decode($row['audit_log'], true) : [];
    echo json_encode(['status' => 'success', 'data' => $logs]);
}

// ------------------------------------------------------------------------------
// 5. VIEWING & KPIs
// ------------------------------------------------------------------------------

function serveSecureFile($conn, $role, $isDownload) {
    if (!$role) die("Unauthorized");
    ob_clean();

    $uuid = $_GET['uuid'] ?? '';
    $sql = "SELECT storage_path, file_mime, user_filename FROM document_vault_master WHERE doc_uuid = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $uuid);
    $stmt->execute();
    $res = $stmt->get_result();

    if ($row = $res->fetch_assoc()) {
        $path = __DIR__ . '/../../../assets/img-webp/vault/' . $row['storage_path'];
        if (file_exists($path)) {
            header('Content-Type: ' . $row['file_mime']);
            header('Content-Length: ' . filesize($path));
            $disposition = $isDownload ? 'attachment' : 'inline';
            header('Content-Disposition: ' . $disposition . '; filename="' . $row['user_filename'] . '"');
            readfile($path);
            exit;
        }
    }
    http_response_code(404); echo "File Not Found";
}

function fetchLiveKPIs($conn) {
    global $isPrivileged, $empId, $userId; // Import ALL required IDs
    
    // 1. Vault Silo (Uses Employee ID String)
    $vaultSilo = (!$isPrivileged) ? " WHERE uploaded_by = '$empId'" : "";
    
    // 2. Cash Request Silo (Uses User ID Number)
    $crmSilo = (!$isPrivileged) ? " AND crm.created_by = $userId" : "";

    // Query 1: Total Documents
    $totalFiles = $conn->query("SELECT COUNT(*) as c FROM document_vault_master $vaultSilo")->fetch_assoc()['c'];

    // Query 2: Pending Validation (Safe SQL Construction)
    $pendingSql = "SELECT COUNT(*) as c FROM document_vault_master WHERE status = 'PENDING'";
    if (!$isPrivileged) {
        $pendingSql .= " AND uploaded_by = '$empId'";
    }
    $pendingFiles = $conn->query($pendingSql)->fetch_assoc()['c'];

    // Query 3: Missing Evidence (Uses Numeric UserID for Silo)
    $sqlMissing = "SELECT COUNT(*) as c FROM cash_request_lines crl
                   JOIN cash_request_master crm ON crl.pr_id = crm.pr_id
                   WHERE crl.justification_required = 1 
                   AND crm.disbursed_total > 0
                   AND crl.line_id NOT IN (
                       SELECT dll.line_id FROM document_line_link dll
                       JOIN document_vault_master dvm ON dll.doc_uuid = dvm.doc_uuid
                       WHERE dvm.status <> 'REJECTED'
                   ) $crmSilo";
                   
    $missingCount = $conn->query($sqlMissing)->fetch_assoc()['c'];

    echo json_encode([
        'status' => 'success',
        'kpis' => [
            'total' => $totalFiles, 
            'pending' => $pendingFiles,
            'missing' => $missingCount, 
            'compliance' => ($totalFiles > 0 ? round((($totalFiles) / ($totalFiles + $missingCount)) * 100) : 100)
        ]
    ]);
}