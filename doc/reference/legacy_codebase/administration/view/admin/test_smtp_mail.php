<?php
require_once __DIR__ . '/../../api/composer/vendor/autoload.php';
require_once __DIR__ . '/../../api/composer/mail.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

header('Content-Type: text/plain; charset=utf-8');

$mail = new PHPMailer(true);
try {
    $mail->SMTPDebug = 2;
    $mail->Debugoutput = function($str,$level){ echo "DEBUG[$level]: $str\n"; };

    $mail->isSMTP();
    $mail->Host = MAIL_HOST;            // smtp.office365.com
    $mail->Port = MAIL_PORT;            // 587
    $mail->SMTPAuth = true;
    $mail->Username = 'no-reply@smartls.cm';
    $mail->Password = 'Water@2025norep';
    $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;

    // TEMPORARY: bypass cert verification (for debug only)
    $mail->SMTPOptions = [
        'ssl' => [
            'verify_peer'       => false,
            'verify_peer_name'  => false,
            'allow_self_signed' => true
        ]
    ];

    $mail->setFrom(MAIL_FROM, MAIL_FROM_NAME);
    $mail->addAddress('victoretad@gmail.com');
    $mail->Subject = 'SmartLS SMTP Browser Test (debug)';
    $mail->Body    = "SMTP test at " . date('c');

    $mail->send();
    echo "\n✅ SENT\n";
} catch (Exception $e) {
    echo "\n❌ ERROR: " . $mail->ErrorInfo . "\n";
}
