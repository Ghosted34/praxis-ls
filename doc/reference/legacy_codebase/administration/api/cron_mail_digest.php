<?php
/**
 * SMART LS EMAIL SWEEPER (CRON SCRIPT)
 * -------------------------------------------------------------------------
 * @author      JBS Praxis / Development Team
 * @version     2.0 (Digest Mode)
 * @description Automatically scans for unread chat messages and sends 
 * email notifications to offline users.
 * -------------------------------------------------------------------------
 * * LOGIC FLOW:
 * 1. Find messages that are UNREAD and NOTIFIED = 0.
 * 2. Filter for messages older than GRACE_PERIOD (e.g., 5 mins).
 * (This gives the user a chance to reply instantly without getting an email).
 * 3. Group messages by RECEIVER (Jerry gets 1 email for 5 texts from Tom).
 * 4. Send HTML Digest Email via native mail().
 * 5. Update DB (email_notified = 1) to prevent duplicate alerts.
 * -------------------------------------------------------------------------
 * * HOW TO RUN:
 * 1. Manual Test: Open https://your-site.com/administration/api/cron_mail_digest.php
 * 2. Automated: Set up a Cron Job in cPanel to run every 5 or 10 minutes.
 */

// --- 1. INITIALIZATION & CONFIG ---

// Disable session requirement since Cron runs as 'system', not a logged-in user.
define('BYPASS_AUTH', true); 

// Adjust path to find init.php. 
// Assuming this file is in /administration/api/
require_once __DIR__ . '/../includes/init.php';

// Configuration
const GRACE_PERIOD_MINUTES = 5;  // Wait 5 mins before sending email
const SYSTEM_SENDER_NAME   = "Smart LS Notifications";
const SYSTEM_SENDER_EMAIL  = "info@smartls.cm";
const BATCH_LIMIT          = 50; // Process max 50 users at a time to prevent timeout

// Enable text output for Cron Logs
header('Content-Type: text/plain; charset=utf-8');
echo "[CRON START] " . date('Y-m-d H:i:s') . "\n";

$conn = db();

try {
    // --- 2. THE SWEEP QUERY ---
    
    // We select unread messages that are "stale" (older than grace period)
    // We Join with employee_master to get the Receiver's Email and Sender's Name
    $sql = "
        SELECT 
            m.id as message_id,
            m.message_text,
            m.created_at,
            m.sender_id,
            m.receiver_id,
            sender_emp.full_name as sender_name,
            receiver_emp.full_name as receiver_name,
            receiver_emp.email as receiver_email
        FROM chat_messages m
        JOIN user_auth sender_auth ON m.sender_id = sender_auth.user_id
        JOIN employee_master sender_emp ON sender_auth.employee_id = sender_emp.employee_id
        JOIN user_auth receiver_auth ON m.receiver_id = receiver_auth.user_id
        JOIN employee_master receiver_emp ON receiver_auth.employee_id = receiver_emp.employee_id
        WHERE 
            m.is_read = 0 
            AND m.email_notified = 0
            AND m.created_at < (NOW() - INTERVAL ? MINUTE)
            AND receiver_emp.email IS NOT NULL 
            AND receiver_emp.email != ''
        ORDER BY m.receiver_id, m.created_at ASC
        LIMIT 500
    ";

    $stmt = $conn->prepare($sql);
    $grace = GRACE_PERIOD_MINUTES;
    $stmt->bind_param('i', $grace);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows === 0) {
        echo "[INFO] No pending notifications found.\n";
        exit;
    }

    echo "[INFO] Found " . $result->num_rows . " pending messages.\n";

    // --- 3. GROUPING LOGIC ---
    
    // Structure: $digest[receiver_email] = [ 'name' => 'Jerry', 'messages' => [] ]
    $digest = [];
    $messageIdsProcessed = [];

    while ($row = $result->fetch_assoc()) {
        $email = trim($row['receiver_email']);
        
        // Skip invalid emails logic
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            echo "[WARN] Skipping invalid email: " . $email . "\n";
            continue;
        }

        if (!isset($digest[$email])) {
            $digest[$email] = [
                'receiver_name' => $row['receiver_name'],
                'receiver_id'   => $row['receiver_id'],
                'items'         => []
            ];
        }

        // Add message to that person's list
        $digest[$email]['items'][] = [
            'from' => $row['sender_name'],
            'text' => $row['message_text'],
            'time' => date('H:i', strtotime($row['created_at']))
        ];

        // Track ID to mark as sent later
        $messageIdsProcessed[] = $row['message_id'];
    }

    // --- 4. SENDING BATCH ---

    $emailsSent = 0;

    foreach ($digest as $email => $data) {
        $name = $data['receiver_name'];
        $count = count($data['items']);
        $itemsHtml = "";

        // Build the Message List HTML
        foreach ($data['items'] as $msg) {
            $preview = htmlspecialchars(substr($msg['text'], 0, 100)) . (strlen($msg['text']) > 100 ? '...' : '');
            $itemsHtml .= "
                <div style='border-bottom:1px solid #eee; padding: 8px 0;'>
                    <strong style='color:#333;'>{$msg['from']}</strong> <span style='color:#999; font-size:12px;'>({$msg['time']})</span><br>
                    <span style='color:#555;'>{$preview}</span>
                </div>
            ";
        }

        // Email Subject
        $subject = "Smart LS: You have $count unread message" . ($count > 1 ? 's' : '');

        // HTML Email Body
        $body = "
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
            .container { padding: 20px; border: 1px solid #ddd; max-width: 600px; margin: 0 auto; }
            .btn { background: #0b5ed7; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 15px; }
            .footer { margin-top: 20px; font-size: 12px; color: #aaa; text-align: center; }
          </style>
        </head>
        <body>
            <div class='container'>
                <h3>Hello, $name</h3>
                <p>You have <strong>$count new message(s)</strong> waiting for you in the Smart LS Portal.</p>
                
                <div style='background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;'>
                    $itemsHtml
                </div>

                <div style='text-align: center;'>
                    <a href='https://smartlogistics.com/administration/' class='btn'>Go to Dashboard</a>
                </div>

                <div class='footer'>
                    This is an automated notification. Please do not reply.<br>
                    Smart Logistics & Services Ltd.
                </div>
            </div>
        </body>
        </html>
        ";

        // Headers for HTML Mail
        $headers  = "MIME-Version: 1.0" . "\r\n";
        $headers .= "Content-type: text/html; charset=UTF-8" . "\r\n";
        $headers .= "From: " . SYSTEM_SENDER_NAME . " <" . SYSTEM_SENDER_EMAIL . ">" . "\r\n";
        $headers .= "Reply-To: " . SYSTEM_SENDER_EMAIL . "\r\n";
        $headers .= "X-Mailer: PHP/" . phpversion();

        // Send
        if (mail($email, $subject, $body, $headers)) {
            echo "[OK] Sent to $email ($count msgs)\n";
            $emailsSent++;
        } else {
            echo "[ERR] Failed sending to $email\n";
        }
    }

    // --- 5. CLEANUP (MARK AS NOTIFIED) ---

    if (!empty($messageIdsProcessed)) {
        // Efficient Update: "UPDATE chat_messages SET email_notified = 1 WHERE id IN (1, 2, 3...)"
        $idsStr = implode(',', array_map('intval', $messageIdsProcessed));
        $updateSql = "UPDATE chat_messages SET email_notified = 1 WHERE id IN ($idsStr)";
        
        if ($conn->query($updateSql)) {
            echo "[SUCCESS] Database updated. Marked " . count($messageIdsProcessed) . " messages.\n";
        } else {
            echo "[CRITICAL] Database update failed! User might get duplicate emails.\n";
        }
    }

    echo "[CRON END] Completed.\n";

} catch (Exception $e) {
    echo "[EXCEPTION] " . $e->getMessage() . "\n";
}
?>