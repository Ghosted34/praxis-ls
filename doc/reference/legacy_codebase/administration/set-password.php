<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/init.php';
$csrf = csrf_token();
$tokenFromUrl = htmlspecialchars((string)($_GET['token'] ?? ''));
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Smart LS | Set Password</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">
  <div class="container py-5">
    <div class="row justify-content-center">
      <div class="col-md-6">
        <div class="card shadow-sm border-0">
          <div class="card-body p-4">
            <h1 class="h5 fw-bold mb-3">Set Password</h1>

            <div id="alertBox" class="alert d-none" role="alert"></div>

            <form id="setForm" onsubmit="event.preventDefault(); submitSet();">
              <input type="hidden" id="csrf_token" value="<?php echo $csrf; ?>">
              <input type="hidden" id="token" value="<?php echo $tokenFromUrl; ?>">

              <div class="mb-3">
                <label class="form-label">New Password</label>
                <input id="password" type="password" class="form-control" required minlength="8">
              </div>
              <div class="mb-3">
                <label class="form-label">Confirm Password</label>
                <input id="confirm" type="password" class="form-control" required minlength="8">
              </div>

              <button class="btn btn-dark w-100" id="btn">Save Password</button>
            </form>

            <div class="small text-muted mt-3">
              After setting your password, you will be redirected to login.
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
async function submitSet(){
  const btn = document.getElementById('btn');
  btn.disabled = true;

  const fd = new FormData();
  fd.append('csrf_token', document.getElementById('csrf_token').value);
  fd.append('token', document.getElementById('token').value);
  fd.append('password', document.getElementById('password').value);
  fd.append('confirm', document.getElementById('confirm').value);

  try{
    const res = await fetch('./api/auth/set_password.php', { method:'POST', body: fd, headers:{'Accept':'application/json'} });
    const data = await res.json().catch(()=> ({}));
    if(!res.ok || !data.ok) throw new Error(data.message || 'Failed.');
    showAlert('success', data.message || 'Updated.');
    setTimeout(()=> window.location.href = './login.php', 800);
  }catch(e){
    showAlert('danger', e.message || 'Error');
  }finally{
    btn.disabled = false;
  }
}
</script>
</body>
</html>
