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

$conn = db();
$conn->set_charset('utf8mb4');

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['ok' => false, 'error' => 'Method not allowed']);
    }

    $client_id = trim((string)($_GET['client_id'] ?? ''));

    if ($client_id === '') {
        respond(422, ['ok' => false, 'error' => 'Client ID required']);
    }

    $sql = "SELECT id, document_type, storage_mode, file_path, archive_ref, uploaded_at 
            FROM client_documents
            WHERE client_id = ? 
            ORDER BY uploaded_at DESC";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $client_id);
    $stmt->execute();
    $res = $stmt->get_result();

    $docs = [];
    while ($row = $res->fetch_assoc()) {
        
        // --- PATH FIX LOGIC ---
        $rawPath = (string)$row['file_path'];
        // Remove /public_html if present
        $clean = str_replace(['/public_html', 'public_html/'], '', $rawPath);
        
        // Normalize to /administration/ prefix
        if (strpos($clean, '/administration/') === 0) {
            $webPath = $clean;
        } elseif (strpos($clean, '/') === 0) {
             $webPath = "/administration" . $clean;
        } else {
             $webPath = "/administration/" . $clean;
        }
        $webPath = str_replace('//', '/', $webPath);

        $docs[] = [
            'id'            => $row['id'],
            'document_type' => $row['document_type'],
            'storage_mode'  => $row['storage_mode'],
            'file_path'     => $webPath, // Use the fixed web path
            'archive_ref'   => $row['archive_ref'],
            'uploaded_at'   => $row['uploaded_at']
        ];
    }
    $stmt->close();

    respond(200, [
        'ok' => true,
        'client_id' => $client_id,
        'documents' => $docs
    ]);

} catch (Throwable $e) {
    respond(500, ['ok' => false, 'error' => $e->getMessage()]);
}
?>