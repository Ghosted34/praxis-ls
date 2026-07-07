<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','FINANCE','SALES','OPERATIONS','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function qstr(string $k, string $default=''): string {
    return trim((string)($_GET[$k] ?? $default));
}
function qint(string $k, int $default=0): int {
    return (int)($_GET[$k] ?? $default);
}

$conn = db();
$conn->set_charset('utf8mb4');

try {
    $role = strtoupper((string)($_SESSION['auth']['role'] ?? ''));
    $canSeeFinance = in_array($role, ['ADMIN','FINANCE','MANAGEMENT'], true);

    // --- FILTERS ---
    $type   = strtoupper(qstr('type', 'ALL'));      
    $status = strtoupper(qstr('status', 'ALL'));    
    $q      = qstr('q', '');                        
    $page   = max(1, qint('page', 1));
    $limit  = qint('limit', 50);
    
    if ($limit < 10) $limit = 10;
    if ($limit > 200) $limit = 200;
    $offset = ($page - 1) * $limit;

    $where = " WHERE 1=1 ";
    $types = "";
    $params = [];

    if ($type !== 'ALL') {
        $where .= " AND cm.client_type = ? ";
        $types .= "s";
        $params[] = $type;
    }

    if ($status !== 'ALL') {
        $where .= " AND cm.status = ? ";
        $types .= "s";
        $params[] = $status;
    }

    if ($q !== '') {
        $where .= " AND (
          cm.client_id LIKE CONCAT('%', ?, '%') OR
          cm.client_name LIKE CONCAT('%', ?, '%') OR
          cm.niu LIKE CONCAT('%', ?, '%') OR
          cm.contact_email LIKE CONCAT('%', ?, '%') OR
          cm.contact_person LIKE CONCAT('%', ?, '%')
        ) ";
        $types .= "sssss";
        array_push($params, $q, $q, $q, $q, $q);
    }

    // --- 1. KPIs ---
    $sqlKpis = "
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN cm.status='ACTIVE' THEN 1 ELSE 0 END) AS active,
        SUM(COALESCE(cm.cached_receivables, 0.00)) AS receivables,
        SUM(COALESCE(cm.cached_overdue, 0.00)) AS overdue
      FROM client_master cm
      $where
    ";

    $stmtK = $conn->prepare($sqlKpis);
    if ($types !== '') $stmtK->bind_param($types, ...$params);
    $stmtK->execute();
    $k = $stmtK->get_result()->fetch_assoc() ?: [];
    $stmtK->close();

    $kpis = [
        'total'       => (int)($k['total'] ?? 0),
        'active'      => (int)($k['active'] ?? 0),
        'receivables' => (float)($k['receivables'] ?? 0),
        'overdue'     => (float)($k['overdue'] ?? 0),
    ];

    // --- 2. Count ---
    $sqlCount = "SELECT COUNT(*) AS cnt FROM client_master cm $where";
    $stmt = $conn->prepare($sqlCount);
    if ($types !== '') $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $totalRows = (int)($stmt->get_result()->fetch_assoc()['cnt'] ?? 0);
    $stmt->close();

    // --- 3. Rows (WITH DOCUMENT SUBQUERY) ---
    // PATCH: Added subquery to fetch the latest file path
    $sqlRows = "
      SELECT 
        cm.client_id, 
        cm.client_name, 
        cm.client_type, 
        cm.contact_person, 
        cm.contact_email, 
        cm.contact_phone, 
        cm.niu, 
        cm.rccm, 
        cm.address, 
        cm.country, 
        cm.payment_terms_days, 
        cm.credit_limit, 
        COALESCE(cm.cached_receivables, 0.00) AS cached_receivables,
        COALESCE(cm.cached_overdue, 0.00) AS cached_overdue,
        cm.status, 
        cm.created_at, 
        cm.updated_at,
        (SELECT file_path FROM client_documents cd WHERE cd.client_id = cm.client_id ORDER BY cd.uploaded_at DESC LIMIT 1) as latest_doc_path
      FROM client_master cm
      $where
      ORDER BY cm.updated_at DESC, cm.created_at DESC
      LIMIT ? OFFSET ?
    ";

    $stmt = $conn->prepare($sqlRows);
    
    $typesRows = $types . "ii";
    $paramsRows = $params;
    $paramsRows[] = $limit;
    $paramsRows[] = $offset;

    $stmt->bind_param($typesRows, ...$paramsRows);
    $stmt->execute();
    $res = $stmt->get_result();

    $rows = [];
    while ($r = $res->fetch_assoc()) {
        
        // --- PATH FIX LOGIC ---
        $docPath = $r['latest_doc_path'];
        $docUrl = null;
        
        if ($docPath) {
            // Remove 'public_html' if it was saved in the path
            $clean = str_replace(['/public_html', 'public_html/'], '', $docPath);
            
            // Ensure it starts with /administration/
            if (strpos($clean, '/administration/') === 0) {
                $docUrl = $clean;
            } elseif (strpos($clean, '/') === 0) {
                 $docUrl = "/administration" . $clean;
            } else {
                 $docUrl = "/administration/" . $clean;
            }
            // Fix double slashes if any happened
            $docUrl = str_replace('//', '/', $docUrl);
        }

        $rows[] = [
            'id'          => (string)$r['client_id'],
            'name'        => (string)$r['client_name'],
            'type'        => (string)$r['client_type'],
            'niu'         => (string)$r['niu'],
            'rccm'        => (string)$r['rccm'],
            'address'     => (string)$r['address'],
            'country'     => (string)$r['country'],
            'contact'     => (string)$r['contact_person'],
            'phone'       => (string)$r['contact_phone'],
            'email'       => (string)$r['contact_email'],
            'terms'       => (int)$r['payment_terms_days'],
            'credit_limit'=> $r['credit_limit'],
            'receivables' => $canSeeFinance ? (float)$r['cached_receivables'] : null,
            'overdue'     => $canSeeFinance ? (float)$r['cached_overdue'] : null,
            'status'      => (string)$r['status'],
            'updated_at'  => (string)$r['updated_at'],
            // New field for frontend
            'document_url' => $docUrl 
        ];
    }
    $stmt->close();

    respond(200, [
        'ok' => true,
        'kpis' => $kpis,
        'rows' => $rows,
        'page' => $page,
        'limit' => $limit,
        'total_rows' => $totalRows,
        'total_pages' => (int)ceil($totalRows / max(1, $limit)),
        'can_see_finance' => $canSeeFinance
    ]);

} catch (Throwable $e) {
    respond(500, ['ok' => false, 'error' => $e->getMessage()]);
}
?>