<?php
// test_gemini.php - Standalone Gemini API Tester
ini_set('display_errors', 1);
error_reporting(E_ALL);

$api_key = 'AIzaSyD5-sd_MX-feoIGhYdK4zdNfO8PnQbSFHU'; // <-- PASTE YOUR FULL KEY HERE
$url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . $api_key;

$payload = json_encode([
    "contents" => [["parts" => [["text" => "Reply with exactly one word: SUCCESS"]]]]
]);

echo "<h3>Testing Gemini API...</h3>";

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
// Added this line in case your server's SSL certificates are outdated (a common cause of cURL freezing)
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); 

$response = curl_exec($ch);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    echo "<p style='color:red;'><b>cURL Network Error:</b> " . htmlspecialchars($error) . "</p>";
} else {
    echo "<p><b>Raw Response from Google:</b></p>";
    echo "<pre style='background:#f4f4f4; padding:10px; border:1px solid #ccc;'>" . htmlspecialchars($response) . "</pre>";
    
    $data = json_decode($response, true);
    if (isset($data['error'])) {
        echo "<p style='color:red;'><b>Google API Error:</b> " . htmlspecialchars($data['error']['message']) . "</p>";
    } elseif (isset($data['candidates'])) {
        echo "<p style='color:green;'><b>API IS WORKING PERFECTLY!</b></p>";
    }
}
?>