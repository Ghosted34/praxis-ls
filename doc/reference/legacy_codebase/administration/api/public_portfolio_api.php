<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - PUBLIC PORTFOLIO API
 * ======================================================================================
 * DESCRIPTION: Publicly accessible API to fetch published Success Stories for the
 * public-facing landing page (www.smartls.cm/success-stories).
 * NO AUTHENTICATION REQUIRED.
 * ======================================================================================
 */

declare(strict_types=1);
require_once __DIR__ . '/../includes/init.php'; 
// NOTE: role_guard.php is intentionally omitted here for public access.

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // Allows your frontend domain to fetch this if hosted separately

$action = $_GET['action'] ?? '';

if (empty($action)) {
    echo json_encode(['success' => false, 'error' => 'Action missing']);
    exit;
}

try {
    $conn = db();

    switch ($action) {
        // --- 1. FETCH ALL PUBLISHED STORIES (For the Grid Landing Page) ---
        // We only pull lightweight data here to keep the landing page lightning fast.
        case 'get_all_stories':
            $sql = "SELECT s.story_id, s.slug, s.title, s.service_category, s.cover_image_path, s.client_logo_path, 
                           c.client_name, DATE_FORMAT(s.published_at, '%M %Y') as publish_date
                    FROM smart_success_stories s
                    LEFT JOIN client_master c ON s.client_id = c.client_id
                    WHERE s.status = 'PUBLISHED'
                    ORDER BY s.published_at DESC";
            
            $result = $conn->query($sql);
            if (!$result) {
                throw new Exception("Database query failed.");
            }
            
            $stories = $result->fetch_all(MYSQLI_ASSOC);
            
            echo json_encode([
                'success' => true, 
                'data' => $stories
            ]);
            break;

        // --- 2. FETCH SINGLE STORY DETAILS (For the Detailed SEO Page) ---
        // Pulls the heavy text and JSON arrays for the full case study read.
        case 'get_story_details':
            $slug = $_GET['slug'] ?? '';
            
            if (empty($slug)) {
                throw new Exception("Story slug is required.");
            }

            $sql = "SELECT s.*, c.client_name 
                    FROM smart_success_stories s
                    LEFT JOIN client_master c ON s.client_id = c.client_id
                    WHERE s.slug = ? AND s.status = 'PUBLISHED' LIMIT 1";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('s', $slug);
            $stmt->execute();
            $story = $stmt->get_result()->fetch_assoc();

            if (!$story) {
                throw new Exception("Story not found, retracted, or still a draft.");
            }

            // Decode JSON fields back into arrays for easy frontend consumption
            $story['hard_kpis'] = json_decode($story['hard_kpis'] ?? '[]', true);
            $story['gallery_images'] = json_decode($story['gallery_images'] ?? '[]', true);

            // Format date for display
            $story['formatted_date'] = date('F j, Y', strtotime($story['published_at']));

            echo json_encode([
                'success' => true, 
                'data' => $story
            ]);
            break;

        default:
            throw new Exception("Invalid public action.");
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}