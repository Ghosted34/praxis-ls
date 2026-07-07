<?php
/**
 * ==============================================================================
 * SMART LS ENTERPRISE - HR CONTRACT API (HTML ENGINE)
 * Logic: Generates strict HTML for Browser Printing (No External Libraries)
 * ==============================================================================
 */

require_once __DIR__ . '/../includes/init.php';
require_once __DIR__ . '/../includes/role_guard.php';

header('Content-Type: application/json');

// Security & Context
$userId = $_SESSION['auth']['user_id'] ?? 0;
$empId  = $_SESSION['auth']['employee_id'] ?? '';
$role   = $_SESSION['auth']['role'] ?? 'USER';

if (!in_array($role, ['ADMIN','FINANCE','MANAGEMENT'])) {
    http_response_code(403); echo json_encode(['status'=>'error','message'=>'Access Denied']); exit;
}

$conn = db();
$action = $_POST['action'] ?? $_GET['action'] ?? '';

try {
    switch($action) {
        case 'fetch_employee_data': fetchEmployeeData($conn); break;
        case 'preview_contract':    renderContractHTML($conn, 'PREVIEW'); break;
        case 'save_contract_data':  saveContractData($conn, $userId); break;
        default: throw new Exception("Invalid Action");
    }
} catch (Exception $e) {
    http_response_code(400); echo json_encode(['status'=>'error', 'message'=>$e->getMessage()]);
}

// ------------------------------------------------------------------------------
// 1. DATA FETCHING
// ------------------------------------------------------------------------------
function fetchEmployeeData($conn) {
    $targetId = $_GET['employee_id'] ?? '';
    if (!$targetId) throw new Exception("Employee ID required");

    $sql = "SELECT employee_id, full_name, job_title, address, nationality, 
            id_card_number, marital_status, num_children, phone, dob, avatar_path
            FROM employee_master WHERE employee_id = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $targetId);
    $stmt->execute();
    $data = $stmt->get_result()->fetch_assoc();
    
    if (!$data) throw new Exception("Employee not found");

    // Generate Reference: SLAS/DG/DAG/HR/CTR-YY-{EMP_ID}-{SUFFIX}
    $year = date('y');
    $parts = explode(' ', trim($data['full_name']));
    $suffix = strtoupper(substr($parts[0], 0, 1) . (isset($parts[1]) ? substr($parts[1], 0, 1) : ''));
    $ref = "SLAS/DG/DAG/HR/CTR-{$year}-{$data['employee_id']}-{$suffix}";

    echo json_encode(['status'=>'success', 'data' => $data, 'suggested_ref' => $ref]);
}

// ------------------------------------------------------------------------------
// 2. FULL TEXT GENERATION (NO LIBRARIES)
// ------------------------------------------------------------------------------
// ------------------------------------------------------------------------------
// FUNCTION: FULL CONTRACT RENDER ENGINE (HTML TO PRINT)
// ------------------------------------------------------------------------------
function renderContractHTML($conn, $mode) {
    // 1. GATHER INPUTS
    $ref          = $_POST['contract_ref'];
    $targetEmp    = $_POST['target_employee_id'];
    
    // Dynamic Contract Variables
    $contractType = $_POST['contract_type'] ?? 'PERMANENT'; // PERMANENT, FIXED_TERM, INTERNSHIP
    $hasProbation = (isset($_POST['has_probation']) && $_POST['has_probation'] === 'true');
    $duration     = $_POST['duration_months'] ?? 12;
    $probation    = (int)($_POST['probation_months'] ?? 3);
    
    // Personal & Financial
    $pob          = $_POST['place_of_birth'];
    $startDate    = $_POST['start_date'];
    $category     = $_POST['salary_category'];
    $grade        = $_POST['salary_grade'];
    $salaryRaw    = $_POST['gross_salary'] ?? 0;
    $salary       = number_format((float)$salaryRaw, 0, '.', '.'); // Format: 250.000
    
    // Annex
    $jdText       = $_POST['jd_text'] ?? '';
    $includeJd    = (isset($_POST['include_jd']) && $_POST['include_jd'] === 'true');

    // 2. FETCH EMPLOYEE MASTER DATA
    $sql = "SELECT * FROM employee_master WHERE employee_id = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $targetEmp);
    $stmt->execute();
    $emp = $stmt->get_result()->fetch_assoc();

    if (!$emp) {
        echo json_encode(['status' => 'error', 'message' => 'Employee not found.']);
        exit;
    }

    // 3. DATE FORMATTING
    $dobFmt   = date('jS F Y', strtotime($emp['dob'])); // 10th December 1982
    $startFmt = date('jS F Y', strtotime($startDate));
    $signDate = date('d/m/Y');

    // 4. LOGIC ENGINE: ARTICLE 2 (DURATION & PROBATION)
    $article2Text = "";
    
    // Part A: Duration
    if ($contractType === 'PERMANENT') {
        $article2Text = "This contract is concluded for an <span class='var'>indefinite period</span> and will take effect from <span class='var'>$startFmt</span>.";
    } elseif ($contractType === 'INTERNSHIP') {
        $article2Text = "This contract is concluded for an <span class='var'>internship period of $duration months</span>, taking effect from <span class='var'>$startFmt</span>.";
    } else {
        // Fixed Term / Trial
        $article2Text = "This contract is concluded for a <span class='var'>fixed-term period of $duration months</span>, taking effect from <span class='var'>$startFmt</span>.";
    }

    // Part B: Probation
    if ($hasProbation && $probation > 0) {
        $article2Text .= " The probationary period is set at <span class='var'>$probation months</span> renewable once in accordance with the provisions of the applicable collective agreement.";
    } else {
        $article2Text .= " No probationary period is applicable to this contract.";
    }

    // 5. ASSET PATHS (Adjusted for where the API runs relative to assets)
    // Assuming API is in /administration/api/, we go up 3 levels to root assets
    $logoSrc = "../../../assets/img-webp/logo-smart.webp";
    $sigSrc  = "../../../assets/img/signature-dg.svg";

    // 6. BUILD HTML DOCUMENT
    $html = '
    <!DOCTYPE html>
    <html>
    <head>
        <title>Contract ' . $ref . '</title>
        <style>
            @page { size: A4; margin: 20mm 20mm 20mm 20mm; }
            body { font-family: "Times New Roman", serif; font-size: 11pt; color: #000; line-height: 1.3; margin: 0; padding: 20px; }
            .page-break { page-break-after: always; }
            
            /* Header */
            .header-table { width: 100%; border-bottom: 2px solid #000; margin-bottom: 20px; padding-bottom: 10px; }
            .logo { height: 60px; width: auto; }
            .doc-title { text-transform: uppercase; font-size: 16pt; font-weight: 900; text-align: right; }
            .doc-ref { font-size: 10pt; font-weight: bold; text-align: right; margin-top: 5px; }

            /* Content */
            h3 { font-size: 11pt; font-weight: bold; margin-top: 0; margin-bottom: 5px; }
            h4 { font-size: 11pt; font-weight: bold; text-decoration: underline; margin-top: 15px; margin-bottom: 5px; }
            p { text-align: justify; margin-bottom: 8px; margin-top: 0; }
            
            .var { font-weight: bold; }
            .list-item { margin-left: 20px; text-indent: -20px; display: block; margin-bottom: 4px; }
            
            /* Signatures */
            .sig-table { width: 100%; margin-top: 30px; border-collapse: collapse; }
            .sig-td { width: 50%; vertical-align: top; padding: 10px; }
            .sig-box { min-height: 120px; }
            .sig-img { height: 100px; width: auto; display: block; margin-top: 5px; }
            
            /* Annex */
            .annex-box { border: 1px solid #ccc; padding: 15px; background: #f9f9f9; font-family: Arial, sans-serif; font-size: 10pt; }
        </style>
    </head>
    <body>

    <table class="header-table">
        <tr>
            <td valign="top"><img src="' . $logoSrc . '" class="logo"></td>
            <td valign="top">
                <div class="doc-title">Employment Contract</div>
                <div class="doc-ref">No: ' . $ref . '</div>
            </td>
        </tr>
    </table>

    <p><b>Between the undersigned:</b></p>
    
    <p><b>On the one hand,</b><br>
    The Company: <b>SMART LOGISTICS AND SERVICES LTD</b>, a Private Limited company, registered in the Trade and Companies Register under number RC/DLA/2021/B/2060 – NIU M042116033580Q whose registered office is located at 1030, Avenue Douala Manga Bell, Bali, Douala, Cameroon.<br>
    Represented by <b>Mr. Timothée MASSOMBA</b> in the capacity of Managing Director, duly authorized for the purposes hereof,</p>
    
    <p><b>And, on the other hand,</b><br>
    The Employee: <span class="var">' . strtoupper($emp['full_name']) . '</span><br>
    Born on: <span class="var">' . $dobFmt . '</span> in <span class="var">' . $pob . '</span><br>
    Nationality: <span class="var">' . $emp['nationality'] . '</span><br>
    Residing at: <span class="var">' . $emp['address'] . '</span><br>
    National ID Card: <span class="var">' . $emp['id_card_number'] . '</span><br>
    Bank Account: <span class="var">' . ($emp['bank_details'] ?? '_______________________') . '</span><br>
    Family Status: <span class="var">' . $emp['marital_status'] . '</span> with <span class="var">' . $emp['num_children'] . '</span> children<br>
    Phone number: <span class="var">' . $emp['phone'] . '</span></p>

    <p><b>It has been agreed as follows:</b></p>

    <h4>Article 1 – Employment</h4>
    <p>The Company hires the Employee as a <span class="var">' . $emp['job_title'] . '</span>.</p>
    <p>The Employee accepts the said position and undertakes to perform their duties in accordance with the Company\'s instructions and needs, in compliance with legal and regulatory obligations.</p>
    <p>The normal duties are as detailed in the job description attached.</p>
    <p>Unless otherwise notified by the Company, this position is required to report to the Line Manager.</p>
    <p>In addition to the normal duties, the Employee is required to be flexible in this position and may be required to undertake other duties from time to time.</p>
    <p>The Company reserves the right to transfer you to an alternative position, whether involving different duties or otherwise, in a different department and you are required to be willing to do so.</p>
    <p>The Employee shall devote all his services to the Company alone and shall faithfully and diligently perform such duties and shall obey and comply with such reasonable directions and instructions as may from time to time be given by or on behalf of the Company.</p>

    <h4>Article 2 – Nature and Duration of the Contract</h4>
    <p>' . $article2Text . '</p>

    <h4>Article 3 – Main Functions and Missions</h4>
    <p>The Employee will perform tasks consistent with their status as <span class="var">' . $emp['job_title'] . '</span>. The list of tasks is not exhaustive and may be revised according to the Company\'s needs.</p>

    <h4>Article 4 – Workplace</h4>
    <p>The position will be primarily exercised at Company’s main office address in Douala with regular travel expected within the assigned geographical area.</p>
    <p>In case of service necessity, the Employee may be required to work at other Company sites or to travel within the country and abroad.</p>
    <p>The Company reserves the right to move the Employee to any location within the Republic of Cameroon, depending on the requirements of the Company.</p>
    <p>Without any prejudice to the legal provisions relative to relocation indemnities and should the Employee reject any such transfer (which shall not be subject to any modification of this contract nor to the revision of any clause in this contract), his/her rejection of the transfer would amount to a breach of the present contract.</p>

    <div class="page-break"></div>

    <h4>Article 5 – Remuneration</h4>
    <p>During the term of this contract, the Employee will be placed on <span class="var">' . $category . ', ' . $grade . '</span>.</p>
    <p>The gross monthly salary is set at <span class="var">' . $salary . ' XAF</span> payable at the end of the month and at most 8 days into the succeeding month.</p>
    <p>A variable part may be added depending on the achievement of objectives set by the management. The precise methods of calculating and paying bonuses and commissions will be detailed in an annex note given to the Employee if applicable.</p>

    <h4>Article 6 – Working Hours</h4>
    <p>The working hours are set at 40 hours per week, distributed according to the schedule communicated by the Company.</p>

    <h4>Article 7 – Benefits</h4>
    <p>The Employee may benefit, according to the Company\'s practices and subject to seniority, from the following benefits:</p>
    <span class="list-item">• Company car or travel allowances (role dependent),</span>
    <span class="list-item">• Mobile phone and/or professional computer (role dependent),</span>
    <span class="list-item">• Company health insurance and provident fund,</span>
    <span class="list-item">• Affiliation to the National Social Insurance Fund (CNPS) in accordance with the legal rules and regulations in force.</span>

    <h4>Article 8 – Employee Obligations</h4>
    <p>The Employee undertakes to:</p>
    <span class="list-item">• Respect the confidentiality and non-disclosure rules of the Company\'s and its clients\' sensitive information,</span>
    <span class="list-item">• Comply with the Company\'s code of ethics and commercial policy,</span>
    <span class="list-item">• Represent the Company professionally and loyally to all stakeholders,</span>
    <span class="list-item">• Respect the Company\'s internal regulations.</span>

    <h4>Article 9 – Extraneous or Part-time Employment</h4>
    <p>The Employee shall devote to the Company his/her normal working hours and such time outside normal working hours that may be required for the proper fulfillment and completion of your tasks, duties and obligations in terms of your employment contract subject to legal compensation.</p>
    <p>The Employee shall not perform or engage himself or herself in any work either for their own account or for the account of any other person, body or corporate entity without the express written permission of the Company.</p>

    <h4>Article 10 – Further Terms and Conditions of Employment</h4>
    <p>The Company’s Rules, Policies and Procedures and Disciplinary Code and grievance procedures and such rules or regulations that may from time to time be enforced are binding on all Employees.</p>
    <p>The Company reserves the right to amend, suspend or extend any terms and conditions of employment from time to time in accordance with legal rules and regulations.</p>
    <p>The parties record that, as an Employee of the Company, you will acquire certain confidential information relating to trade secrets and/or confidential information of the Company.</p>

    <div class="page-break"></div>

    <h4>Article 11 – Non-Compete Clause</h4>
    <p>In the event of departure from the Company, the Employee undertakes, for a period of twelve months and within a defined geographical area, not to engage in any competing activity that could harm the Company. This clause gives rise to the payment of compensatory indemnity in accordance with the legislation.</p>

    <h4>Article 12 – Confidentiality</h4>
    <p>The Employee acknowledges having been informed of the confidentiality obligation regarding all information to which they will have access in the course of their duties, including after the termination of the employment contract.</p>

    <h4>Article 13 – Intellectual Property</h4>
    <p>Any creation, invention, or development made by the Employee during their professional activity belongs to the Company, unless otherwise stipulated.</p>

    <h4>Article 14 – Illness, Accident, and Provident Fund</h4>
    <p>In the event of illness or accident, the Employee must notify the Company as soon as possible and provide the necessary supporting documents. They will benefit from the provisions provided by the legislation and the collective agreement concerning salary maintenance and social protection.</p>

    <h4>Article 15 – Termination of the Contract</h4>
    <p>The contract may be terminated under the conditions provided by the legislation in force (resignation, dismissal, mutual termination).</p>
    <p>On termination of the employment for any reason whatsoever, the Employee shall hand over to the Company all the company’s property in his/her possession or under his/her control including but not limited to books, documents, computer discs, keys, and security cards.</p>

    <h4>Article 16 – Collective Agreement and Applicable Law</h4>
    <p>This contract is subject to the national collective agreement applicable to the company\'s sector of activity and Cameroonian law.</p>

    <h4>Article 17 – Miscellaneous</h4>
    <p>Any amendment to this contract must be recorded in writing and signed by both parties. If one of the contract\'s clauses is declared null, this will not affect the validity of the other clauses.</p>
    <p>This agreement is to be interpreted and applied according to the laws of the Republic of Cameroon (Law No 92/007 of August 1992, instituting the Labor Code) and the Collective Convention for freight.</p>

    <br><br>
    
    <table class="sig-table">
        <tr>
            <td class="sig-td"><b>Done in: Douala on ' . $signDate . '</b></td>
            <td class="sig-td"></td>
        </tr>
        <tr>
            <td class="sig-td">
                <b>For the COMPANY</b>
                <div class="sig-box">
                    <img src="' . $sigSrc . '" class="sig-img" alt="DG Signature">
                    <b>Timothée MASSOMBA</b>
                </div>
            </td>
            <td class="sig-td">
                <b>For the EMPLOYEE</b>
                <div class="sig-box">
                    <br><br><br>
                    _______________________________
                    <div style="font-size:8pt; margin-top:5px;">
                        I, the undersigned <b>' . $emp['full_name'] . '</b><br>
                        After having read and understood the entire content of this contract, do hereby accept employment with the Company, subject to all the terms set above.
                    </div>
                </div>
            </td>
        </tr>
    </table>
    ';

    // 7. ANNEX (JOB DESCRIPTION)
    if ($includeJd && !empty($jdText)) {
        $html .= '<div class="page-break"></div>';
        $html .= '<h3>ANNEX: JOB DESCRIPTION</h3><hr><br>';
        $html .= '<div class="annex-box">' . nl2br(htmlspecialchars($jdText)) . '</div>';
    }

    $html .= '</body></html>';

    echo json_encode(['status' => 'success', 'html_content' => $html]);
}

// ------------------------------------------------------------------------------
// 3. SAVE METADATA TO DATABASE
// ------------------------------------------------------------------------------
function saveContractData($conn, $userId) {
    // Enable Exception Mode
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

    try {
        // 1. INPUTS
        $ref = $_POST['contract_ref'];
        if (empty($ref)) throw new Exception("Contract Reference is missing.");

        // SANITIZE FILENAME (CRITICAL FIX)
        // Replaces "SLAS/DG/HR/..." with "SLAS-DG-HR-..." for the file system
        $safeFileName = str_replace(['/', '\\'], '-', $ref) . '.pdf';

        $probationMonths = (isset($_POST['has_probation']) && $_POST['has_probation'] === 'true') ? (int)$_POST['probation_months'] : 0;
        $hasAnnex = (isset($_POST['include_jd']) && $_POST['include_jd'] === 'true') ? 1 : 0;
        $grossSalary = $_POST['gross_salary'] ?? 0;
        $uuid = bin2hex(random_bytes(16));

        // 2. SAVE HISTORY (Insert or Update)
        $checkStmt = $conn->prepare("SELECT contract_uuid FROM hr_contract_history WHERE contract_reference = ?");
        $checkStmt->bind_param('s', $ref);
        $checkStmt->execute();
        $existing = $checkStmt->get_result()->fetch_assoc();
        $checkStmt->close();

        if ($existing) {
            $uuid = $existing['contract_uuid'];
            $stmt = $conn->prepare("UPDATE hr_contract_history SET contract_start_date=?, probation_months=?, place_of_birth=?, salary_category=?, salary_grade=?, gross_salary=?, job_description_text=?, has_annex=?, generated_by=?, created_at=NOW() WHERE contract_uuid=?");
            $stmt->bind_param('sissssdsis', $_POST['start_date'], $probationMonths, $_POST['place_of_birth'], $_POST['salary_category'], $_POST['salary_grade'], $grossSalary, $_POST['jd_text'], $hasAnnex, $userId, $uuid);
        } else {
            $stmt = $conn->prepare("INSERT INTO hr_contract_history (contract_uuid, employee_id, contract_reference, generated_by, status, contract_start_date, probation_months, place_of_birth, salary_category, salary_grade, gross_salary, job_description_text, has_annex, vault_file_path) VALUES (?, ?, ?, ?, 'SIGNED', ?, ?, ?, ?, ?, ?, ?, ?, NULL)");
            $stmt->bind_param('sssisisisssi', $uuid, $_POST['target_employee_id'], $ref, $userId, $_POST['start_date'], $probationMonths, $_POST['place_of_birth'], $_POST['salary_category'], $_POST['salary_grade'], $grossSalary, $_POST['jd_text'], $hasAnnex);
        }
        $stmt->execute();
        $stmt->close();

        // 3. REGISTER IN VAULT
        // We use $safeFileName for the storage path
        $vaultSql = "INSERT IGNORE INTO document_vault_master (doc_uuid, doc_reference, file_context, folder_ref, doc_type, user_filename, description, storage_path, file_mime, file_size, uploaded_by, uploaded_by_name, status, uploaded_at) VALUES (?, ?, 'OVH', 'HR', 'CONTRACT', ?, 'Employment Contract Record', ?, 'application/pdf', 0, ?, ?, 'VERIFIED', NOW())";
        
        $stmtV = $conn->prepare($vaultSql);
        $uploaderName = $_SESSION['auth']['username'] ?? 'System';
        
        // Note: We use $safeFileName for the user_filename AND storage_path to be safe
        $stmtV->bind_param('ssssss', $uuid, $ref, $safeFileName, $safeFileName, $userId, $uploaderName);
        $stmtV->execute();
        $stmtV->close();

        echo json_encode(['status'=>'success', 'message'=>'Contract Saved Successfully']);

    } catch (Exception $e) {
        http_response_code(200); 
        echo json_encode(['status'=>'error', 'message'=> 'System Error: ' . $e->getMessage()]);
    }
}
?>