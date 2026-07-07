<?php
  $pageTitle = "Track Your Shipment | Smart Logistics & Services Ltd";
  $pageDescription = "Track your cargo with precision using Smart Track.";
  $pageKeywords = "Smart Track, Shipment Tracking, Logistics, Cameroon, CEMAC, Smart Logistics";
  $canonicalUrl = "https://smartls.cm/smart-track"; // update
  
?>
<!doctype html>
<html lang="en" id="docRoot">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title><?php echo htmlspecialchars($pageTitle); ?></title>
  <meta name="description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="keywords" content="<?php echo htmlspecialchars($pageKeywords); ?>">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#055B83">
  <link rel="canonical" href="<?php echo htmlspecialchars($canonicalUrl); ?>">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Smart Logistics & Services Ltd">
  <meta property="og:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta property="og:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta property="og:url" content="<?php echo htmlspecialchars($canonicalUrl); ?>">
  <meta property="og:image" content="https://smartls.cm/images/og/track-og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/track-og.jpg">
  <!-- Favicons / App Icons (MANDATORY GLOBAL) -->
  <link rel="icon" type="image/png" sizes="32x32" href="assets/img-webp/logo-smart.webp">
  <link rel="icon" type="image/png" sizes="16x16" href="assets/img-webp/logo-smart.webp">
  <link rel="icon" href="assets/img-webp/logo-smart.webp">
  <link rel="apple-touch-icon" sizes="180x180" href="assets/img-webp/logo-smart.webp">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">

  <!-- Bootstrap -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <!-- Icons -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">

  <!-- CSS -->
  <link rel="stylesheet" href="css/style.css">
</head>

<body>
<?php require __DIR__ . "/partials/header.php"; ?>

<main class="track-page">

  <!-- Decorative background map -->
  <div class="track-page__bg-map" aria-hidden="true"></div>

  <section class="track-page__wrap">
    <div class="container position-relative">

      <!-- Hero -->
      <div class="track-page__hero text-center mx-auto">
        <span class="track-page__pill" data-i18n="track_pill">Live Logistics Hub</span>

        <h1 class="track-page__title">
          Smart <span class="track-page__title-accent">Track</span>
        </h1>

        <p class="track-page__lead mb-0" data-i18n="track_lead">Track your cargo with precision.</p>
      </div>

      <!-- Search card -->
      <div class="track-page__search glass-panel mx-auto">
        <form class="row g-2 align-items-center" onsubmit="event.preventDefault(); initiateTrack();">
          <div class="col-12 col-lg">
            <div class="track-page__input-wrap">
              <i class="fa-solid fa-magnifying-glass track-page__input-ico" aria-hidden="true"></i>
              <input
                type="text"
                id="track-input"
                class="track-page__input form-control"
                data-i18n-placeholder="track_placeholder"
                placeholder="Enter file reference here"
               
              />
            </div>
          </div>

          <div class="col-12 col-lg-auto">
            <button type="submit" id="track-btn" class="track-page__btn btn-smart btn w-100">
              <span id="btn-text" data-i18n="track_btn">TRACK</span>
              <span id="btn-loader" class="track-page__loader d-none" aria-hidden="true"></span>
            </button>
          </div>
        </form>
      </div>

      <!-- Results -->
      <div id="tracking-result" class="track-page__result glass-panel">

        <!-- Result Header -->
        <div class="track-page__result-head">
          <div class="track-page__smallcap" data-i18n="track_file_reference">File Reference</div>
          <h2 class="track-page__ref" id="res-ref">SL0256721SM</h2>

          <div class="track-page__client">
            <i class="fa-solid fa-building" aria-hidden="true"></i>
            <span id="res-client">L&T Power Transmission & Distribution</span>
          </div>

          <div id="res-status-badge" class="track-page__status">
            <span class="track-page__status-dot"></span>
            <span data-i18n="track_status_in_progress">In Progress</span>
          </div>

          <div class="track-page__last">
            <span data-i18n="track_last_update">Last Update:</span>
            <span class="track-page__last-strong" data-i18n="track_just_now">Just now</span>
          </div>
        </div>

        <!-- Content -->
        <div class="track-page__result-body">
          <div class="row g-4 g-lg-5">

            <!-- Left Column -->
            <div class="col-12 col-lg-4">
              <div class="track-page__facts">
                <div class="track-page__fact track-page__fact--blue">
                  <div class="track-page__fact-k" data-i18n="track_service_type">Service Type</div>

                  <div class="track-page__fact-v">
                    <i id="res-icon" class="fa-solid fa-truck-fast" aria-hidden="true"></i>
                    <span id="res-type">TRANSPORT</span>
                  </div>
                </div>

                <div class="track-page__fact track-page__fact--gray">
                  <div class="track-page__fact-k text-muted" data-i18n="track_key_details">Key Details</div>

                  <div class="track-page__kv">
                    <span class="track-page__dot track-page__dot--orange"></span>
                    <div>
                      <div class="track-page__kv-k" id="label-origin" data-i18n="track_origin">Origin</div>
                      <div class="track-page__kv-v" id="val-origin">Douala</div>
                    </div>
                  </div>

                  <div class="track-page__kv">
                    <span class="track-page__dot track-page__dot--blue"></span>
                    <div>
                      <div class="track-page__kv-k" id="label-dest" data-i18n="track_destination">Destination</div>
                      <div class="track-page__kv-v" id="val-dest">Bertoua</div>
                    </div>
                  </div>

                  <!-- NOTE: You had a duplicate Destination block with the same IDs.
                       That breaks DOM lookups and can produce weird UI/JS behavior.
                       If you want a "Destination Details" line, give it unique IDs. -->
                  <!-- <div class="track-page__kv">
                    <span class="track-page__dot track-page__dot--blue"></span>
                    <div>
                      <div class="track-page__kv-k" id="label-dest-details">Destination Details</div>
                      <div class="track-page__kv-v" id="val-dest-details">Bertoua Project Site</div>
                    </div>
                  </div> -->

                </div>

                <a id="email-btn" href="#" class="track-page__email">
                  <i class="fa-regular fa-envelope me-2" aria-hidden="true"></i>
                  <span data-i18n="track_request_more_info">REQUEST MORE INFO</span>
                </a>
              </div>
            </div>

            <!-- Right Column (Timeline) -->
            <div class="col-12 col-lg-8 position-relative">
              <div class="track-page__timeline">
                <div class="track-page__timeline-line" aria-hidden="true"></div>
                <div id="timeline-container"></div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <!-- Trust badges -->
      <div class="track-page__trust text-center">
        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
        <i class="fa-solid fa-globe" aria-hidden="true"></i>
        <i class="fa-solid fa-certificate" aria-hidden="true"></i>
      </div>

    </div>
  </section>

</main>

<?php require __DIR__ . "/partials/footer.php"; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="js/app.js"></script>

<script>
/**
 * CRITICAL GUARD:
 * Your page uses t('key','Fallback') but doesn't define t().
 * If t is missing, the first call throws "t is not defined" and the entire tracking script stops.
 *
 * This fallback keeps the UI working even if app.js i18n isn't loaded.
 */
window.t = window.t || function(key, fallback){
  return (fallback !== undefined && fallback !== null && String(fallback).trim() !== '')
    ? String(fallback)
    : String(key || '');
};

function $(id){ return document.getElementById(id); }

const TRACK_API = 'api/public_track/get.php';

function fmtDateTime(s){
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString(undefined, { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function serviceIcon(serviceType){
  const s = String(serviceType || '').toUpperCase();
  if (s.includes('SEA')) return 'fa-ship';
  if (s.includes('AIR')) return 'fa-plane';
  if (s.includes('HINTERLAND') || s.includes('TRANSIT')) return 'fa-route';
  if (s.includes('WARE')) return 'fa-warehouse';
  return 'fa-truck-fast';
}

function statusBadgeText(computed){
  const s = String(computed || 'OK').toUpperCase();
  if (s === 'CLOSED') return t('track_status_closed', 'Closed');
  if (s === 'DELAYED') return t('track_status_delayed', 'Delayed');
  if (s === 'RISK') return t('track_status_risk', 'At Risk');
  if (s === 'DUE') return t('track_status_due', 'Due');
  if (s === 'ERROR') return t('track_status_error', 'Error');
  return t('track_status_in_progress', 'In Progress');
}

function setLoading(isLoading){
  const btnText = $('btn-text');
  const loader  = $('btn-loader');
  const btn     = $('track-btn');
  if (!btnText || !loader || !btn) return;

  btn.disabled = !!isLoading;
  btnText.classList.toggle('d-none', !!isLoading);
  loader.classList.toggle('d-none', !isLoading);
}

async function fetchTracking(ref){
  const url = `${TRACK_API}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, { credentials: 'same-origin' });
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Non-JSON response: ${text.slice(0,200)}`); }

  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data;
}

function renderTracking(data){
  const resultCard = $('tracking-result');
  if (!resultCard) return;

  const file = data.file || {};
  const milestones = (data.timeline && Array.isArray(data.timeline.milestones)) ? data.timeline.milestones : [];

  // Header
  if ($('res-ref')) $('res-ref').innerText = file.operations_file_reference || '—';
  if ($('res-client')) $('res-client').innerText = file.client_label || '—';

  // Status badge label
  const badge = $('res-status-badge');
  if (badge) {
    const label = statusBadgeText(file.computed_status);
    const labelNode = badge.querySelector('span:last-child');
    if (labelNode) labelNode.innerText = label;
  }

  // Last update
  const lastEl = document.querySelector('.track-page__last-strong');
  if (lastEl) lastEl.innerText = file.last_update ? fmtDateTime(file.last_update) : t('track_recent', 'Recent');

  // Service type + icon
  if ($('res-type')) $('res-type').innerText = String(file.service_type || '—').replaceAll('_',' ');
  const resIcon = $('res-icon');
  if (resIcon) resIcon.className = `fa-solid ${serviceIcon(file.service_type)}`;

  // Origin/Destination (only if API provides them; otherwise keep placeholder)
  if ($('label-origin')) $('label-origin').innerText = t('track_origin', 'Origin');
  if ($('label-dest')) $('label-dest').innerText = t('track_destination', 'Destination');

  if ($('val-origin')) $('val-origin').innerText = file.origin_label || '—';
  if ($('val-dest')) $('val-dest').innerText = file.destination_label || '—';

  // Email CTA
  const currentStageName = file.current_stage_name || '';
  const subject = `Shipment Details Request | File Reference - ${file.operations_file_reference || ''}`;
  const body =
`Hello Team,

Kindly provide additional details regarding the shipment referenced below.

File Reference: ${file.operations_file_reference || ''}
Current Stage: ${currentStageName}
Last System Update: ${file.last_update ? fmtDateTime(file.last_update) : ''}

Best regards,`;
  const emailHref = `mailto:operations@smartls.cm?cc=customerservice@smartls.cm,info@smartls.cm&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  $('email-btn')?.setAttribute('href', emailHref);

  // Timeline
  const currentIdx = Number(file.current_stage_index || 0);
  const container = $('timeline-container');
  if (!container) return;
  container.innerHTML = '';

  if (!milestones.length) {
    container.insertAdjacentHTML('beforeend', `
      <div class="track-page__t-item track-page__t-item--pending">
        <div class="track-page__t-ico track-page__t-ico--pending"><i class="fa-solid fa-circle-info"></i></div>
        <div class="track-page__t-content">
          <span class="track-page__t-badge track-page__t-badge--pending">${t('track_badge_pending','Pending')}</span>
          <div class="track-page__t-title">${t('track_no_milestones','No milestone timeline is available for this reference yet.')}</div>
        </div>
      </div>
    `);
  } else {
    milestones.forEach(m => {
      const idx = Number(m.index);
      const completed = !!m.completed_at;
      const isClosed = String(file.computed_status || '').toUpperCase() === 'CLOSED';
      const active = (!isClosed && idx === currentIdx && !completed);
      const status = completed ? 'completed' : (active ? 'active' : 'pending');

      const badgeHtml = (status === 'completed')
        ? `<span class="track-page__t-badge track-page__t-badge--done">${t("track_badge_completed","Completed")}</span>`
        : (status === 'active')
          ? `<span class="track-page__t-badge track-page__t-badge--active">${t("track_badge_in_progress","In Progress")}</span>`
          : `<span class="track-page__t-badge track-page__t-badge--pending">${t("track_badge_pending","Pending")}</span>`;

      const iconHtml = (status === 'completed')
        ? `<div class="track-page__t-ico track-page__t-ico--done"><i class="fa-solid fa-check"></i></div>`
        : (status === 'active')
          ? `<div class="track-page__t-ico track-page__t-ico--active"><i class="fa-solid fa-truck-moving"></i></div>`
          : `<div class="track-page__t-ico track-page__t-ico--pending"><i class="fa-solid fa-clock"></i></div>`;

      const detailParts = [];
      if (m.location) detailParts.push(`<div class="track-page__t-detail"><strong>${t('track_location','Location')}:</strong> ${m.location}</div>`);
      if (m.reference) detailParts.push(`<div class="track-page__t-detail"><strong>${t('track_reference','Reference')}:</strong> ${m.reference}</div>`);
      if (m.notes) detailParts.push(`<div class="track-page__t-detail">${m.notes}</div>`);
      const detailHtml = detailParts.join('');

      // MODIFIED: 'Due' date logic is commented out to hide it temporarily. In the future when we sort out the weighing of each stage we restore the due date.
const dateLine = completed
  ? fmtDateTime(m.completed_at)
  : ''; // Original code: (m.due_at ? `${t('track_due','Due')}: ${fmtDateTime(m.due_at)}` : '');

      const wrapClass = `track-page__t-item ${status === 'completed' ? 'track-page__t-item--done' : ''} ${status === 'active' ? 'track-page__t-item--active' : ''} ${status === 'pending' ? 'track-page__t-item--pending' : ''}`;
      const contentClass = `track-page__t-content ${status === 'active' ? 'track-page__t-content--active' : ''}`;

      container.insertAdjacentHTML('beforeend', `
        <div class="${wrapClass}">
          ${iconHtml}
          <div class="${contentClass}">
            ${badgeHtml}
            <div class="track-page__t-title">${m.stage_name || ('Stage ' + (idx+1))}</div>
            ${detailHtml}
            ${dateLine ? `<div class="track-page__t-date">${dateLine}</div>` : ``}
          </div>
        </div>
      `);
    });
  }

  // Show + scroll
  resultCard.classList.add('active');
  try { resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch(e) { resultCard.scrollIntoView(true); }
}

async function initiateTrack(){
  const inputEl = $('track-input');
  const resultCard = $('tracking-result');
  if (!inputEl || !resultCard) return;

  const ref = inputEl.value.trim();
  if (!ref) return alert(t('track_enter_ref', 'Please enter a reference number.'));

  resultCard.classList.remove('active');
  setLoading(true);

  try {
    const data = await fetchTracking(ref);
    renderTracking(data);
  } catch (err) {
    console.error(err);
    alert(err.message || 'Tracking failed.');
  } finally {
    setLoading(false);
  }
}

// Auto-run from URL ?ref=
window.addEventListener('load', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref');
  if (ref) {
    if ($('track-input')) $('track-input').value = ref;
    initiateTrack();
  }
});
</script>

</body>
</html>
