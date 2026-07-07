<?php
declare(strict_types=1);

ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

register_shutdown_function(function () {
  $e = error_get_last();
  if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
    header('Content-Type: text/plain; charset=utf-8', true, 500);
    echo "FATAL: {$e['message']}\nFILE: {$e['file']}\nLINE: {$e['line']}\n";
  }
});
if (session_status() === PHP_SESSION_NONE) session_start();

if (empty($_SESSION['csrf_token'])) {
  $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}
$token = $_SESSION['csrf_token'];


require_once __DIR__ . '/includes/init.php';


// If you already have login, enforce it here:
// require_once __DIR__ . '/includes/auth_guard.php';

?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Add Admin | Smart</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">
  <div class="container py-5">
    <div class="row justify-content-center">
      <div class="col-lg-9 col-xl-8">
        <div class="card shadow-sm border-0">
          <div class="card-body p-4 p-md-5">
            <div class="d-flex align-items-center justify-content-between mb-4">
              <div>
                <h1 class="h4 mb-1">Create Admin (Employee Master)</h1>
                <div class="text-muted small">Adds a new employee record into <code>employee_master</code>.</div>
              </div>
              <span class="badge text-bg-primary">Administration</span>
            </div>

            <div id="alertBox" class="alert d-none" role="alert"></div>

            <form id="adminForm" class="row g-3" novalidate>
              <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($token); ?>">

              <div class="col-md-4">
                <label class="form-label">Employee ID</label>
                <input name="employee_id" class="form-control" placeholder="SL-001" required maxlength="20">
                <div class="form-text">Format: SL-XXX (you control enforcement in API)</div>
              </div>

              <div class="col-md-8">
                <label class="form-label">Full Name</label>
                <input name="full_name" class="form-control" required maxlength="150">
              </div>

              <div class="col-md-6">
                <label class="form-label">Signatory Name (PDF)</label>
                <input name="signatory_name" class="form-control" required maxlength="100">
              </div>

              <div class="col-md-6">
                <label class="form-label">Email</label>
                <input name="email" type="email" class="form-control" required maxlength="100">
              </div>

              <div class="col-md-6">
                <label class="form-label">Department</label>
                <select name="department" class="form-select" required>
                  <option value="">Select...</option>
                  <option>SALES</option>
                  <option>OPERATIONS</option>
                  <option>FINANCE</option>
                  <option>ADMIN</option>
                  <option>MANAGEMENT</option>
                </select>
              </div>

              <div class="col-md-6">
                <label class="form-label">Job Title</label>
                <input name="job_title" class="form-control" required maxlength="100" placeholder="System Administrator">
              </div>
              <hr class="my-2">

                <div class="col-md-6">
                <label class="form-label">Username</label>
                <input name="username" class="form-control" required maxlength="50" placeholder="victor.admin">
                </div>

                <div class="col-md-6">
                <label class="form-label">Password</label>
                <input name="password" type="password" class="form-control" required minlength="8" placeholder="Minimum 8 characters">
                <div class="form-text">This will be stored as a secure hash, not plaintext.</div>
                </div>

                <div class="col-12">
                <label class="form-label">Authority Capabilities</label>
                <div class="d-flex flex-wrap gap-3">
                    <div class="form-check">
                    <input class="form-check-input" type="checkbox" name="authority_capabilities[]" value="ISSUER" id="capIssuer" checked>
                    <label class="form-check-label" for="capIssuer">ISSUER</label>
                    </div>
                    <div class="form-check">
                    <input class="form-check-input" type="checkbox" name="authority_capabilities[]" value="VALIDATOR" id="capValidator">
                    <label class="form-check-label" for="capValidator">VALIDATOR</label>
                    </div>
                    <div class="form-check">
                    <input class="form-check-input" type="checkbox" name="authority_capabilities[]" value="APPROVER" id="capApprover">
                    <label class="form-check-label" for="capApprover">APPROVER</label>
                    </div>
                </div>
                <div class="form-text">Select at least one.</div>
                </div>


              <div class="col-md-6">
                <label class="form-label">Employment Type</label>
                <select name="employment_type" class="form-select" required>
                  <option value="">Select...</option>
                  <option>PERMANENT</option>
                  <option>CONTRACT</option>
                  <option>PROBATION</option>
                  <option>CONSULTANT</option>
                </select>
              </div>

              <div class="col-md-6">
                <label class="form-label">Join Date</label>
                <input name="join_date" type="date" class="form-control" required>
              </div>

              <hr class="my-2">

              <div class="col-md-4">
                <label class="form-label">Date of Birth (optional)</label>
                <input name="dob" type="date" class="form-control">
              </div>

              <div class="col-md-4">
                <label class="form-label">Marital Status</label>
                <select name="marital_status" class="form-select">
                  <option value="SINGLE" selected>SINGLE</option>
                  <option value="MARRIED">MARRIED</option>
                </select>
              </div>

              <div class="col-md-4">
                <label class="form-label">Phone (optional)</label>
                <input name="phone" class="form-control" maxlength="30">
              </div>

              <div class="col-12">
                <label class="form-label">Address (optional)</label>
                <textarea name="address" class="form-control" rows="2"></textarea>
              </div>

              <hr class="my-2">

              <div class="col-md-4">
                <label class="form-label">Base Salary</label>
                <input name="base_salary" type="number" step="0.01" min="0" class="form-control" value="0.00">
              </div>

              <div class="col-md-4">
                <label class="form-label">Payment Method</label>
                <select name="payment_method" class="form-select">
                  <option value="BANK_TRANSFER" selected>BANK_TRANSFER</option>
                  <option value="CASH">CASH</option>
                  <option value="CHEQUE">CHEQUE</option>
                </select>
              </div>

              <div class="col-md-4">
                <label class="form-label">Status</label>
                <select name="status" class="form-select">
                  <option value="ACTIVE" selected>ACTIVE</option>
                  <option value="EXITED">EXITED</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
              </div>

              <div class="col-12">
                <label class="form-label">Bank Details (optional)</label>
                <textarea name="bank_details" class="form-control" rows="2" placeholder="Account name, bank, IBAN/Acct No..."></textarea>
              </div>

              <div class="col-12 d-flex gap-2 pt-2">
                <button class="btn btn-primary" type="submit" id="btnSubmit">
                  Create Admin
                </button>
                <button class="btn btn-outline-secondary" type="reset">Reset</button>
              </div>
            </form>

            <div class="text-muted small mt-4">
              Note: For real production, store salary/bank details encrypted and restrict access server-side.
            </div>

          </div>
        </div>
      </div>
    </div>
  </div>

<script>
const form = document.getElementById('adminForm');
const alertBox = document.getElementById('alertBox');
const btnSubmit = document.getElementById('btnSubmit');

function showAlert(type, msg) {
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = msg;
  alertBox.classList.remove('d-none');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.classList.add('d-none');

  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Creating...';

  try {
    const res = await fetch('./api/auth/create_admin.php', {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json' }
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data.message || 'Failed to create admin.');
    }

    showAlert('success', data.message || 'Admin created successfully.');
    form.reset();
  } catch (err) {
    showAlert('danger', err.message || 'Unexpected error.');
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Create Admin';
  }
});
</script>
</body>
</html>
