<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - SUCCESS STORIES & PORTFOLIO API
 * ======================================================================================
 * MODULE: CRM & Acquisition / Marketing
 * DESCRIPTION: Handles AI generation, image uploads, and saving for Success Stories.
 * ======================================================================================
 */

declare(strict_types=1);
require_once __DIR__ . '/../includes/init.php'; 
require_once __DIR__ . '/../includes/role_guard.php';

// Accessible to Admin, Sales, Management, and Marketing (if applicable)
require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

header('Content-Type: application/json');

$json_payload = json_decode(file_get_contents('php://input'), true);
$action = $_GET['action'] ?? ($_POST['action'] ?? ($json_payload['action'] ?? ''));
$employeeId = $_SESSION['auth']['employee_id'] ?? '';
$userId = $_SESSION['auth']['user_id'] ?? 0;

$conn = db();

try {
    switch ($action) {

        // --- 1. FETCH ELIGIBLE OPERATIONS FILES ---
        case 'fetch_eligible_ops':
            $clientId = $_GET['client_id'] ?? '';
            
            // Pulling client_name, sea_bl, and air_mawb for detailed dropdown UI
            $sql = "SELECT operations_file_reference, client_name, service_type, commodity, 
                           operations_status, gross_weight, weight_unit, sea_bl, air_mawb, created_at 
                    FROM operations_file_master 
                    WHERE operations_status IN ('IN_PROGRESS', 'OPERATIONALLY_COMPLETED', 'FINANCIALLY_PENDING', 'CLOSED')";
            
            // Filter strictly by client if provided
            if (!empty($clientId)) {
                $sql .= " AND client_id = ?";
            }
            
            $sql .= " ORDER BY created_at DESC LIMIT 100";
            
            $stmt = $conn->prepare($sql);
            if (!empty($clientId)) {
                $stmt->bind_param('s', $clientId);
            }
            
            $stmt->execute();
            $ops = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
            
            echo json_encode(['success' => true, 'ops' => $ops]);
            break;

        // --- 2. AUDIO TRANSCRIPTION & SMART FOLLOW-UP (GROQ WHISPER + GEMINI) ---
        case 'transcribe_audio':
            $base64Audio = $json_payload['audio_b64'] ?? '';
            $serviceType = $json_payload['service_type'] ?? 'Logistics';
            
            if (empty($base64Audio)) throw new Exception('No audio data received.');

            $audioData = base64_decode(preg_replace('#^data:audio/\w+;base64,#i', '', $base64Audio));
            $tmpFilePath = sys_get_temp_dir() . '/' . uniqid('story_audio_') . '.webm';
            file_put_contents($tmpFilePath, $audioData);

            $groq_api_key = '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'; 
            
            $cFile = new CURLFile($tmpFilePath, 'audio/webm', 'audio.webm');
            
            $ch = curl_init('https://api.groq.com/openai/v1/audio/transcriptions');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Authorization: Bearer ' . $groq_api_key
            ]);
            curl_setopt($ch, CURLOPT_POSTFIELDS, [
                'file' => $cFile,
                'model' => 'whisper-large-v3', // Groq's high-speed Whisper model
                'response_format' => 'json'
            ]);

            $response = curl_exec($ch);
            curl_close($ch);
            @unlink($tmpFilePath); // Clean up temp file

            $result = json_decode($response, true);
            
            if (isset($result['text'])) {
                $transcribedText = trim($result['text']);
                $wordCount = str_word_count($transcribedText);
                
                // AI Follow-up Logic: If the user spoke less than 20 words, ask a probing question
                $followUpQuestion = null;
                if ($wordCount > 0 && $wordCount < 20) {
                    $gemini_api_key = 'AIzaSyD5-sd_MX-feoIGhYdK4zdNfO8PnQbSFHU'; // Replace with Gemini Key
                    $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . $gemini_api_key;
                    
                    $prompt = "A logistics sales rep just dictated notes for a case study about a '$serviceType' operation, but it was very brief: '$transcribedText'. Ask exactly ONE short, punchy follow-up question to extract a specific metric or challenge overcome to make the case study better. Do not use quotes.";
                    
                    $chG = curl_init($url);
                    curl_setopt($chG, CURLOPT_RETURNTRANSFER, true);
                    curl_setopt($chG, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
                    curl_setopt($chG, CURLOPT_POST, true);
                    curl_setopt($chG, CURLOPT_POSTFIELDS, json_encode(["contents" => [["parts" => [["text" => $prompt]]]]]));
                    $geminiRes = curl_exec($chG);
                    curl_close($chG);
                    
                    $gemData = json_decode($geminiRes, true);
                    if (isset($gemData['candidates'][0]['content']['parts'][0]['text'])) {
                        $followUpQuestion = trim($gemData['candidates'][0]['content']['parts'][0]['text']);
                    }
                }

                echo json_encode([
                    'success' => true, 
                    'text' => $transcribedText, 
                    'follow_up' => $followUpQuestion
                ]);
            } else {
                throw new Exception('Transcription failed.');
            }
            break;

        // --- 3. GENERATE SUCCESS STORY (GEMINI API) ---
        case 'generate_story':
            $opsRefs = $json_payload['ops_refs'] ?? [];
            $messyNotes = $json_payload['messy_notes'] ?? '';
            $titleIdea = $json_payload['title_idea'] ?? '';
            
            if (empty($opsRefs)) throw new Exception("Please select at least one operations file.");

            // Aggregate hard data from the database to feed the AI
            $placeholders = implode(',', array_fill(0, count($opsRefs), '?'));
            $stmt = $conn->prepare("SELECT service_type, commodity, gross_weight, weight_unit, port_of_loading, port_of_delivery, eta, ata, margin FROM operations_file_master WHERE operations_file_reference IN ($placeholders)");
            $stmt->bind_param(str_repeat('s', count($opsRefs)), ...$opsRefs);
            $stmt->execute();
            $opsData = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

            $aggregatedDataJson = json_encode($opsData);

            $gemini_api_key = 'AIzaSyD5-sd_MX-feoIGhYdK4zdNfO8PnQbSFHU'; 
            $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . $gemini_api_key;

            $prompt = "You are an expert B2B Logistics Marketing Copywriter.
            Task: Write a highly technical and authoritative Success Story / Case Study.
            
            Raw Operations Data from Database: $aggregatedDataJson
            Sales Rep's Messy Notes: $messyNotes
            Suggested Title Focus: $titleIdea

            Format exactly as requested in strictly valid JSON:
            1. 'title': A punchy, authoritative headline (max 80 chars).
            2. 'exec_summary': 1-2 paragraphs detailing the client's challenge and the overarching solution.
            3. 'ops_execution': 2 paragraphs detailing exactly HOW Smart Logistics executed the operation, mentioning specific ports, services, or overcoming bottlenecks.
            4. 'hard_kpis': An array of exactly 3 or 4 objects containing 'label' (e.g., 'Total Tonnage', 'Clearance Time') and 'value' (e.g., '240 Tons', '72 Hours'). Extract these from the Raw Data or the Messy Notes.

            Respond ONLY in JSON, no markdown formatting around it:
            {
              \"title\": \"...\",
              \"exec_summary\": \"...\",
              \"ops_execution\": \"...\",
              \"hard_kpis\": [{\"label\": \"...\", \"value\": \"...\"}]
            }";

            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 30); 
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
                "contents" => [["parts" => [["text" => $prompt]]]],
                "generationConfig" => ["response_mime_type" => "application/json"]
            ]));

            $response = curl_exec($ch);
            curl_close($ch);

            $gemData = json_decode($response, true);
            if (isset($gemData['candidates'][0]['content']['parts'][0]['text'])) {
                $clean_text = preg_replace('/```(?:json)?|```/', '', $gemData['candidates'][0]['content']['parts'][0]['text']);
                $ai_json = json_decode(trim($clean_text), true);
                if ($ai_json) {
                    echo json_encode(['success' => true, 'generated_content' => $ai_json]);
                } else {
                    throw new Exception("AI returned invalid JSON structure.");
                }
            } else {
                throw new Exception("AI Generation failed.");
            }
            break;

        // --- 4. UPLOAD IMAGES (Cover, Logo, Gallery) ---
        case 'upload_assets':
            $uploadDir = __DIR__ . '/../../uploads/portfolio/';
            if (!is_dir($uploadDir)) mkdir($uploadDir, 0777, true);

            $uploadedFiles = [];
            
            // Loop through uploaded files
            foreach ($_FILES as $inputName => $file) {
                if (is_array($file['name'])) {
                    // Handle Multiple Gallery Images
                    $uploadedFiles[$inputName] = [];
                    foreach ($file['name'] as $key => $name) {
                        if ($file['error'][$key] === UPLOAD_ERR_OK) {
                            $ext = pathinfo($name, PATHINFO_EXTENSION);
                            $newName = uniqid('port_gal_') . '.' . $ext;
                            if (move_uploaded_file($file['tmp_name'][$key], $uploadDir . $newName)) {
                                $uploadedFiles[$inputName][] = '/uploads/portfolio/' . $newName;
                            }
                        }
                    }
                } else {
                    // Handle Single File (Logo or Cover)
                    if ($file['error'] === UPLOAD_ERR_OK) {
                        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
                        $newName = uniqid("port_{$inputName}_") . '.' . $ext;
                        if (move_uploaded_file($file['tmp_name'], $uploadDir . $newName)) {
                            $uploadedFiles[$inputName] = '/uploads/portfolio/' . $newName;
                        }
                    }
                }
            }
            echo json_encode(['success' => true, 'paths' => $uploadedFiles]);
            break;

        // --- 5. SAVE / PUBLISH STORY ---
        case 'save_story':
            $data = $_POST['payload'] ? json_decode($_POST['payload'], true) : $json_payload;
            
            $clientId = $data['client_id'];
            $title = $data['title'];
            $serviceCat = $data['service_category'];
            $execSummary = $data['exec_summary'];
            $opsExecution = $data['ops_execution'];
            $kpisJson = json_encode($data['hard_kpis'] ?? []);
            $opsRefs = $data['ops_refs'] ?? [];
            $status = $data['status'] ?? 'DRAFT';
            
            // Handle Images (Passed from the upload step)
            $coverImage = $data['cover_image_path'] ?? '';
            $clientLogo = $data['client_logo_path'] ?? null;
            $galleryJson = isset($data['gallery_images']) ? json_encode($data['gallery_images']) : null;
            
            // Generate Slug
            $slug = strtolower(trim(preg_replace('/[^A-Za-z0-9-]+/', '-', $title)));

            $conn->begin_transaction();

            try {
                $storyId = $data['story_id'] ?? null;
                $publishedAt = ($status === 'PUBLISHED') ? date('Y-m-d H:i:s') : null;

                if (!$storyId) {
                    // Create New Sequence ID
                    $year = (int)date('Y');
                    $conn->query("INSERT INTO doc_sequences (module_key, year, seq) VALUES ('SUCCESS_STORY', $year, 1) ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)");
                    $seqRes = $conn->query("SELECT LAST_INSERT_ID() AS seq")->fetch_assoc();
                    $storyId = sprintf('SS-%d-%04d', $year, (int)$seqRes['seq']);
                    
                    // Insert Main Story
                    $stmt = $conn->prepare("INSERT INTO smart_success_stories (story_id, slug, client_id, client_logo_path, title, service_category, exec_summary, ops_execution, hard_kpis, cover_image_path, gallery_images, status, created_by_user_id, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                    $stmt->bind_param('ssssssssssssis', $storyId, $slug, $clientId, $clientLogo, $title, $serviceCat, $execSummary, $opsExecution, $kpisJson, $coverImage, $galleryJson, $status, $userId, $publishedAt);
                    $stmt->execute();
                } else {
                    // Update Existing
                    $stmt = $conn->prepare("UPDATE smart_success_stories SET slug=?, client_id=?, client_logo_path=COALESCE(?, client_logo_path), title=?, service_category=?, exec_summary=?, ops_execution=?, hard_kpis=?, cover_image_path=COALESCE(?, cover_image_path), gallery_images=COALESCE(?, gallery_images), status=?, published_at=COALESCE(published_at, ?) WHERE story_id=?");
                    $stmt->bind_param('sssssssssssss', $slug, $clientId, $clientLogo, $title, $serviceCat, $execSummary, $opsExecution, $kpisJson, $coverImage, $galleryJson, $status, $publishedAt, $storyId);
                    $stmt->execute();
                    
                    // Delete old junction links to refresh them
                    $conn->query("DELETE FROM success_story_ops_links WHERE story_id = '$storyId'");
                }

                // Insert Junction Links
                if (!empty($opsRefs)) {
                    $stmtLink = $conn->prepare("INSERT INTO success_story_ops_links (story_id, operations_file_reference) VALUES (?, ?)");
                    foreach ($opsRefs as $ref) {
                        $stmtLink->bind_param('ss', $storyId, $ref);
                        $stmtLink->execute();
                    }
                }

                $conn->commit();
                echo json_encode(['success' => true, 'story_id' => $storyId, 'slug' => $slug]);

            } catch (Exception $ex) {
                $conn->rollback();
                throw $ex;
            }
            break;

        default:
            throw new Exception("Invalid action provided.");
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}