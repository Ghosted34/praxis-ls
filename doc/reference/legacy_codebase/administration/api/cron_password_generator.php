<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - GOD MODE CRON SCRIPT
 * ======================================================================================
 */

// --- TEMPORARY DEBUGGING: Turn on errors so we can see what's wrong ---
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

// --- CORRECTED PATH to init.php ---
// Since this file is in /administration/api/, we go up one level (../) to find /includes/
require_once __DIR__ . '/../includes/init.php';

$conn = db();

// 1. Generate a random 6-character uppercase alphanumeric string
$chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
$weeklyPassword = '';
for ($i = 0; $i < 6; $i++) {
    $weeklyPassword .= $chars[random_int(0, strlen($chars) - 1)];
}

// 2. Hash and calculate dates
$hash = password_hash($weeklyPassword, PASSWORD_DEFAULT);
$weekNumber = (int)date('W');
$year = (int)date('Y');
$expiresAt = date('Y-m-d H:i:s', strtotime('+7 days'));

// 3. Save to Database (Upsert)
$stmt = $conn->prepare("
    INSERT INTO god_mode_passwords (password_hash, week_number, year, expires_at) 
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), expires_at = VALUES(expires_at)
");
$stmt->bind_param('siis', $hash, $weekNumber, $year, $expiresAt);

if ($stmt->execute()) {
    // 4. Email the CEO
    $to = 'timothee.massomba@smartls.cm';
    $subject = "Strictly Confidential: Weekly Eradication Protocol Token (Week $weekNumber)";
    $message = "
        Dear Mr. Massomba,

        Your secure god-mode deletion token for Week $weekNumber, $year has been generated.
        
        TOKEN: $weeklyPassword

        This token is required to execute any hard deletions in the Smart LS database and will expire on $expiresAt.
        Do not share this token.
        
        System Administrator
    ";
    
    $headers = "From: system@smartls.cm\r\n";
    $headers .= "Reply-To: no-reply@smartls.cm\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();

    // Send email
    if (mail($to, $subject, $message, $headers)) {
        echo "<h3>Cron Success</h3><p>Token generated and emailed successfully to $to.</p>";
    } else {
        echo "<h3>Cron Partial Success</h3><p>Token saved to database, but the email failed to send. Please check your server's email configuration (e.g., Sendmail or Exim).</p>";
    }
} else {
    echo "<h3>Cron Error</h3><p>Failed to update database. Error: " . $conn->error . "</p>";
}