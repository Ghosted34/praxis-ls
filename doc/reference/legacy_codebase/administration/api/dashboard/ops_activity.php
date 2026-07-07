<?php
/**
 * SMART LS ERP - OPERATIONS ACTIVITY FEED
 * -------------------------------------------------------------------------
 * Aggregates:
 * 1. New Operations Files Created (operations_file_master)
 * 2. Transit Orders Generated (transit_orders)
 * 3. Delivery Notes Issued (delivery_notes)
 * -------------------------------------------------------------------------
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['OPERATIONS', 'ADMIN', 'MANAGEMENT']);

header('Content-Type: application/json');
// --- CACHE BUSTING HEADERS ---
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");

try {
    $conn = db();
    
    // We use UNION ALL to combine 3 distinct tables.
    // We fetch the top 15 most recent events regardless of date.

    $sql = "
    (
        SELECT 
            'FILE_CREATED' as type,
            operations_file_reference as ref,
            COALESCE(client_name, service_type) as description,
            created_at as event_time
        FROM operations_file_master
        ORDER BY created_at DESC LIMIT 5
    )
    UNION ALL
    (
        SELECT 
            'OT_GENERATED' as type,
            ot_number_full as ref,
            operation_file_ref as description,
            created_at as event_time
        FROM transit_orders
        ORDER BY created_at DESC LIMIT 5
    )
    UNION ALL
    (
        SELECT 
            'DN_ISSUED' as type,
            dn_number_full as ref,
            file_ref as description,
            created_at as event_time
        FROM delivery_notes
        ORDER BY created_at DESC LIMIT 5
    )
    ORDER BY event_time DESC
    LIMIT 15
    ";

    $result = $conn->query($sql);
    $activities = [];

    if ($result) {
        while ($row = $result->fetch_assoc()) {
            // Calculate 'Time Ago' (e.g. "2 hours ago")
            $ts = strtotime($row['event_time']);
            $timeAgo = humanTiming($ts);

            $activities[] = [
                'type'        => $row['type'],
                'ref'         => $row['ref'],
                'description' => $row['description'],
                'time'        => $timeAgo, 
                'raw_time'    => $row['event_time']
            ];
        }
    }

    echo json_encode(['success' => true, 'data' => $activities]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}

// --- Helper: Human Readable Time (e.g., "10 mins ago") ---
function humanTiming($time) {
    $time = time() - $time; // to get the time since that moment
    $time = ($time < 1) ? 1 : $time;
    $tokens = array (
        31536000 => 'year',
        2592000  => 'month',
        604800   => 'week',
        86400    => 'day',
        3600     => 'hour',
        60       => 'min',
        1        => 'sec'
    );

    foreach ($tokens as $unit => $text) {
        if ($time < $unit) continue;
        $numberOfUnits = floor($time / $unit);
        return $numberOfUnits.' '.$text.(($numberOfUnits>1)?'s':'').' ago';
    }
    return 'Just now';
}
?>