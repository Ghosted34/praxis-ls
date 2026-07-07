<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/init.php';
$csrf = csrf_token();
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Smart LS | Forgot Password</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">
<div class="container py-5">
  <div class="row justify-content-center">
    <div class="col-md-6">
      <div class="card shadow-sm border-0">
        <div class="card-body p-4">
          <h1 class="h5 fw-bold mb-3">Forgot Password</h1>
          <div id="alertBox" class="alert d-none" role="alert"></div>

          <form id="fpForm" onsubmit="event.preventDefault(); submitFP();">
            <input type="hidden" id="csrf_token" value="<?php echo $csrf; ?>">
            <div class="mb-3">
              <label class="form-label">Username or Email</label>
              <input id="identifier" class="form-control" required>
            </div>
            <button class="btn btn-dark w-100" id="btn">Request Link</button>
          </form>

          <div id="devLinkWrap" class="mt-3 d-none">
            <div class="small text-muted mb-1">Dev link (remove in production):</div>
            <a id="devLink" href="#" target="_blank" class="small"></a>
          </div>

          <div class="small text-muted mt-3">
            If the account exists, a secure link will be sent.
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
function showAlert(type, msg){
  const a = document.getElementById('alertBox');
  a.className = 'alert alert-' + type;
  a.textContent = msg;
  a.classList.remove('d-none');
}
async function submitFP(){
  const btn = document.getElementById('btn');
  btn.disabled = true;

  const fd = new FormData();
  fd.append('csrf_token', document.getElementById('csrf_token').value);
  fd.append('identifier', document.getElementById('identifier').value.trim());
  fd.append('purpose', 'RESET');

  try{
    const res = await fetch('./api/auth/request_password_link.php', { method:'POST', body: fd, headers:{'Accept':'application/json'} });
    const data = await res.json().catch(()=> ({}));
    if(!res.ok || !data.ok) throw new Error(data.message || 'Failed.');
    showAlert('success', data.message || 'Requested.');

    if (data.dev_link) {
      const wrap = document.getElementById('devLinkWrap');
      const a = document.getElementById('devLink');
      a.href = data.dev_link;
      a.textContent = data.dev_link;
      wrap.classList.remove('d-none');
    }
  }catch(e){
    showAlert('danger', e.message || 'Error');
  }finally{
    btn.disabled = false;
  }
}
</script>
</body>
</html>
