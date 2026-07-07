<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT', 'OPERATIONS']);

header('Content-Type: application/json; charset=utf-8');

// Disable error printing to output
ini_set('display_errors', '0');
error_reporting(E_ALL);

function out(bool $ok, array $extra = [], int $code = 200): void {
    http_response_code($code);
    echo json_encode(array_merge(['ok' => $ok], $extra));
    exit;
}

$conn = db();
$conn->set_charset('utf8mb4');

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) out(false, ['error' => 'Session invalid'], 401);

$supplierId = trim((string)($_GET['supplier_id'] ?? ''));
if ($supplierId === '') out(false, ['error' => 'Missing supplier_id'], 422);

try {
    // 1. Fetch Supplier Profile
    $sql = "SELECT * FROM supplier_master WHERE supplier_id = ? LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $supplierId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row) out(false, ['error' => 'Supplier not found'], 404);

    // 2. Fetch Associated Documents
    // We select from 'supplier_documents' (the singular/correct table)
    $docs = [];
    $sqlDocs = "SELECT id, document_type, storage_mode, file_path, physical_ref, original_name, uploaded_at 
                FROM supplier_documents 
                WHERE supplier_id = ? 
                ORDER BY uploaded_at DESC";
    
    $stmt = $conn->prepare($sqlDocs);
    $stmt->bind_param('s', $supplierId);
    $stmt->execute();
    $resDocs = $stmt->get_result();
    
    while ($d = $resDocs->fetch_assoc()) {
        $docs[] = [
            'id'            => (int)$d['id'],
            'document_type' => (string)$d['document_type'],
            'storage_mode'  => (string)$d['storage_mode'],
            // Fix path for frontend (../..)
            'path'          => $d['file_path'] ? '../../' . $d['file_path'] : null,
            'physical_ref'  => (string)$d['physical_ref'],
            'original_name' => (string)$d['original_name'],
            'date'          => (string)$d['uploaded_at']
        ];
    }
    $stmt->close();

    // Attach documents to the response object
    $row['documents'] = $docs;

    out(true, ['supplier' => $row]);

} catch (Exception $e) {
    out(false, ['error' => 'Server error', 'detail' => $e->getMessage()], 500);
}