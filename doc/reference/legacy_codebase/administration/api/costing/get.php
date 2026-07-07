<?php
// ../../api/costing/get.php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Remove the dependency that might be missing
// require_once __DIR__ . '/_util.php'; 

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']);

// --- Helper Functions defined locally to prevent crashes ---
function json_out_local(array $data, int $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function norm_str_local($val) {
    return $val !== null ? trim((string)$val) : null;
}
// ---------------------------------------------------------

$conn = db();
$id = norm_str_local($_GET['id'] ?? null);
$ref = norm_str_local($_GET['ref'] ?? null);

if (!$id && !$ref) json_out_local(['ok' => false, 'error' => 'Provide id or ref'], 422);

// SAFE QUERY: We select everything from costing_master first
// Then we try to fetch names. If column names are different, this won't crash the main load.
try {
    // 1. Fetch Main Item
    $sql = "SELECT * FROM costing_master WHERE ";
    if ($id) {
        $sql .= "costing_id = ? LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('s', $id);
    } else {
        $sql .= "costing_ref = ? LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('s', $ref);
    }
    
    if (!$stmt->execute()) {
        throw new Exception($stmt->error);
    }
    
    $cm = $stmt->get_result()->fetch_assoc();
    if (!$cm) json_out_local(['ok' => false, 'error' => 'Costing not found'], 404);

    // 2. Fetch Names
    $names = [
        'created_by_name' => 'System',
        'validated_by_name' => '',
        'approved_by_name' => ''
    ];

    // Helper to fetch a name by direct EMPLOYEE_ID (used for Validator)
    function getName($c, $empId) {
        if (!$empId) return '';
        $q = "SELECT full_name FROM employee_master WHERE employee_id = ? LIMIT 1";
        $s = $c->prepare($q);
        $s->bind_param('s', $empId);
        $s->execute();
        $res = $s->get_result()->fetch_assoc();
        return $res ? $res['full_name'] : '';
    }

    // --- FIX: Resolve CREATOR (Issuer) --- 
    // Uses created_by_user_id -> user_auth -> employee_master
    if (!empty($cm['created_by_user_id'])) {
        $qCr = "SELECT em.full_name 
                FROM user_auth ua 
                JOIN employee_master em ON ua.employee_id = em.employee_id 
                WHERE ua.user_id = ? LIMIT 1";
        $stmtCr = $conn->prepare($qCr);
        $stmtCr->bind_param('i', $cm['created_by_user_id']);
        $stmtCr->execute();
        $resCr = $stmtCr->get_result()->fetch_assoc();
        if ($resCr) {
            $names['created_by_name'] = $resCr['full_name'];
        }
    }

    // --- Resolve VALIDATOR ---
    // Uses validator_employee_id directly (as per table structure)
    if (!empty($cm['validator_employee_id'])) {
        $names['validated_by_name'] = getName($conn, $cm['validator_employee_id']);
    }

    // --- Resolve APPROVER ---
    // Uses approved_by_user_id -> user_auth -> employee_master
    if (!empty($cm['approved_by_user_id'])) {
        $qApp = "SELECT em.full_name 
                 FROM user_auth ua 
                 JOIN employee_master em ON ua.employee_id = em.employee_id 
                 WHERE ua.user_id = ? LIMIT 1";
        $stmtApp = $conn->prepare($qApp);
        $stmtApp->bind_param('i', $cm['approved_by_user_id']);
        $stmtApp->execute();
        $resApp = $stmtApp->get_result()->fetch_assoc();
        if ($resApp) {
            $names['approved_by_name'] = $resApp['full_name'];
        }
    }

    // Merge names into the main object
    $cm = array_merge($cm, $names);

    // 3. Fetch Lines
    $linesSql = "
      SELECT
        costing_line_id, line_no, item_code, item_description,
        qty, unit_cost, vat_applicable, vat_rate,
        total_ht, total_vat, total_ttc
      FROM costing_line
      WHERE costing_id = ?
      ORDER BY line_no ASC
    ";
    $stmt2 = $conn->prepare($linesSql);
    $stmt2->bind_param('s', $cm['costing_id']);
    $stmt2->execute();
    $lines = $stmt2->get_result()->fetch_all(MYSQLI_ASSOC);

    json_out_local(['ok' => true, 'item' => $cm, 'lines' => $lines]);

} catch (Exception $e) {
    json_out_local(['ok' => false, 'error' => $e->getMessage()], 500);
}
?>