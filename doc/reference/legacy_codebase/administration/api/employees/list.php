<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

// --- FILTERS ---
$q         = trim((string)($_GET['q'] ?? ''));
$dept      = trim((string)($_GET['dept'] ?? ''));
$status    = trim((string)($_GET['status'] ?? ''));
$type      = trim((string)($_GET['type'] ?? ''));
$dateStart = trim((string)($_GET['start'] ?? ''));
$dateEnd   = trim((string)($_GET['end'] ?? ''));

try {
    // UPDATED QUERY: Added ua.user_id to the SELECT list
    $sql = "
    SELECT 
      em.employee_id, em.full_name, em.signatory_name, em.email, 
      em.phone, em.address,
      em.department, em.job_title, em.employment_type, em.contract_reference,
      em.join_date, em.status, em.nationality, em.id_card_number, em.num_children,
      em.dob, em.marital_status, em.avatar_path, em.base_salary, em.payment_method, 
      em.bank_details, em.cnps_number, 
      em.line_manager_name, 
      ua.user_id, ua.username, ua.role, ua.authority_capabilities  -- ADDED ua.user_id HERE
    FROM employee_master em
    LEFT JOIN user_auth ua ON ua.employee_id = em.employee_id
    WHERE 1=1
    ";

    $types = "";
    $params = [];

    // --- APPLY FILTERS ---
    if ($dept !== '') {
        $sql .= " AND em.department = ? ";
        $types .= "s";
        $params[] = $dept;
    }

    if ($status !== '') {
        $sql .= " AND em.status = ? ";
        $types .= "s";
        $params[] = $status;
    }

    if ($type !== '') {
        $sql .= " AND em.employment_type = ? ";
        $types .= "s";
        $params[] = $type;
    }

    if ($dateStart !== '' && $dateEnd !== '') {
        $sql .= " AND em.join_date BETWEEN ? AND ? ";
        $types .= "ss";
        $params[] = $dateStart;
        $params[] = $dateEnd;
    }

    if ($q !== '') {
        $sql .= " AND (em.full_name LIKE ? OR em.employee_id LIKE ? OR em.email LIKE ?) ";
        $types .= "sss";
        $like = "%{$q}%";
        $params[] = $like;
        $params[] = $like;
        $params[] = $like;
    }

    $sql .= " ORDER BY em.status ASC, em.join_date DESC ";

    $stmt = $conn->prepare($sql);
    if ($types !== "") $stmt->bind_param($types, ...$params);
    $stmt->execute();

    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

    // --- KPI CALCULATION ---
    $total = count($rows);
    $permanentCount = 0;
    $contractCount = 0;
    $payrollExposure = 0.0;

    foreach ($rows as $r) {
        $eType = strtoupper($r['employment_type'] ?? '');
        $stat  = strtoupper($r['status'] ?? '');

        if ($eType === 'PERMANENT' || $eType === 'FULL_TIME') {
            $permanentCount++;
        } else {
            $contractCount++;
        }

        if ($stat !== 'EXITED' && $stat !== 'SUSPENDED') {
            $payrollExposure += (float)($r['base_salary'] ?? 0);
        }
    }

    // --- OUTPUT MAPPING ---
    $out = array_map(function($r){
        $avatar = $r['avatar_path'] 
            ? '../../' . $r['avatar_path'] 
            : "https://ui-avatars.com/api/?name=" . urlencode($r['full_name']) . "&background=231F20&color=fff";

        return [
            'id' => (string)$r['employee_id'],
            'name' => (string)($r['full_name'] ?? ''),
            'signatory' => (string)($r['signatory_name'] ?? ''),
            'email' => (string)($r['email'] ?? ''),
            'phone' => (string)($r['phone'] ?? ''),
            'address' => (string)($r['address'] ?? ''),
            
            'dept' => (string)($r['department'] ?? ''),
            'title' => (string)($r['job_title'] ?? ''),
            'type' => (string)($r['employment_type'] ?? ''),
            'contractRef' => (string)($r['contract_reference'] ?? ''),
            'joinDate' => (string)($r['join_date'] ?? ''),
            'status' => (string)($r['status'] ?? ''),
            
            'nationality' => (string)($r['nationality'] ?? ''),
            'idCard' => (string)($r['id_card_number'] ?? ''),
            'numChildren' => (int)($r['num_children'] ?? 0),
            'dob' => $r['dob'] ? (string)$r['dob'] : '',
            'marital' => (string)($r['marital_status'] ?? 'SINGLE'),
            'avatar' => $avatar,
            
            'managerName' => (string)($r['line_manager_name'] ?? ''), 
            
            'salary' => (float)($r['base_salary'] ?? 0),
            'payMethod' => (string)($r['payment_method'] ?? 'BANK_TRANSFER'),
            'bank' => (string)($r['bank_details'] ?? ''),
            'cnps' => (string)($r['cnps_number'] ?? ''),

            'user' => [
                'user_id' => $r['user_id'] ? (int)$r['user_id'] : null, // ADDED THIS LINE
                'username' => (string)($r['username'] ?? ''),
                'role' => (string)($r['role'] ?? ''),
                'authority' => (string)($r['authority_capabilities'] ?? ''),
            ]
        ];
    }, $rows);

    echo json_encode([
        'ok' => true,
        'kpis' => [
            'total' => $total,
            'permanent' => $permanentCount,
            'contract' => $contractCount,
            'payrollExposure' => $payrollExposure,
        ],
        'rows' => $out
    ], JSON_UNESCAPED_SLASHES);

} catch (mysqli_sql_exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Server error', 'detail' => $e->getMessage()]);
}