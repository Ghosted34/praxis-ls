<?php
/**
 * SMART LS CHAT API CONTROLLER
 * -------------------------------------------------------------------------
 * @author      JBS Praxis / Development Team
 * @version     3.5 (Float-to-Top Architecture)
 * @description Central logic for the Communication Hub.
 * Handles Real-time messaging, Unread counters,
 * Dynamic sorting (Tom & Jerry Logic), and Critical Acks.
 * -------------------------------------------------------------------------
 * * ARCHITECTURE NOTES:
 * 1. Float-to-Top: The 'list_users' endpoint now calculates unread counts
 * per user and sorts them to the top of the list.
 * 2. Security: Strict type checking and role guarding enabled.
 * 3. Notification Prep: 'receiver_id' and 'email_notified' columns are 
 * managed here for the Cron Job and JS Heartbeat.
 * 4. Database Alignment: Uses 'sender_id' and 'receiver_id' explicitly.
 */

declare(strict_types=1);

// --- Initialization & Security ---
require_once __DIR__ . '/../includes/init.php';
require_once __DIR__ . '/../includes/role_guard.php';

// Force JSON response header immediately to prevent HTML leakage
header('Content-Type: application/json; charset=utf-8');

// Enable strict SQL reporting for debugging during development
$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

// -----------------------------------------------------------------------------
// 1. AUTHENTICATION CHECK
// -----------------------------------------------------------------------------
$sessionAuth = $_SESSION['auth'] ?? [];
$userId      = (int)($sessionAuth['user_id'] ?? 0);
$userRole    = strtoupper((string)($sessionAuth['role'] ?? 'GUEST'));
$username    = (string)($sessionAuth['username'] ?? '');

// Strict Gatekeeper: No ID, No Access.
if ($userId <= 0) {
    http_response_code(401);
    echo json_encode([
        'status' => 'error',
        'error'  => 'Authentication Required',
        'detail' => 'Session expired or invalid context.'
    ]);
    exit;
}

// -----------------------------------------------------------------------------
// 2. HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Standardized JSON Output Helper
 * Exits script execution after outputting.
 * * @param array $payload The data to send
 * @param int $code HTTP Status Code (default 200)
 */
function json_out(array $payload, int $code = 200): void {
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

/**
 * String Sanitizer for UPPERCASE inputs (Roles, Urgency)
 */
function safe_upper(string $s): string {
    return strtoupper(trim($s));
}

/**
 * Channel Access Control Logic
 * Determines if a specific user can view a channel based on JSON rules.
 * * @param int $userId Current User ID
 * @param string $userRole Current User Role
 * @param string|null $channelRolesJson JSON string from DB (e.g. ["SALES", "USER:5"])
 * @return bool
 */
function can_view_channel(int $userId, string $userRole, ?string $channelRolesJson): bool {
    // Admin Superpower: Can see everything for governance
    if ($userRole === 'ADMIN') return true; 

    $raw = trim((string)$channelRolesJson);
    if ($raw === '') return false; // No rules = No access

    $allowed = json_decode($raw, true);
    if (!is_array($allowed)) return false; // Invalid JSON = Block

    foreach ($allowed as $token) {
        $t = strtoupper((string)$token);
        
        // 1. Role-based access
        if ($t === 'ALL') return true;
        if ($t === $userRole) return true;

        // 2. Specific User ID access (Format "USER:123")
        if (str_starts_with($t, 'USER:')) {
            $parts = explode(':', $t, 2);
            $uid = (int)($parts[1] ?? 0);
            if ($uid > 0 && $uid === $userId) return true;
        }
    }
    return false;
}

/**
 * DM Partner Identification
 * In a DM channel ["USER:A", "USER:B"], finds the user that is NOT me.
 * Used to set the 'receiver_id' for notifications.
 */
function get_dm_receiver_id(int $myUserId, string $rolesJson): int {
    $roles = json_decode($rolesJson, true) ?? [];
    foreach ($roles as $r) {
        if (str_starts_with($r, 'USER:')) {
            $uid = (int)explode(':', $r)[1];
            if ($uid !== $myUserId) return $uid;
        }
    }
    return 0; // Should not happen in a valid DM
}

// -----------------------------------------------------------------------------
// 3. REQUEST ROUTER
// -----------------------------------------------------------------------------
$action = (string)($_GET['action'] ?? '');

try {
    switch ($action) {

        // =====================================================================
        // ACTION: HEARTBEAT (Global Notification Pulse)
        // Checks strictly for unread messages sent to this specific user.
        // Used by the Red Badge & Desktop Notifications.
        // =====================================================================
        case 'heartbeat': {
            // Count unread DMs specifically
            // Note: receiver_id logic ensures we only count DMs directed at us.
            // Channel messages (Group) usually have receiver_id = 0, tracked differently.
            $sql = "SELECT COUNT(*) as unread FROM chat_messages 
                    WHERE receiver_id = ? AND is_read = 0";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $userId);
            $stmt->execute();
            $res = $stmt->get_result()->fetch_assoc();
            
            // Return timestamp for cache-busting on frontend
            json_out([
                'status'    => 'success', 
                'unread'    => (int)($res['unread'] ?? 0),
                'timestamp' => time() 
            ]);
        }

        // =====================================================================
        // ACTION: LIST USERS (The "Tom & Jerry" Logic)
        // Returns users sorted by:
        // 1. Unread Messages (High Priority) -> Floating to top
        // 2. Last Activity Time (Recency)
        // 3. Alphabetical (Fallback)
        // =====================================================================
        case 'list_users': {
            // Complex Query Breakdown:
            // This query fetches all users (except me).
            // Subquery 1 (unread_count): Counts messages from that user, sent to ME, that are unread.
            // Subquery 2 (last_activity): Finds the most recent timestamp of ANY message between us.
            // Sorting: Unread > 0 comes first. Then most recent interactions.
            
            $sql = "
                SELECT 
                    ua.user_id, 
                    em.full_name, 
                    em.department,
                    (
                        SELECT COUNT(*) 
                        FROM chat_messages m 
                        WHERE m.sender_id = ua.user_id 
                          AND m.receiver_id = ? 
                          AND m.is_read = 0
                    ) as unread_count,
                    (
                        SELECT MAX(created_at) 
                        FROM chat_messages m 
                        WHERE (m.sender_id = ua.user_id AND m.receiver_id = ?) 
                           OR (m.sender_id = ? AND m.receiver_id = ua.user_id)
                    ) as last_activity
                FROM user_auth ua
                JOIN employee_master em ON em.employee_id = ua.employee_id
                WHERE ua.user_id != ? 
                ORDER BY 
                    unread_count DESC,   -- Priority 1: Unread messages float to top
                    last_activity DESC,  -- Priority 2: Recent conversations
                    em.full_name ASC     -- Priority 3: A-Z
            ";

            $stmt = $conn->prepare($sql);
            // Bind params: receiver=me, partner=me, me=partner, me (exclusion)
            $stmt->bind_param('iiii', $userId, $userId, $userId, $userId);
            $stmt->execute();
            $res = $stmt->get_result();

            $users = [];
            while ($r = $res->fetch_assoc()) {
                $users[] = [
                    'user_id'      => (int)$r['user_id'],
                    'full_name'    => (string)$r['full_name'],
                    'department'   => (string)$r['department'],
                    'unread_count' => (int)$r['unread_count'], // Used by JS for red badge on user
                    'last_active'  => $r['last_activity']
                ];
            }
            json_out(['status' => 'success', 'data' => $users]);
        }

        // =====================================================================
        // ACTION: SEARCH USERS (Autofill / Fallback)
        // Simple string matching for finding users not in the recent list.
        // =====================================================================
        case 'search_users': {
            $q = trim((string)($_GET['q'] ?? ''));
            
            // Optimization: Don't search for single characters
            if (strlen($q) < 2) {
                json_out(['status' => 'success', 'data' => []]);
            }

            $term = "%{$q}%";
            $sql = "
                SELECT ua.user_id, em.full_name, em.department 
                FROM user_auth ua
                JOIN employee_master em ON em.employee_id = ua.employee_id
                WHERE ua.user_id != ? 
                  AND (em.full_name LIKE ? OR em.department LIKE ?)
                LIMIT 15
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('iss', $userId, $term, $term);
            $stmt->execute();
            $res = $stmt->get_result();

            $users = [];
            while ($r = $res->fetch_assoc()) {
                $users[] = [
                    'user_id'    => (int)$r['user_id'],
                    'full_name'  => (string)$r['full_name'],
                    'department' => (string)$r['department']
                ];
            }
            json_out(['status' => 'success', 'data' => $users]);
        }

        // =====================================================================
        // ACTION: ACKNOWLEDGE CRITICAL
        // Marks a critical message as 'Read' and 'Acknowledged'.
        // Only works if not already acknowledged.
        // =====================================================================
        case 'acknowledge': {
            $msgId = (int)($_POST['message_id'] ?? 0);
            
            if ($msgId <= 0) {
                json_out(['status' => 'error', 'message' => 'Invalid ID'], 400);
            }

            // Acknowledge Logic:
            // Set timestamp AND mark as read.
            // Only allow if it hasn't been acknowledged yet to prevent overwrite.
            $sql = "UPDATE chat_messages 
                    SET acknowledged_at = NOW(), is_read = 1 
                    WHERE id = ? AND acknowledged_at IS NULL";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $msgId);
            $stmt->execute();

            if ($stmt->affected_rows > 0) {
                json_out(['status' => 'success']);
            } else {
                // If 0 rows, it might already be acknowledged or doesn't exist
                json_out(['status' => 'error', 'message' => 'Already acknowledged or ID not found']);
            }
        }

        // =====================================================================
        // ACTION: LIST CHANNELS (Public Rooms)
        // Standard listing of accessible channels (Sales, Ops, etc.)
        // =====================================================================
        case 'list_channels': {
            $sql = "SELECT id, name, type, allowed_roles FROM chat_channels
                    WHERE type IN ('PUBLIC','PRIVATE')
                    ORDER BY id ASC";
            $res = $conn->query($sql);

            $myChannels = [];
            while ($row = $res->fetch_assoc()) {
                // Check permissions helper
                if (can_view_channel($userId, $userRole, $row['allowed_roles'] ?? null)) {
                    $myChannels[] = [
                        'id'   => (int)$row['id'],
                        'name' => (string)$row['name'],
                        'type' => (string)$row['type'],
                    ];
                }
            }
            json_out(['status' => 'success', 'data' => $myChannels]);
        }

        // =====================================================================
        // ACTION: OPEN DM (Find or Create Channel)
        // Ensures a channel exists between two users before chatting starts.
        // =====================================================================
        case 'open_dm': {
            $targetId = (int)($_GET['target_user_id'] ?? 0);
            
            if ($targetId <= 0 || $targetId === $userId) {
                json_out(['status' => 'error', 'error' => 'Invalid DM Target'], 400);
            }

            // Normalize the DM name (SmallerID:LargerID) to avoid duplicates.
            // DM:1:5 is the same as DM:5:1
            $a = min($userId, $targetId);
            $b = max($userId, $targetId);
            $dmName = "DM:$a:$b";

            // 1. Try to find existing channel
            $stmt = $conn->prepare("SELECT id, allowed_roles FROM chat_channels WHERE name = ? AND type = 'DM' LIMIT 1");
            $stmt->bind_param('s', $dmName);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            if ($row) {
                // Verify access (Double check security)
                if (!can_view_channel($userId, $userRole, $row['allowed_roles'] ?? null)) {
                    json_out(['status' => 'error', 'error' => 'Access denied to existing DM'], 403);
                }
                json_out(['status' => 'success', 'data' => ['channel_id' => (int)$row['id'], 'name' => $dmName]]);
            }

            // 2. Create new channel if not exists
            $allowed = json_encode(["USER:$a", "USER:$b"], JSON_UNESCAPED_SLASHES);
            $type = 'DM';
            
            $stmt = $conn->prepare("INSERT INTO chat_channels (name, type, allowed_roles) VALUES (?, ?, ?)");
            $stmt->bind_param('sss', $dmName, $type, $allowed);
            
            if ($stmt->execute()) {
                $newId = (int)$stmt->insert_id;
                json_out(['status' => 'success', 'data' => ['channel_id' => $newId, 'name' => $dmName]]);
            } else {
                json_out(['status' => 'error', 'error' => 'Failed to create DM channel'], 500);
            }
            $stmt->close();
        }

        // =====================================================================
        // ACTION: FETCH MESSAGES
        // Retrieves chat history. 
        // CRITICAL: Marks messages as "Read" if viewing a DM.
        // =====================================================================
        case 'fetch': {
            $channelId = (int)($_GET['channel_id'] ?? 0);
            $lastId    = (int)($_GET['last_id'] ?? 0);

            if ($channelId <= 0) json_out(['status' => 'error', 'error' => 'Invalid Channel ID'], 400);

            // 1. Security Check
            $stmt = $conn->prepare("SELECT allowed_roles, type FROM chat_channels WHERE id = ? LIMIT 1");
            $stmt->bind_param('i', $channelId);
            $stmt->execute();
            $chan = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            if (!$chan || !can_view_channel($userId, $userRole, $chan['allowed_roles'] ?? null)) {
                json_out(['status' => 'error', 'error' => 'Access denied'], 403);
            }
            
            // 2. Mark as Read (Only if it's a DM and messages are for ME)
            // This is what clears the "Red Badge" when you open the chat.
            if ($chan['type'] === 'DM') {
                $upd = $conn->prepare("UPDATE chat_messages SET is_read = 1 
                                       WHERE channel_id = ? AND receiver_id = ? AND is_read = 0");
                $upd->bind_param('ii', $channelId, $userId);
                $upd->execute();
                $upd->close();
            }

            // 3. Fetch Data (Joined with sender names)
            $sql = "
                SELECT 
                    m.id, 
                    m.message_text, 
                    m.urgency, 
                    m.created_at, 
                    m.sender_id,        -- Renamed from user_id in DB patch
                    m.acknowledged_at,
                    e.full_name
                FROM chat_messages m
                JOIN user_auth u ON m.sender_id = u.user_id
                JOIN employee_master e ON u.employee_id = e.employee_id
                WHERE m.channel_id = ? AND m.id > ?
                ORDER BY m.id ASC
                LIMIT 50
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('ii', $channelId, $lastId);
            $stmt->execute();
            $rs = $stmt->get_result();

            $messages = [];
            while ($r = $rs->fetch_assoc()) {
                $messages[] = [
                    'id'            => (int)$r['id'],
                    'message_text'  => (string)$r['message_text'],
                    'urgency'       => safe_upper((string)($r['urgency'] ?? 'NORMAL')),
                    'time'          => date('H:i', strtotime((string)$r['created_at'])),
                    'full_name'     => (string)$r['full_name'],
                    'sender_id'     => (int)$r['sender_id'],
                    'is_mine'       => ((int)$r['sender_id'] === $userId),
                    'acknowledged_at' => $r['acknowledged_at'] // Null or timestamp string
                ];
            }
            $stmt->close();

            json_out(['status' => 'success', 'data' => $messages]);
        }

        // =====================================================================
        // ACTION: SEND MESSAGE
        // =====================================================================
        case 'send': {
            // Read raw JSON input
            $input = json_decode((string)file_get_contents('php://input'), true);
            if (!is_array($input)) json_out(['status' => 'error', 'error' => 'Invalid JSON Payload'], 400);

            $channelId = (int)($input['channel_id'] ?? 0);
            $urgency   = safe_upper((string)($input['urgency'] ?? 'NORMAL'));
            $text      = trim((string)($input['message'] ?? ''));

            // Validation
            if ($channelId <= 0) json_out(['status' => 'error', 'error' => 'Channel ID required'], 400);
            if ($text === '')     json_out(['status' => 'error', 'error' => 'Message cannot be empty'], 400);

            // 1. Permission Check
            $stmt = $conn->prepare("SELECT allowed_roles, type FROM chat_channels WHERE id = ? LIMIT 1");
            $stmt->bind_param('i', $channelId);
            $stmt->execute();
            $chan = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            if (!$chan || !can_view_channel($userId, $userRole, $chan['allowed_roles'] ?? null)) {
                json_out(['status' => 'error', 'error' => 'Access denied'], 403);
            }

            // 2. Identify Receiver (Important for Notifications & Email)
            $receiverId = 0;
            if ($chan['type'] === 'DM') {
                $receiverId = get_dm_receiver_id($userId, $chan['allowed_roles']);
            }

            // 3. Urgency Gating (Only Admin/Mgmt can send CRITICAL)
            if ($urgency === 'CRITICAL' && !in_array($userRole, ['ADMIN','MANAGEMENT'], true)) {
                $urgency = 'URGENT'; // Downgrade if unauthorized
            }
            // Whitelist urgency values
            if (!in_array($urgency, ['NORMAL','URGENT','CRITICAL'], true)) {
                $urgency = 'NORMAL';
            }

            // 4. Insert Message
            // Note: 'sender_id' is used instead of 'user_id'
            // 'email_notified' = 0 (Ready for Cron Job)
            // 'is_read' = 0
            $sql = "INSERT INTO chat_messages 
                    (channel_id, sender_id, message_text, urgency, receiver_id, is_read, email_notified, created_at) 
                    VALUES (?, ?, ?, ?, ?, 0, 0, NOW())";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('iissi', $channelId, $userId, $text, $urgency, $receiverId);
            $ok = $stmt->execute();
            $stmt->close();

            if ($ok) {
                json_out(['status' => 'success']);
            } else {
                json_out(['status' => 'error', 'error' => 'Database Insert Failed'], 500);
            }
        }

        default:
            json_out(['status' => 'error', 'error' => 'Invalid Action'], 400);
    }

} catch (Throwable $e) {
    // Catch-all for server errors (JSON format)
    json_out([
        'status' => 'error', 
        'error'  => 'Server Internal Error', 
        'detail' => $e->getMessage()
    ], 500);
}
?>