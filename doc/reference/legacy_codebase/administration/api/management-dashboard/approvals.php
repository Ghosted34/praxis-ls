<?php
// FILE: api/approvals.php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','FINANCE','SALES','OPERATIONS','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$conn->set_charset('utf8mb4');

try {
    $rows = [];

    // Proforma invoices pending approval
    $sql = "SELECT invoice_id, invoice_no, operations_file_reference, client_id, issue_date, total_xaf
            FROM proforma_invoice
            WHERE approval_status = 'PENDING'
            ORDER BY created_at DESC
            LIMIT 50";
    $res = $conn->query($sql);
    if ($res === false) throw new RuntimeException($conn->error);
    while ($r = $res->fetch_assoc()) {
        $rows[] = [
            'id' => $r['invoice_id'],
            'source' => 'proforma_invoice',
            'type' => 'Proforma',
            'badge_class' => 'bg-warning text-dark',
            'title' => ($r['invoice_no'] ?? 'PROFORMA'),
            'subtitle' => 'Client: ' . ($r['client_id'] ?? '-') . ' · Ops: ' . ($r['operations_file_reference'] ?? '-'),
            'value' => (float)($r['total_xaf'] ?? 0),
            'value_text' => $r['total_xaf'] ? number_format((float)$r['total_xaf']) : 'N/A',
            'display_date' => formatDateTime($r['issue_date'])
        ];
    }
    $res->free();

    // Margin simulations pending (SUBMITTED, VALIDATED)
    $sql = "SELECT id, simulation_ref, operations_file_reference, client_id, created_at, margin_amount, margin_percent, status
            FROM marginpricing_simulations
            WHERE status IN ('SUBMITTED','VALIDATED')
            ORDER BY created_at DESC
            LIMIT 50";
    $res = $conn->query($sql);
    if ($res === false) throw new RuntimeException($conn->error);
    while ($r = $res->fetch_assoc()) {
        $rows[] = [
            'id' => $r['id'],
            'source' => 'marginpricing_simulations',
            'type' => 'Quote Margin',
            'badge_class' => 'bg-primary text-white',
            'title' => ($r['simulation_ref'] ?: 'SIM') . ' · Client: ' . ($r['client_id'] ?? '-'),
            'subtitle' => 'Margin: ' . number_format((float)$r['margin_percent'],2) . '% · Ops: ' . ($r['operations_file_reference'] ?? '-'),
            'value' => (float)($r['margin_amount'] ?? 0),
            'value_text' => $r['margin_amount'] ? number_format((float)$r['margin_amount']) : 'N/A',
            'display_date' => formatDateTime($r['created_at'])
        ];
    }
    $res->free();

    // Invoices pending approval
    $sql = "SELECT invoice_id, invoice_no, operations_file_reference, client_id, issue_date, total_xaf
            FROM invoice_master
            WHERE approval_status = 'PENDING'
            ORDER BY created_at DESC
            LIMIT 50";
    $res = $conn->query($sql);
    if ($res === false) throw new RuntimeException($conn->error);
    while ($r = $res->fetch_assoc()) {
        $rows[] = [
            'id' => $r['invoice_id'],
            'source' => 'invoice_master',
            'type' => 'Invoice',
            'badge_class' => 'bg-dark text-white',
            'title' => ($r['invoice_no'] ?? 'INV') . ' · Client: ' . ($r['client_id'] ?? '-'),
            'subtitle' => 'Ops: ' . ($r['operations_file_reference'] ?? '-'),
            'value' => (float)($r['total_xaf'] ?? 0),
            'value_text' => $r['total_xaf'] ? number_format((float)$r['total_xaf']) : 'N/A',
            'display_date' => formatDateTime($r['issue_date'])
        ];
    }
    $res->free();

    usort($rows, function($a,$b){ return strcmp((string)$b['display_date'], (string)$a['display_date']); });

    echo json_encode(['count' => count($rows), 'rows' => $rows]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Query failed', 'details' => $e->getMessage()]);
}

function formatDateTime($dt) {
    if (!$dt) return '';
    $t = strtotime($dt);
    if (!$t) return $dt;
    if (date('Y-m-d',$t) === date('Y-m-d')) return date('H:i A',$t);
    return date('M d',$t);
}
