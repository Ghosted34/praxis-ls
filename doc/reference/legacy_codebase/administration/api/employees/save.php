<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

// Turn off default error display to prevent HTML breaking JSON, 
// but log errors for the server.
ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');

try {
    $conn = db();

    // --- HELPER FUNCTIONS ---
    function s($v): string { return trim((string)$v); }
    function nullableDate($v): ?string {
        $v = trim((string)$v);
        return $v === '' ? null : $v;
    }

    // --- 1. INPUT PARSING ---
    $id           = s($_POST['id'] ?? '');
    $name         = s($_POST['name'] ?? '');
    $signatory    = s($_POST['signatory'] ?? '');
    $email        = s($_POST['email'] ?? '');
    $phone        = s($_POST['phone'] ?? '');
    $address      = s($_POST['address'] ?? '');
    $dept         = s($_POST['dept'] ?? '');
    $title        = s($_POST['title'] ?? '');
    $type         = s($_POST['type'] ?? 'PERMANENT');
    $joinDate     = s($_POST['joinDate'] ?? '');
    $status       = s($_POST['status'] ?? 'PENDING');

    $nationality  = s($_POST['nationality'] ?? '');
    $idCard       = s($_POST['idCard'] ?? '');
    $numChildren  = (int)($_POST['numChildren'] ?? 0);
    $dob          = nullableDate($_POST['dob'] ?? null);
    $marital      = s($_POST['marital'] ?? '');

    $contractRef  = s($_POST['contractRef'] ?? '');
    $lineManager  = s($_POST['lineManager'] ?? ''); 
    if ($lineManager === '') $lineManager = null;

    $cnps         = s($_POST['cnps'] ?? '');
    $salary       = (float)($_POST['salary'] ?? 0);
    $payMethod    = s($_POST['payMethod'] ?? 'BANK_TRANSFER');
    $bank         = s($_POST['bank'] ?? '');

    $createLogin  = (s($_POST['createLogin'] ?? 'false') === 'true');
    $loginUser    = s($_POST['loginUser'] ?? '');
    $authArr      = isset($_POST['authority']) ? (array)$_POST['authority'] : [];
    $authority    = implode(',', array_map('strval', $authArr));

    // --- 2. VALIDATION ---
    if ($name === '' || $email === '' || $dept === '' || $title === '' || $joinDate === '') {
        http_response_code(422);
        echo json_encode(['ok' => false, 'message' => 'Missing required fields']);
        exit;
    }

    // --- 3. FOLDERS ---
    $baseUploadPath = __DIR__ . '/../../administration/uploads/employee';
    $avatarDir      = $baseUploadPath . '/avatars/';
    $docDir         = $baseUploadPath . '/documents/';

    if (!is_dir($avatarDir)) @mkdir($avatarDir, 0755, true);
    if (!is_dir($docDir)) @mkdir($docDir, 0755, true);

    $conn->begin_transaction();

    // --- 4. ID GENERATION ---
    $needsNewId = ($id === '' || $id === 'SL-XXX');
    if ($needsNewId) {
        $sqlMax = "SELECT employee_id FROM employee_master WHERE employee_id LIKE 'SL-%' ORDER BY LENGTH(employee_id) DESC, employee_id DESC LIMIT 1 FOR UPDATE";
        $res = $conn->query($sqlMax);
        if (!$res) throw new Exception("ID Generation Query Failed: " . $conn->error);
        
        $row = $res->fetch_assoc();
        $maxN = $row ? (int)substr($row['employee_id'], 3) : 0;
        $id = 'SL-' . str_pad((string)($maxN + 1), 3, '0', STR_PAD_LEFT);
    }

    // --- 5. AVATAR UPLOAD ---
    $avatarPathSQL = null; 
    if (isset($_FILES['avatarFile']) && $_FILES['avatarFile']['error'] === UPLOAD_ERR_OK) {
        $ext = strtolower(pathinfo($_FILES['avatarFile']['name'], PATHINFO_EXTENSION));
        if (in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) {
            $fileName = $id . '.' . $ext;
            if (move_uploaded_file($_FILES['avatarFile']['tmp_name'], $avatarDir . $fileName)) {
                $avatarPathSQL = 'administration/uploads/employee/avatars/' . $fileName;
            }
        }
    }

    // --- 6. INSERT / UPDATE ---
    $sql = "INSERT INTO employee_master 
    (employee_id, full_name, signatory_name, email, phone, address, department, job_title, 
     employment_type, contract_reference, join_date, status, 
     nationality, id_card_number, num_children, dob, marital_status, 
     line_manager_name, base_salary, payment_method, bank_details, cnps_number, 
     system_authority" . ($avatarPathSQL ? ", avatar_path" : "") . ")
    VALUES 
    (?, ?, ?, ?, ?, ?, ?, ?, 
     ?, ?, ?, ?, 
     ?, ?, ?, ?, ?, 
     ?, ?, ?, ?, ?, 
     ?" . ($avatarPathSQL ? ", ?" : "") . ")
    ON DUPLICATE KEY UPDATE 
     full_name=VALUES(full_name), signatory_name=VALUES(signatory_name), email=VALUES(email), 
     phone=VALUES(phone), address=VALUES(address),
     department=VALUES(department), job_title=VALUES(job_title), employment_type=VALUES(employment_type), 
     contract_reference=VALUES(contract_reference), join_date=VALUES(join_date), status=VALUES(status), 
     nationality=VALUES(nationality), id_card_number=VALUES(id_card_number), num_children=VALUES(num_children), 
     dob=VALUES(dob), marital_status=VALUES(marital_status), line_manager_name=VALUES(line_manager_name), 
     base_salary=VALUES(base_salary), payment_method=VALUES(payment_method), bank_details=VALUES(bank_details), 
     cnps_number=VALUES(cnps_number), system_authority=VALUES(system_authority)" 
     . ($avatarPathSQL ? ", avatar_path=VALUES(avatar_path)" : "");

    $stmt = $conn->prepare($sql);
    
    // --- 7. USER AUTH (improved) ---
if ($createLogin || $loginUser !== '') {
    // ensure $loginUser exists - prefer provided, otherwise generate from email
    if ($loginUser === '') {
        // generate a sane username from email: local-part or employee id fallback
        if ($email !== '') {
            $loginUser = strtolower(preg_replace('/[^a-z0-9._-]/', '', strstr($email, '@', true) ?: $email));
            if ($loginUser === '') $loginUser = strtolower(str_replace(['SL-',' '], ['', '_'], $id));
        } else {
            $loginUser = strtolower(str_replace(['SL-',' '], ['', '_'], $id));
        }
    }

    // check existing account for this employee
    $check = $conn->prepare("SELECT user_id FROM user_auth WHERE employee_id = ? LIMIT 1");
    if (!$check) throw new Exception("Prepare failed (check user_auth): " . $conn->error);
    $check->bind_param('s', $id);
    $check->execute();
    $exists = $check->get_result()->fetch_assoc();
    $check->close();

    $role = in_array($dept, ['ADMIN','FINANCE','SALES','OPERATIONS','MANAGEMENT']) ? $dept : 'ADMIN';

    if ($exists && !empty($exists['user_id'])) {
        $targetUserId = (int)$exists['user_id'];
        $uStmt = $conn->prepare("UPDATE user_auth SET username=?, role=?, authority_capabilities=? WHERE employee_id=?");
        if (!$uStmt) throw new Exception("Prepare failed (update user_auth): " . $conn->error);
        $uStmt->bind_param('ssss', $loginUser, $role, $authority, $id);
        if ($uStmt->execute() === false) {
            $err = $uStmt->error ?: $conn->error;
            $uStmt->close();
            throw new Exception("Failed to update user_auth: " . $err);
        }
        $uStmt->close();
    } else {
        // Insert new user_auth row. We set a temporary empty password hash and require set-password on next login.
        $uStmt = $conn->prepare("INSERT INTO user_auth (employee_id, username, role, authority_capabilities, password_hash, must_set_password, is_active) VALUES (?, ?, ?, ?, '', 1, 0)");
        if (!$uStmt) throw new Exception("Prepare failed (insert user_auth): " . $conn->error);
        $uStmt->bind_param('ssss', $id, $loginUser, $role, $authority);
        if ($uStmt->execute() === false) {
            $err = $uStmt->error ?: $conn->error;
            $uStmt->close();
            throw new Exception("Failed to insert user_auth: " . $err);
        }
        $targetUserId = (int)$conn->insert_id;
        $uStmt->close();
    }

    // optional: you could log this action (audit_log) here or after commit
    // error_log("PROVISION: user_auth created/updated for employee_id={$id}, user_id={$targetUserId}");
}

    
    // SAFETY CHECK: If $stmt is false, the SQL failed (likely missing column)
    if (!$stmt) {
        throw new Exception("Database Prepare Failed: " . $conn->error);
    }
    
    // Binding: 23 base vars + 1 optional avatar
    $typesWithAvatar = 'sssssssssssssissssdsssss';
    $typesNoAvatar   = 'sssssssssssssissssdssss';

    if ($avatarPathSQL) {
        $stmt->bind_param($typesWithAvatar, 
            $id, $name, $signatory, $email, $phone, $address, $dept, $title,
            $type, $contractRef, $joinDate, $status,
            $nationality, $idCard, $numChildren, $dob, $marital,
            $lineManager, $salary, $payMethod, $bank, $cnps, 
            $authority, $avatarPathSQL
        );
    } else {
        $stmt->bind_param($typesNoAvatar, 
            $id, $name, $signatory, $email, $phone, $address, $dept, $title,
            $type, $contractRef, $joinDate, $status,
            $nationality, $idCard, $numChildren, $dob, $marital,
            $lineManager, $salary, $payMethod, $bank, $cnps, 
            $authority
        );
    }
    
    if (!$stmt->execute()) {
        throw new Exception("Save Execution Failed: " . $stmt->error);
    }

    // --- 7. USER AUTH ---
    if ($loginUser !== '') {
        $check = $conn->prepare("SELECT user_id FROM user_auth WHERE employee_id = ?");
        $check->bind_param('s', $id);
        $check->execute();
        $exists = $check->get_result()->fetch_assoc();
        
        $role = in_array($dept, ['ADMIN','FINANCE','SALES','OPERATIONS','MANAGEMENT']) ? $dept : 'ADMIN';

        if ($exists) {
            $uStmt = $conn->prepare("UPDATE user_auth SET username=?, role=?, authority_capabilities=? WHERE employee_id=?");
            $uStmt->bind_param('ssss', $loginUser, $role, $authority, $id);
            $uStmt->execute();
        } elseif ($createLogin) {
            $uStmt = $conn->prepare("INSERT INTO user_auth (employee_id, username, role, authority_capabilities, password_hash, must_set_password, is_active) VALUES (?, ?, ?, ?, '', 1, 0)");
            $uStmt->bind_param('ssss', $id, $loginUser, $role, $authority);
            $uStmt->execute();
        }
    }

    // --- 8. DOCS ---
    $docTypes = ['CV' => 'doc_CV', 'CONTRACT' => 'doc_CONTRACT', 'ID_CARD' => 'doc_ID_CARD', 'OTHER' => 'doc_OTHER'];
    $docStmt = $conn->prepare("INSERT INTO employee_documents (employee_id, doc_type, file_path, original_name) VALUES (?, ?, ?, ?)");
    if ($docStmt) {
        foreach ($docTypes as $dbType => $inputName) {
            if (isset($_FILES[$inputName]) && $_FILES[$inputName]['error'] === UPLOAD_ERR_OK) {
                $f = $_FILES[$inputName];
                $ext = pathinfo($f['name'], PATHINFO_EXTENSION);
                $safeName = $id . '_' . $dbType . '_' . time() . '.' . $ext;
                
                if (move_uploaded_file($f['tmp_name'], $docDir . $safeName)) {
                    $dbPath = 'administration/uploads/employee/documents/' . $safeName;
                    $docStmt->bind_param('ssss', $id, $dbType, $dbPath, $f['name']);
                    $docStmt->execute();
                }
            }
        }
    }

    $conn->commit();
    echo json_encode(['ok' => true, 'employee_id' => $id]);

} catch (Throwable $e) {
    // CATCH ANY ERROR AND RETURN IT AS JSON
    if (isset($conn) && $conn->in_transaction) $conn->rollback();
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Server Error: ' . $e->getMessage()]);
}