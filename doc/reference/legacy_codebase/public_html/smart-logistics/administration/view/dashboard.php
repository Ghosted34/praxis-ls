<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Smart LS | Dashboard</title>

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

    .app-wrap { height:100vh; display:flex; overflow:hidden; }
    .sidebar {
      width: 260px; min-width:260px;
      background: rgba(255,255,255,0.95);
      border-right:1px solid #f1f5f9;
      box-shadow:0 8px 30px rgba(2,6,23,0.04);
      display:flex;flex-direction:column;
    }
    .brand { height:80px; display:flex; align-items:center; padding-left:1.5rem; border-bottom:1px solid #f3f4f6; }
    .brand-mark-small { width:40px;height:40px;border-radius:10px;background:var(--smartOrange);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800; }

    .app-header {
      height:80px;
      background: rgba(255,255,255,0.85);
      backdrop-filter: blur(6px);
      border-bottom:1px solid #f1f5f9;
      display:flex; align-items:center; justify-content:space-between;
      padding:0 2rem;
      z-index:10;
    }

    .hero {
      background: linear-gradient(90deg, rgba(35,31,32,1) 0%, rgba(68,68,72,1) 100%);
      border-radius:16px;
      padding:2rem;
      color:#fff;
      box-shadow:0 20px 40px rgba(7,8,26,0.4);
    }

    .kpi-card { border-radius:16px; padding:1.5rem; box-shadow:0 8px 24px rgba(15,23,42,0.04); background:linear-gradient(180deg,#fff,#fbfdff); border:1px solid #eef2f6; }
    .kpi-card .badge-circle { width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center; font-size:18px; }

    .activity .item { padding:1rem; border-bottom:1px solid #f3f4f6; display:flex; gap:1rem; align-items:flex-start; }
    .activity .item:last-child { border-bottom:0; }

    @keyframes pulse-ring { 0%{ transform:scale(.33); } 80%,100%{ opacity:0; } }
    @keyframes pulse-dot { 0%{ transform:scale(.8);}50%{transform:scale(1);}100%{transform:scale(.8);} }
    .clock-active { position:relative; overflow:visible; }
    .clock-active::before{
      content:""; position:absolute; inset:0; border-radius:50%;
      background: rgba(20,184,166,0.18); animation:pulse-ring 1.25s cubic-bezier(.215,.61,.355,1) infinite;
    }

    .scrollable { overflow:auto; }
    .scrollable::-webkit-scrollbar { width:6px; height:6px; }
    .scrollable::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:10px; }

    @media (max-width:991px){
      .sidebar { width:72px; min-width:72px; }
      .nav-text { display:none; }
      .app-header { padding:0 1rem; }
      .hero { padding:1rem; }
    }
  </style>
</head>
<body>

  <div id="main-app" class="w-100 h-100">
    <div class="app-wrap">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="brand">
          <div class="d-flex align-items-center">
            <div class="me-3">
              <div class="brand-mark-small">S</div>
            </div>
            <div class="d-none d-lg-block">
              <div style="font-weight:900;letter-spacing:0.5px;">SMART <span style="color:var(--smartOrange)">LS</span></div>
            </div>
          </div>
        </div>

        <nav class="flex-grow-1 p-3 scrollable">
          <div class="small text-muted fw-bold mb-2">Workspace</div>

          <a href="#" class="d-flex align-items-center gap-2 p-2 rounded-3 text-decoration-none" style="background:#eef6ff;color:var(--smartBlue);font-weight:700;">
            <i class="fa-solid fa-grip-vertical"></i><span class="nav-text ms-2">Dashboard</span>
          </a>

          <a href="#" class="d-flex align-items-center gap-2 p-2 mt-2 rounded-3 text-decoration-none text-muted">
            <i class="fa-solid fa-folder-open"></i><span class="nav-text ms-2">Ops Files</span>
          </a>

          <a href="#" class="d-flex align-items-center gap-2 p-2 mt-2 rounded-3 text-decoration-none text-muted">
            <i class="fa-solid fa-funnel-dollar"></i><span class="nav-text ms-2">CRM & Sales</span>
          </a>

          <div class="small text-muted fw-bold mt-4 mb-2">Master Data</div>

          <a href="client_master.html" class="d-flex align-items-center gap-2 p-2 rounded-3 text-decoration-none text-muted">
            <i class="fa-solid fa-users"></i><span class="nav-text ms-2">Clients</span>
          </a>

          <a href="supplier_master.html" class="d-flex align-items-center gap-2 p-2 rounded-3 text-decoration-none text-muted mt-2">
            <i class="fa-solid fa-truck-field"></i><span class="nav-text ms-2">Suppliers</span>
          </a>

          <a href="employee_master.html" class="d-flex align-items-center gap-2 p-2 rounded-3 text-decoration-none text-muted mt-2">
            <i class="fa-solid fa-id-badge"></i><span class="nav-text ms-2">Employees</span>
          </a>

          <a href="financial_dictionary.html" class="d-flex align-items-center gap-2 p-2 rounded-3 text-decoration-none text-muted mt-2">
            <i class="fa-solid fa-book"></i><span class="nav-text ms-2">Fin. Dictionary</span>
          </a>
        </nav>

        <div class="p-3 border-top">
          <button class="btn btn-sm w-100 text-danger bg-white border" onclick="logout()">
            <i class="fa-solid fa-power-off me-2"></i> Sign Out
          </button>
        </div>
      </aside>

      <!-- Main content -->
      <div class="flex-fill d-flex flex-column" style="min-width:0;">
        <header class="app-header">
          <h2 class="h5 fw-bold mb-0">Dashboard</h2>

          <div class="d-flex align-items-center gap-4">
            <div class="d-flex align-items-center bg-white border rounded-pill shadow-sm p-2 pe-3">
              <button id="btn-clock" class="btn btn-sm p-2 rounded-circle bg-light text-muted me-3" onclick="toggleClock()">
                <i class="fa-solid fa-fingerprint"></i>
              </button>
              <div class="text-end">
                <div id="clock-status-text" class="small text-muted">Clocked Out</div>
                <div id="clock-timer" class="fw-bold" style="font-family: 'Courier New', monospace;">00:00:00</div>
              </div>
            </div>

            <div class="d-flex align-items-center ps-3 border-start">
              <div class="d-none d-md-block text-end me-3">
                <div id="user-name" class="fw-bold">Admin User</div>
                <div id="user-role" class="small" style="color:var(--smartBlue);font-weight:700;">SYSTEM ADMIN</div>
              </div>
              <div style="width:44px;height:44px;border-radius:50%;background:var(--smartCharcoal);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;">AD</div>
            </div>
          </div>
        </header>

        <main class="flex-fill overflow-auto p-4">
          <div class="container-fluid p-0">
            <div class="hero d-flex justify-content-between align-items-center mb-4">
              <div>
                <h1 class="h3 fw-bold mb-1">Good Morning, <span id="welcome-name">Admin</span>!</h1>
                <p class="mb-0 text-muted">Here is what's happening at Smart LS today.</p>
              </div>
              <div class="text-end d-none d-lg-block">
                <div class="small text-muted">System Status</div>
                <div class="fw-bold text-success"><i class="fa-solid fa-circle-check me-1"></i> Operational</div>
              </div>
            </div>

            <div class="row g-3 mb-4">
              <div class="col-md-4">
                <div class="kpi-card">
                  <div class="d-flex align-items-center mb-3">
                    <div class="badge-circle bg-orange-100 text-orange-600 me-3"><i class="fa-solid fa-hand-holding-dollar"></i></div>
                    <div>
                      <div class="small text-muted">Commercial</div>
                      <div class="h5 fw-bold">12 <span class="small text-muted">New Leads</span></div>
                    </div>
                  </div>
                  <div class="small text-orange-600 fw-bold">View Pipeline <i class="fa-solid fa-arrow-right ms-1"></i></div>
                </div>
              </div>

              <div class="col-md-4">
                <div class="kpi-card">
                  <div class="d-flex align-items-center mb-3">
                    <div class="badge-circle bg-blue-100 text-blue-600 me-3"><i class="fa-solid fa-ship"></i></div>
                    <div>
                      <div class="small text-muted">Operations</div>
                      <div class="h5 fw-bold">45 <span class="small text-muted">Active Files</span></div>
                    </div>
                  </div>
                  <div class="small text-blue-600 fw-bold">Go to Registry <i class="fa-solid fa-arrow-right ms-1"></i></div>
                </div>
              </div>

              <div class="col-md-4">
                <div class="kpi-card">
                  <div class="d-flex align-items-center mb-3">
                    <div class="badge-circle bg-teal-100 text-teal-600 me-3"><i class="fa-solid fa-file-invoice-dollar"></i></div>
                    <div>
                      <div class="small text-muted">Finance</div>
                      <div class="h5 fw-bold">8 <span class="small text-muted">Pending Approvals</span></div>
                    </div>
                  </div>
                  <div class="small text-teal-600 fw-bold">Review Requests <i class="fa-solid fa-arrow-right ms-1"></i></div>
                </div>
              </div>
            </div>

            <div class="kpi-card activity">
              <h5 class="fw-bold mb-3">Recent System Activity</h5>

              <div class="item">
                <div style="width:40px;height:40px;border-radius:50%;background:#ebf5ff;color:var(--smartBlue);display:flex;align-items:center;justify-content:center;">
                  <i class="fa-solid fa-file-circle-plus"></i>
                </div>
                <div class="flex-fill ms-3">
                  <div class="fw-bold">New Ops File Created</div>
                  <div class="small text-muted">File <span style="font-family:monospace;color:var(--smartBlue)">SL001234</span> created by <span class="fw-bold">John Doe</span> (Sales)</div>
                </div>
                <div class="text-muted small">10:42 AM</div>
              </div>

              <div class="item">
                <div style="width:40px;height:40px;border-radius:50%;background:#fff7ed;color:var(--smartOrange);display:flex;align-items:center;justify-content:center;">
                  <i class="fa-solid fa-user-plus"></i>
                </div>
                <div class="flex-fill ms-3">
                  <div class="fw-bold">Client Added</div>
                  <div class="small text-muted">Client <span class="fw-bold">TotalEnergies</span> added to Master Registry</div>
                </div>
                <div class="text-muted small">09:15 AM</div>
              </div>

              <div class="item">
                <div style="width:40px;height:40px;border-radius:50%;background:#fff1f2;color:#ef4444;display:flex;align-items:center;justify-content:center;">
                  <i class="fa-solid fa-ban"></i>
                </div>
                <div class="flex-fill ms-3">
                  <div class="fw-bold">Login Failed</div>
                  <div class="small text-muted">Multiple failed attempts detected for user <span style="font-family:monospace">m.ross</span></div>
                </div>
                <div class="text-muted small">08:30 AM</div>
              </div>

            </div>
          </div>
        </main>
      </div>
    </div>
  </div>

  <!-- Bootstrap JS + Popper -->
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

  <script>
    function logout(){
      if(confirm('Are you sure you want to sign out?')){
        window.location.href = 'login.html';
      }
    }

    let isClockedIn = false;
    let clockInterval;
    let seconds = 0;

    function toggleClock(){
      const btn = document.getElementById('btn-clock');
      const statusText = document.getElementById('clock-status-text');

      if(!isClockedIn){
        isClockedIn = true;
        btn.classList.add('clock-active');
        btn.style.backgroundColor = 'var(--smartTeal)';
        btn.style.color = '#fff';
        statusText.innerText = 'CLOCKED IN';
        statusText.style.color = 'var(--smartTeal)';
        clockInterval = setInterval(updateTimer, 1000);
        alert('Clock In Successful: ' + new Date().toLocaleTimeString());
      } else {
        if(confirm('End shift and Clock Out?')){
          isClockedIn = false;
          btn.classList.remove('clock-active');
          btn.style.backgroundColor = '';
          btn.style.color = '';
          statusText.innerText = 'CLOCKED OUT';
          statusText.style.color = '';
          clearInterval(clockInterval);
          alert('Shift Ended. Total Time: ' + document.getElementById('clock-timer').innerText);
          seconds = 0;
          document.getElementById('clock-timer').innerText = '00:00:00';
        }
      }
    }

    function updateTimer(){
      seconds++;
      const h = String(Math.floor(seconds/3600)).padStart(2,'0');
      const m = String(Math.floor((seconds % 3600)/60)).padStart(2,'0');
      const s = String(seconds % 60).padStart(2,'0');
      document.getElementById('clock-timer').innerText = `${h}:${m}:${s}`;
    }

    // Optional: set welcome name from query or default
    (function(){
      const urlName = new URLSearchParams(window.location.search).get('user');
      if(urlName) document.getElementById('welcome-name').innerText = urlName;
    })();
  </script>
</body>
</html>
