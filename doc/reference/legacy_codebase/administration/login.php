<?php
declare(strict_types=1);

ini_set('display_errors', '1');         // turn OFF in production after debugging
ini_set('display_startup_errors', '1'); // turn OFF in production after debugging
error_reporting(E_ALL);

register_shutdown_function(function () {
  $e = error_get_last();
  if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
    // Do not leave this enabled publicly in production.
    header('Content-Type: text/plain; charset=utf-8');
    echo "FATAL: {$e['message']}\nFILE: {$e['file']}\nLINE: {$e['line']}\n";
  }
});

require_once __DIR__ . '/includes/init.php';

if (!empty($_SESSION['auth']['user_id'])) {
  $role = strtoupper((string)($_SESSION['auth']['role'] ?? ''));

  $roleLanding = [
    'ADMIN'      => 'view/admin/index.php',
    'FINANCE'    => 'view/finance/index.php',
    'SALES'      => 'view/sales/index.php',
    'OPERATIONS' => 'view/operations/index.php',
    'MANAGEMENT' => 'view/management/index.php',
  ];

  $redirect = $roleLanding[$role] ?? 'view/admin/index.php';

  header('Location: ' . $redirect);
  exit;
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Smart LS | Hub Access</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">

  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root{
      --smartBlue: #1F99D8;
      --smartOrange: #EE7D04;
      --smartCharcoal: #0f172a;
    }
    body {
      font-family: 'Manrope', sans-serif;
      height: 100vh;
      overflow: hidden;
      margin: 0;
      background-color: var(--smartCharcoal);
    }

    /* --- FULL SCREEN BACKGROUND LAYER --- */
    .immersive-bg {
      position: absolute; inset: 0;
      background-image: url('https://smartls.cm/assets/img-webp/services-freight-forwarding.webp');
      background-size: cover;
      background-position: center;
      z-index: 0;
    }
    /* Dark overlay to make text pop and particles visible */
    .immersive-overlay {
      position: absolute; inset: 0;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(31, 153, 216, 0.4));
      z-index: 1;
    }
    /* Particle Network */
    #networkCanvas {
      position: absolute; inset: 0;
      z-index: 2;
      pointer-events: none; /* Let clicks pass through */
    }

    /* --- LAYOUT CONTAINER --- */
    .main-stage {
      position: relative; z-index: 10;
      height: 100vh;
      width: 100%;
      display: flex;
      padding: 0; /* Removing padding to allow full edge access */
    }

    /* --- LEFT SIDE: HUD (Time & Quote) --- */
    .hud-side {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      color: white;
      padding: 3rem;
    }
    .live-clock {
      font-family: 'Montserrat', sans-serif;
      font-size: 4.5rem;
      font-weight: 200;
      line-height: 1;
      letter-spacing: -2px;
      text-shadow: 0 4px 10px rgba(0,0,0,0.3);
    }
    .live-date {
      font-size: 1.1rem;
      text-transform: uppercase;
      letter-spacing: 3px;
      opacity: 0.9;
      margin-top: 0.5rem;
    }
    
    /* Glass Quote Card */
    .quote-card {
      max-width: 550px;
      background: rgba(255, 255, 255, 0.1); /* Low opacity white */
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-left: 4px solid var(--smartOrange);
      padding: 1.5rem;
      border-radius: 0 16px 16px 0;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      transition: all 0.5s ease;
    }
    .quote-text {
      font-family: 'Montserrat', serif;
      font-style: italic;
      font-size: 1.15rem;
      line-height: 1.6;
      margin-bottom: 0.75rem;
      color: #f1f5f9;
    }
    .quote-author {
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--smartBlue); /* Brand color pop */
      letter-spacing: 1px;
    }

    /* --- RIGHT SIDE: GLASS LOGIN FORM --- */
    .form-side {
      width: 500px; /* Fixed width for the sidebar feel */
      display: flex;
      align-items: center;
      /* FIXED: Pushed to the right edge */
      justify-content: center; 
      padding: 2rem;
      background: transparent; /* Container is transparent */
    }
    
    .glass-login {
      width: 100%;
      padding: 2.5rem;
      border-radius: 20px;
      
      /* THE GLASSMORPHISM MAGIC */
      background: rgba(255, 255, 255, 0.60); /* Increased opacity slightly for readability */
      backdrop-filter: blur(25px);            /* Heavier Blur */
      -webkit-backdrop-filter: blur(25px);
      border: 1px solid rgba(255, 255, 255, 0.5);
      box-shadow: -10px 0 40px rgba(0,0,0,0.2); /* Shadow casting to the left */
    }

    /* Form Typography */
    .form-heading {
      font-family: 'Montserrat', sans-serif;
      font-weight: 600;
      color: var(--smartCharcoal);
      margin-bottom: 0.5rem;
      font-size: 1rem;
    }
    .form-subtext {
      font-size: 0.65rem;
      color: #475569;
      line-height: 1.4;
      margin-bottom: 1rem;
    }
    .dynamic-greet {
      color: var(--smartOrange);
      font-weight: 600;
      font-size: 1rem;
      margin-bottom: 0.25rem;
    }

    /* Modern Inputs */
    .input-wrapper { position: relative; margin-bottom: 1.25rem; }
    .input-wrapper i.icon-left {
      position: absolute; left: 1rem; top: 50%; transform: translateY(-50%);
      color: #64748b; z-index: 5;
    }
    .input-wrapper i.icon-eye {
      position: absolute; right: 1rem; top: 50%; transform: translateY(-50%);
      color: #64748b; z-index: 5; cursor: pointer;
      transition: color 0.2s;
    }
    .input-wrapper i.icon-eye:hover { color: var(--smartBlue); }

    .smart-input {
      width: 100%;
      padding: 0.8rem 2.5rem 0.8rem 2.8rem;
      background-color: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      font-size: 0.95rem;
      color: var(--smartCharcoal);
      transition: all 0.2s ease;
      font-weight: 600;
    }
    .smart-input:focus {
      background-color: #fff;
      border-color: var(--smartBlue);
      box-shadow: 0 0 0 4px rgba(31,153,216,0.15);
      outline: none;
    }

    .btn-glass {
      background: var(--smartCharcoal);
      color: white;
      font-weight: 700;
      border-radius: 10px;
      padding: 12px;
      border: none;
      transition: all 0.3s;
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.15);
    }
    .btn-glass:hover {
      background: #000;
      transform: translateY(-2px);
      box-shadow: 0 15px 30px rgba(0,0,0,0.25);
    }

    /* Mobile Responsive */
    @media (max-width: 900px) {
      .hud-side { display: none; }
      .form-side { width: 100%; padding: 1.5rem; justify-content: center;}
      .glass-login { max-width: 450px; }
      .main-stage { flex-direction: column; }
    }
  </style>
</head>
<body>

  <div class="immersive-bg"></div>
  <div class="immersive-overlay"></div>
  <canvas id="networkCanvas"></canvas>

  <div class="main-stage">
    
    <div class="hud-side">
      <div class="mt-2">
        <div id="clockDisplay" class="live-clock">--:--:--</div>
        <div id="dateDisplay" class="live-date">Initializing Network...</div>
      </div>

      <div class="mb-4">
        <div class="quote-card">
          <div class="quote-text" id="quoteText">"..."</div>
          <div class="quote-author" id="quoteAuthor"></div>
        </div>
      </div>
    </div>

    <div class="form-side">
      <div class="glass-login">
        
        <div class="text-center mb-3">
          <img src="https://smartls.cm/assets/img-webp/logo-smart.webp" alt="Smart LS" style="height: 50px; margin-bottom: 0.5rem;">
          <div id="greetingDisplay" class="dynamic-greet">Welcome</div>
          <div class="small text-muted fw-bold mb-3" id="locationDisplay"><i class="fa-solid fa-location-dot me-1"></i> Detecting Location...</div>
        </div>

        <h2 class="form-heading">Streamline Your Logistics Operations</h2>
        <p class="form-subtext">
          Welcome to the Smart LS Digital Operating System. Securely manage sales, freight, operations, procurement and finance in one centralized hub
        </p>

        <form id="login-form" onsubmit="event.preventDefault(); attemptLogin();">
          <div id="alertBox" class="alert d-none mb-3 small shadow-sm" role="alert"></div>

          <div class="input-wrapper">
            <i class="fa-regular fa-user icon-left"></i>
            <input id="login-user" class="smart-input" type="text" placeholder="Username" autocomplete="username">
          </div>

          <div class="input-wrapper">
            <i class="fa-regular fa-lock icon-left"></i>
            <input id="login-pass" class="smart-input" type="password" placeholder="Password" autocomplete="current-password">
            <i class="fa-regular fa-eye icon-eye" id="togglePassword" onclick="togglePassVisibility()"></i>
          </div>

          <div class="d-flex justify-content-between align-items-center mb-4 small">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="rememberCheck" style="cursor:pointer;">
              <label class="form-check-label text-muted fw-semibold" for="rememberCheck" style="cursor:pointer;">Remember me</label>
            </div>
            <a href="forgot-password.php" class="text-decoration-none fw-bold" style="color:var(--smartBlue)">Forgot Password?</a>
          </div>

          <button id="login-btn" type="submit" class="btn btn-glass w-100">
            Secure Access <i class="fa-solid fa-arrow-right ms-2"></i>
          </button>
        </form>
        
        <div class="text-center mt-4 text-muted" style="font-size: 11px;">
          Smart LS OS v1.0 &bull; ISO 9001 Compliant
        </div>
      </div>
    </div>

  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

  <script>
    /* =========================================
       0. INITIALIZATION (Remember Username Logic)
       ========================================= */
    document.addEventListener('DOMContentLoaded', () => {
        // Check if we have a saved username in browser memory
        const savedUser = localStorage.getItem('smart_ls_username');
        if (savedUser) {
            document.getElementById('login-user').value = savedUser;
            document.getElementById('rememberCheck').checked = true;
        }
    });

    /* =========================================
       1. INTERACTIVE UI LOGIC
       ========================================= */
    
    // --- Clock & Date ---
    function updateTime() {
      const now = new Date();
      document.getElementById('clockDisplay').textContent = now.toLocaleTimeString('en-GB', { hour12: false });
      
      const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      document.getElementById('dateDisplay').textContent = now.toLocaleDateString('en-GB', dateOptions);

      const hrs = now.getHours();
      let greet = 'Good Morning,';
      if (hrs >= 12) greet = 'Good Afternoon,';
      if (hrs >= 17) greet = 'Good Evening,';
      
      const locText = document.getElementById('locationDisplay').innerText;
      let city = "";
      if(locText.includes(',')) city = " " + locText.split(',')[0];
      
      document.getElementById('greetingDisplay').textContent = greet + city;
    }
    setInterval(updateTime, 1000);

    // --- Location Detection ---
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; 
      let city = tz.split('/')[1] || tz;
      city = city.replace('_', ' '); 
      document.getElementById('locationDisplay').innerHTML = `<i class="fa-solid fa-location-dot me-1"></i> ${city}`;
      updateTime(); 
    } catch(e) {
      document.getElementById('locationDisplay').textContent = "Secure Connection";
    }

    // --- Password Visibility Toggle ---
    function togglePassVisibility() {
      const passInput = document.getElementById('login-pass');
      const icon = document.getElementById('togglePassword');
      if (passInput.type === 'password') {
        passInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
      } else {
        passInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
      }
    }

    // --- 45 Strategy & Logistics Quotes ---
    const quotes = [
      { t: "The line between disorder and order lies in logistics.", a: "Sun Tzu" },
      { t: "Amateurs talk strategy. Professionals talk logistics.", a: "Gen. Omar Bradley" },
      { t: "Logistics comprises the means and arrangements which work out the plans of strategy.", a: "Antoine-Henri Jomini" },
      { t: "Victory waits for the commander who has everything in order.", a: "Sun Tzu" },
      { t: "My logisticians are a humorless lot... they know if my campaign fails, they are the first ones I will slay.", a: "Alexander the Great" },
      { t: "Leaders win through logistics. Vision, sure. Strategy, yes. But when you go to war, you need to connect the dots.", a: "Tom Peters" },
      { t: "Without logistics the world stops.", a: "Unknown" },
      { t: "Supply chains compete, not companies.", a: "Martin Christopher" },
      { t: "Quality is not an act, it is a habit.", a: "Aristotle" },
      { t: "Innovation distinguishes between a leader and a follower.", a: "Steve Jobs" },
      { t: "Efficiency is doing better what is already being done.", a: "Peter Drucker" },
      { t: "There is nothing so useless as doing efficiently that which should not be done at all.", a: "Peter Drucker" },
      { t: "Operations keeps the lights on, strategy provides the light.", a: "Unknown" },
      { t: "The best way to predict the future is to create it.", a: "Peter Drucker" },
      { t: "Great things in business are never done by one person.", a: "Steve Jobs" },
      { t: "Speed is the new currency of business.", a: "Marc Benioff" },
      { t: "In the middle of difficulty lies opportunity.", a: "Albert Einstein" },
      { t: "You can't manage what you can't measure.", a: "Peter Drucker" },
      { t: "A plan is nothing; planning is everything.", a: "Dwight D. Eisenhower" },
      { t: "Deliver more than expected.", a: "Larry Page" },
      { t: "Complexity is the enemy of execution.", a: "Tony Robbins" },
      { t: "Simplicity is the ultimate sophistication.", a: "Leonardo da Vinci" },
      { t: "Logistics is the ball and chain of armored warfare.", a: "Heinz Guderian" },
      { t: "If you think compliance is expensive, try non-compliance.", a: "Paul McNulty" },
      { t: "Time is the scarcest resource and unless it is managed nothing else can be managed.", a: "Peter Drucker" },
      { t: "Productivity is being able to do things that you were never able to do before.", a: "Franz Kafka" },
      { t: "The goal is not to be better than the other man, but your previous self.", a: "Dalai Lama" },
      { t: "Don't find customers for your products, find products for your customers.", a: "Seth Godin" },
      { t: "Make everything as simple as possible, but not simpler.", a: "Albert Einstein" },
      { t: "Action is the foundational key to all success.", a: "Pablo Picasso" },
      { t: "Opportunities don't happen, you create them.", a: "Chris Grosser" },
      { t: "Success usually comes to those who are too busy to be looking for it.", a: "Henry David Thoreau" },
      { t: "The secret of getting ahead is getting started.", a: "Mark Twain" },
      { t: "Strategy requires thought, tactics require observation.", a: "Max Euwe" },
      { t: "Information is the oil of the 21st century, and analytics is the combustion engine.", a: "Peter Sondergaard" },
      { t: "The details are not the details. They make the design.", a: "Charles Eames" },
      { t: "Good design is good business.", a: "Thomas Watson Jr." },
      { t: "Focus on the process, and the results will follow.", a: "Unknown" },
      { t: "Change before you have to.", a: "Jack Welch" },
      { t: "Discipline is the bridge between goals and accomplishment.", a: "Jim Rohn" },
      { t: "Work smart. Get things done.", a: "Susan Wojcicki" },
      { t: "If you don't drive your business, you will be driven out of business.", a: "B.C. Forbes" },
      { t: "To handle yourself, use your head; to handle others, use your heart.", a: "Eleanor Roosevelt" },
      { t: "Cost is important, but value is everything.", a: "Unknown" },
      { t: "Precision beats power, and timing beats speed.", a: "Conor McGregor" }
    ];
    
    const rQ = quotes[Math.floor(Math.random() * quotes.length)];
    document.getElementById('quoteText').textContent = `"${rQ.t}"`;
    document.getElementById('quoteAuthor').textContent = `— ${rQ.a}`;


    /* =========================================
       2. PARTICLE NETWORK ANIMATION
       ========================================= */
    const canvas = document.getElementById('networkCanvas');
    const ctx = canvas.getContext('2d');
    let particlesArray;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles();
    });

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.directionX = (Math.random() * 0.4) - 0.2;
        this.directionY = (Math.random() * 0.4) - 0.2;
        this.size = Math.random() * 2 + 1;
      }
      update() {
        if (this.x > canvas.width || this.x < 0) this.directionX = -this.directionX;
        if (this.y > canvas.height || this.y < 0) this.directionY = -this.directionY;
        this.x += this.directionX;
        this.y += this.directionY;
      }
      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fill();
      }
    }

    function initParticles() {
      particlesArray = [];
      let numberOfParticles = (canvas.height * canvas.width) / 10000;
      for (let i = 0; i < numberOfParticles; i++) {
        particlesArray.push(new Particle());
      }
    }

    function animateParticles() {
      requestAnimationFrame(animateParticles);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
        particlesArray[i].draw();

        for (let j = i; j < particlesArray.length; j++) {
          const dx = particlesArray[i].x - particlesArray[j].x;
          const dy = particlesArray[i].y - particlesArray[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 120) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(255, 255, 255, ${1 - distance/120})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particlesArray[i].x, particlesArray[i].y);
            ctx.lineTo(particlesArray[j].x, particlesArray[j].y);
            ctx.stroke();
          }
        }
      }
    }

    initParticles();
    animateParticles();


    /* =========================================
       3. LOGIN LOGIC (PATCHED for Backend Bypass)
       ========================================= */
    function showAlert(type, msg){
      const alertBox = document.getElementById('alertBox');
      alertBox.className = `alert alert-${type} mb-3 small shadow-sm`;
      alertBox.textContent = msg;
      alertBox.classList.remove('d-none');
    }
    // Show success message after password activation/reset
    document.addEventListener('DOMContentLoaded', () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('activated') === '1') {
        showAlert(
          'success',
          'Password reset successful. You can now log in.'
        );
      }
    });


    async function attemptLogin(){
      const identifier = document.getElementById('login-user').value.trim();
      const password = document.getElementById('login-pass').value;
      const rememberChecked = document.getElementById('rememberCheck').checked; // Get checkbox state

      if (!identifier || !password) {
        showAlert('danger', 'Please enter username and password.');
        return;
      }

      // --- NEW: Save to LocalStorage if Checked ---
      if (rememberChecked) {
          localStorage.setItem('smart_ls_username', identifier);
      } else {
          localStorage.removeItem('smart_ls_username');
      }

      const btn = document.getElementById('login-btn');
      const originalHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-2"></i> Verifying...';

      try {
        const fd = new FormData();
        fd.append('identifier', identifier);
        fd.append('password', password);
        
        // --- PATCH: ALWAYS send '0' to backend to avoid the error ---
        // We are handling the memory on the frontend now.
        fd.append('remember', '0');

        const res = await fetch('./api/auth/login.php', {
          method: 'POST',
          body: fd,
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin'
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
          throw new Error(data.message || 'Invalid login.');
        }

        window.location.href = data.redirect;

      } catch (err) {
        showAlert('danger', err.message || 'Login failed.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
      }
    }
  </script>
</body>
</html>