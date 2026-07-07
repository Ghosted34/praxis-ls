<?php
// FILE: api/approve_action.php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','FINANCE','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) respond(400, ['success' => false, 'message' => 'invalid payload']);

$id = $body['id'] ?? null;
$source = $body['source'] ?? null;
$action = $body['action'] ?? null;
$performed_by = isset($body['performed_by_user_id']) ? (int)$body['performed_by_user_id'] : null;

if (!$id || !$source || !$action) respond(400, ['success' => false, 'message' => 'missing parameters']);

$conn = db();
$conn->set_charset('utf8mb4');
$now = date('Y-m-d H:i:s');

try {
    if ($source === 'invoice_master') {
        if ($action === 'approve') {
            $sql = "UPDATE invoice_master SET approval_status = 'APPROVED', approved_by_user_id = ?, approved_at = ? WHERE invoice_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('isi', $performed_by, $now, $id);
            if (!$stmt->execute()) throw new RuntimeException($stmt->error);
            $stmt->close();
        } else {
            $sql = "UPDATE invoice_master SET approval_status = 'REJECTED', approved_by_user_id = ?, approved_at = ? WHERE invoice_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('isi', $performed_by, $now, $id);
            if (!$stmt->execute()) throw new RuntimeException($stmt->error);
            $stmt->close();
        }
        respond(200, ['success' => true]);
    }

    if ($source === 'proforma_invoice') {
        if ($action === 'approve') {
            $sql = "UPDATE proforma_invoice SET approval_status = 'APPROVED', approved_by_user_id = ?, approved_at = ? WHERE invoice_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('isi', $performed_by, $now, $id);
            if (!$stmt->execute()) throw new RuntimeException($stmt->error);
            $stmt->close();
        } else {
            $sql = "UPDATE proforma_invoice SET approval_status = 'REJECTED', approved_by_user_id = ?, approved_at = ? WHERE invoice_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('isi', $performed_by, $now, $id);
            if (!$stmt->execute()) throw new RuntimeException($stmt->error);
            $stmt->close();
        }
        respond(200, ['success' => true]);
    }

    if ($source === 'marginpricing_simulations') {
        if ($action === 'approve') {
            $sql = "UPDATE marginpricing_simulations SET status = 'APPROVED', approved_by_user_id = ?, approved_at = ? WHERE id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('isi', $performed_by, $now, $id);
            if (!$stmt->execute()) throw new RuntimeException($stmt->error);
            $stmt->close();
        } else {
            $sql = "UPDATE marginpricing_simulations SET status = 'REJECTED', rejected_by_user_id = ?, rejected_at = ?, rejection_reason = ? WHERE id = ?";
            $reason = 'Rejected via dashboard';
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('issi', $performed_by, $now, $reason, $id);
            if (!$stmt->execute()) throw new RuntimeException($stmt->error);
            $stmt->close();
        }
        respond(200, ['success' => true]);
    }

    respond(400, ['success' => false, 'message' => 'unknown source']);
} catch (Throwable $e) {
    respond(500, ['success' => false, 'message' => 'server error', 'details' => $e->getMessage()]);
}
