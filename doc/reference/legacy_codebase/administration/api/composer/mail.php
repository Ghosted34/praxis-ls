<?php
// config/mail.php
// Place this file outside webroot if possible.
// Do NOT commit to git with real secrets.

if (!defined('MAIL_HOST')) define('MAIL_HOST', 'smtp.office365.com');
if (!defined('MAIL_PORT')) define('MAIL_PORT', 587);
if (!defined('MAIL_USER')) define('MAIL_USER', 'no-reply@smartls.cm'); // sending mailbox
if (!defined('MAIL_PASS')) define('MAIL_PASS', 'REPLACE_WITH_PASSWORD_OR_APP_PASSWORD');
if (!defined('MAIL_FROM')) define('MAIL_FROM', 'info@smartls.cm');
if (!defined('MAIL_FROM_NAME')) define('MAIL_FROM_NAME', 'Smart LS Security');
if (!defined('MAIL_ENCRYPTION')) define('MAIL_ENCRYPTION', 'tls'); // 'ssl' or 'tls'
if (!defined('MAIL_DEBUG')) define('MAIL_DEBUG', 0); // set 2 temporarily for CLI debug


// test_mail.php
$to = 'victoretad@gmail.com'; // replace with your Gmail for testing
$subject = 'TEST SmartLS Mail';
$message = "Test message at " . date('c') . "\n";
$headers = "From: Smart LS <noreply@smartls.cm>\r\n" .
           "Reply-To: support@smartls.cm\r\n" .
           "X-Mailer: PHP/" . phpversion() . "\r\n";

$result = mail($to, $subject, $message, $headers);
file_put_contents(__DIR__ . '/mail_test_log.txt', date('c')." result=".($result? 'true':'false')." headers=" . json_encode($headers) . PHP_EOL, FILE_APPEND);
echo "mail() returned: " . ($result ? "true" : "false") . PHP_EOL;
