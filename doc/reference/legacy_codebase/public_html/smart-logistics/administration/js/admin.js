// ============================================================
// GLOBAL ATTENDANCE CLOCK (ADMIN / FINANCE / SALES / OPS)
// Path is FIXED as requested
// ============================================================

// Use RELATIVE path exactly as you specified
const ATTENDANCE_API = '../../api/attendance';

// ------------------------------------------------------------
// Refresh clock button state from server
// ------------------------------------------------------------
async function refreshClockState() {
  const btn = document.getElementById('btn-clock');
  if (!btn) return;

  try {
    const res = await fetch(`${ATTENDANCE_API}/status.php`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    });

    // If redirected to login or error page, res.json() will fail
    let data;
    try {
      data = await res.json();
    } catch {
      console.warn('Attendance status returned non-JSON (auth redirect or PHP error)');
      return;
    }

    const icon = btn.querySelector('i');
    const span = btn.querySelector('span');

    const row = data.data || null;

    // --------------------------------------------------------
    // NO RECORD TODAY → CLOCK IN
    // --------------------------------------------------------
    if (!row) {
      btn.disabled = false;
      btn.classList.remove('active');
      btn.dataset.mode = 'IN';

      if (icon) icon.className = 'fa-solid fa-fingerprint';
      if (span) span.innerText = 'Clock In';
      return;
    }

    // --------------------------------------------------------
    // CLOCKED IN, NOT OUT → CLOCK OUT
    // --------------------------------------------------------
    if (row.clock_in && !row.clock_out) {
      btn.disabled = false;
      btn.classList.add('active');
      btn.dataset.mode = 'OUT';

      if (icon) icon.className = 'fa-solid fa-right-from-bracket';
      if (span) span.innerText = 'Clock Out';
      return;
    }

    // --------------------------------------------------------
    // CLOCKED IN & OUT → COMPLETED (LOCK BUTTON)
    // --------------------------------------------------------
    if (row.clock_in && row.clock_out) {
      btn.classList.add('active');
      btn.dataset.mode = 'DONE';
      btn.disabled = true;

      if (icon) icon.className = 'fa-solid fa-check';
      if (span) span.innerText = 'Completed';
      return;
    }

  } catch (e) {
    console.error('refreshClockState failed:', e);
  }
}

// ------------------------------------------------------------
// Handle Clock In / Clock Out click
// ------------------------------------------------------------
async function toggleClock() {
  const btn = document.getElementById('btn-clock');
  if (!btn) return;

  if (btn.dataset.mode === 'DONE') return;

  btn.disabled = true;

  try {
    const mode = btn.dataset.mode || 'IN';
    const endpoint = (mode === 'OUT') ? 'clock_out.php' : 'clock_in.php';

    const res = await fetch(`${ATTENDANCE_API}/${endpoint}`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Server returned invalid response (auth or PHP error)');
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.message || 'Clock action failed');
    }

    // Refresh state after success
    await refreshClockState();

  } catch (e) {
    console.error('toggleClock failed:', e);
    alert(e.message || 'Clocking failed');
  } finally {
    if (btn.dataset.mode !== 'DONE') {
      btn.disabled = false;
    }
  }
}

// ------------------------------------------------------------
// Realtime clock display
// ------------------------------------------------------------
function updateClock() {
  const now = new Date();
  const el = document.getElementById('realtime-clock');
  if (el) el.innerText = now.toLocaleTimeString();
}

// ------------------------------------------------------------
// INIT (runs once per page)
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Live clock
  setInterval(updateClock, 1000);
  updateClock();

  // Initial attendance state
  refreshClockState();

  // Bind click ONCE (no inline onclick)
  const btn = document.getElementById('btn-clock');
  if (btn) {
    btn.addEventListener('click', toggleClock);
  }
});


// ------------------------------------------------------------
// Export Attendance 
// ------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-export-pdf');
  if (!btn) return;

  btn.addEventListener('click', () => {
    // Optional: set a clean title used by some PDF savers
    const d = new Date().toISOString().slice(0,10);
    const oldTitle = document.title;
    document.title = `Attendance Register - ${d}`;

    window.print();

    // restore title after print dialog
    setTimeout(() => { document.title = oldTitle; }, 500);
  });
});

