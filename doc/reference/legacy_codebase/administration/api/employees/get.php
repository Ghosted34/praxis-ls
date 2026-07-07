<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function json_out(array $p, int $code = 200): void {
    http_response_code($code);
    echo json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$employeeId = trim((string)($_GET['employee_id'] ?? ''));
if ($employeeId === '') {
    json_out(['ok' => false, 'message' => 'employee_id is required'], 400);
}

try {
    // UPDATED QUERY: Directly select line_manager_name
    $sql = "
      SELECT 
        em.employee_id, em.full_name, em.signatory_name, em.email, 
        em.phone, em.address,
        em.department, em.job_title, em.employment_type, em.contract_reference,
        em.join_date, em.status, em.system_authority,
        em.nationality, em.id_card_number, em.num_children, em.avatar_path,
        em.dob, em.marital_status, em.base_salary, em.payment_method, 
        em.bank_details, em.cnps_number, 
        em.line_manager_name,  -- NEW COLUMN
        ua.username
      FROM employee_master em
      LEFT JOIN user_auth ua ON ua.employee_id = em.employee_id
      WHERE em.employee_id = ?
      LIMIT 1
    ";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $employeeId);
    $stmt->execute();
    $res = $stmt->get_result();

    if ($res->num_rows < 1) {
        json_out(['ok' => false, 'message' => 'Employee not found'], 404);
    }

    $r = $res->fetch_assoc();

    // Authority Set
    $authority = [];
    if (!empty($r['system_authority'])) {
        $authority = array_map('trim', explode(',', (string)$r['system_authority']));
    }

    // Avatar Path
    $avatarUrl = $r['avatar_path'] 
        ? '../../' . $r['avatar_path'] 
        : "https://ui-avatars.com/api/?name=" . urlencode($r['full_name']) . "&background=231F20&color=fff";

    // DOCUMENTS
    $docs = [];
    $sqlDocs = "SELECT id, doc_type, file_path, original_name, uploaded_at FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC";
    $stmt2 = $conn->prepare($sqlDocs);
    $stmt2->bind_param('s', $employeeId);
    $stmt2->execute();
    $resDocs = $stmt2->get_result();
    
    while ($d = $resDocs->fetch_assoc()) {
        $docs[] = [
            'id' => $d['id'],
            'type' => $d['doc_type'],
            'path' => '../../' . $d['file_path'], 
            'name' => $d['original_name'],
            'date' => $d['uploaded_at']
        ];
    }

    // OUTPUT
    json_out([
        'ok' => true,
        'employee' => [
            'id' => (string)$r['employee_id'],
            'name' => (string)$r['full_name'],
            'signatory' => (string)$r['signatory_name'],
            'email' => (string)$r['email'],
            'phone' => (string)$r['phone'],
            'address' => (string)$r['address'],

            'dept' => (string)$r['department'],
            'title' => (string)$r['job_title'],
            'type' => (string)$r['employment_type'],
            'contractRef' => (string)$r['contract_reference'],
            'joinDate' => (string)$r['join_date'],
            'status' => (string)$r['status'],

            'nationality' => (string)$r['nationality'],
            'idCard' => (string)$r['id_card_number'],
            'numChildren' => (int)$r['num_children'],
            'avatar' => $avatarUrl,

            'dob' => $r['dob'] ? (string)$r['dob'] : null,
            'marital' => $r['marital_status'] ? (string)$r['marital_status'] : 'SINGLE',

            // UPDATED: Output the name directly
            'managerName' => (string)($r['line_manager_name'] ?? ''), 

            'salary' => (float)$r['base_salary'],
            'payMethod' => $r['payment_method'] ? (string)$r['payment_method'] : 'BANK_TRANSFER',
            'bank' => (string)$r['bank_details'],
            'cnps' => (string)$r['cnps_number'],

            'username' => (string)$r['username'],
            'authority' => $authority,
            
            'documents' => $docs
        ]
    ]);

} catch (Throwable $e) {
    json_out(['ok' => false, 'message' => 'Get failed', 'detail' => $e->getMessage()], 500);
}