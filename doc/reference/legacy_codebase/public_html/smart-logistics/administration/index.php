<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Smart LS | Login</title>

  <!-- Bootstrap 5 -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <!-- Font Awesome -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">

  <!-- Google Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root{
      --smartBlue:#1F99D8;
      --smartOrange:#EE7D04;
      --smartCharcoal:#231F20;
      --smartTeal:#14B8A6;
    }
    body {
      font-family: 'Manrope', sans-serif;
      background: linear-gradient(135deg,#f1f5f9 0%, #e6f6ff 100%);
      color: var(--smartCharcoal);
      height:100vh;
      overflow:hidden;
    }

    #login-screen {
      position:fixed;
      inset:0;
      z-index:50;
      display:flex;
      align-items:center;
      justify-content:center;
      background-size:cover;
      background-position:center;
      background-image: url('https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?ixlib=rb-1.2.1&auto=format&fit=crop&w=1950&q=80');
    }
    #login-screen::after{
      content:"";
      position:absolute;
      inset:0;
      background: rgba(15,23,42,0.6);
      backdrop-filter: blur(6px);
    }
    .login-card {
      position:relative;
      z-index:2;
      width:100%;
      max-width:460px;
      border-radius:18px;
      overflow:hidden;
      background: #fff;
      box-shadow: 0 20px 60px rgba(2,6,23,0.45);
    }
    .brand-mark {
      width:64px;height:64px;border-radius:14px;
      background:var(--smartOrange); color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:900;font-size:28px; box-shadow:0 8px 26px rgba(238,125,4,0.18);
    }
    .smart-input { transition: all .18s ease; }
    .smart-input:focus { border-color: var(--smartBlue); box-shadow: 0 0 0 6px rgba(31,153,216,0.06); outline:none; }

    .small-note { font-size: 11px; color: #6b7280; }
  </style>
</head>
<body>

  <div id="login-screen" aria-hidden="false">
    <div class="login-card">
      <div class="p-4 text-center" style="border-bottom:1px solid #f3f4f6;">
        <div class="d-flex justify-content-center mb-3">
          <div class="brand-mark">S</div>
        </div>
        <h1 class="h5 fw-bold mb-1" style="font-family: 'Montserrat', sans-serif;">SMART LS <span style="color:var(--smartOrange)">HUB</span></h1>
        <p class="text-muted small">Digital Logistics Operating System</p>
      </div>

      <form class="p-4" id="login-form" onsubmit="event.preventDefault(); attemptLogin();">
        <div class="mb-3">
          <label class="form-label small text-uppercase text-muted fw-bold">Username / Email</label>
          <div class="input-group">
            <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-user text-muted"></i></span>
            <input id="login-user" class="form-control smart-input" type="text" value="admin" placeholder="Enter ID" style="border-left:0;">
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label small text-uppercase text-muted fw-bold">Password</label>
          <div class="input-group">
            <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-lock text-muted"></i></span>
            <input id="login-pass" class="form-control smart-input" type="password" value="password" placeholder="••••••••" style="border-left:0;">
          </div>
        </div>

        <div class="d-flex justify-content-between align-items-center mb-3 small">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="rememberCheck">
            <label class="form-check-label text-muted" for="rememberCheck">Remember me</label>
          </div>
          <a href="#" class="text-decoration-none" style="color:var(--smartBlue)">Forgot Password?</a>
        </div>

        <button id="login-btn" type="submit" class="btn btn-dark w-100 py-2 fw-bold">
          <i class="fa-solid fa-right-to-bracket me-2"></i> Secure Login
        </button>
      </form>

      <div class="bg-light small text-center p-2" style="border-top:1px solid #f3f4f6;">
        System Version 1.0.0 | ISO 9001 Compliant Access Control
      </div>
    </div>
  </div>

  <!-- Bootstrap JS + Popper -->
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

  <script>
    function attemptLogin(){
      const user = document.getElementById('login-user').value;
      const btn = document.getElementById('login-btn');
      const originalHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-2"></i> Authenticating...';
      setTimeout(()=>{
        // Navigate to dashboard page on "success"
        window.location.href = 'view/dashboard.php';
      }, 700);
    }
  </script>
</body>
</html>
