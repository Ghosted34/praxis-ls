<?php
// ---------------------------------------------------------------------
// ACTIVE NAV (robust): works with pretty URLs + rewrites, no leading "/" in hrefs
// ---------------------------------------------------------------------
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Top-level segment becomes the active key (e.g. "/services/air-freight" -> "services")
$segments   = array_values(array_filter(explode('/', trim($path, '/'))));
$activePage = $segments[0] ?? 'index';

// Normalize home variants
if ($activePage === '' || $activePage === 'index.php' || $activePage === 'home') {
  $activePage = 'index';
}

// Strip ".php" if it appears
$activePage = pathinfo($activePage, PATHINFO_FILENAME);
?>

<a class="visually-hidden-focusable skip-link" href="#main">Skip to main content</a>

<header>
  <nav class="navbar navbar-expand-lg fixed-top" id="mainNavbar" role="navigation" aria-label="Primary">
    <div class="container py-2">

      <a class="navbar-brand d-flex align-items-center gap-2" href="index" aria-label="Smart Logistics Home">
        <img
          src="https://smartls.cm/assets/img-webp/logo-smart.webp"
          alt="Smart Logistics &amp; Services Ltd logo"
          width="176"
          height="44"
          loading="eager"
          decoding="async"
        >
      </a>

      <button class="navbar-toggler" type="button"
        data-bs-toggle="collapse"
        data-bs-target="#mainNav"
        aria-controls="mainNav"
        aria-expanded="false"
        aria-label="Toggle navigation">
        <span class="toggler-icon" aria-hidden="true">
          <span class="toggler-bar bar-1"></span>
          <span class="toggler-bar bar-2"></span>
          <span class="toggler-bar bar-3"></span>
        </span>
      </button>

      <div id="mainNav" class="collapse navbar-collapse">
        <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-1">

          <li class="nav-item">
            <a class="nav-link <?php echo ($activePage === 'index') ? 'active' : ''; ?>"
               href="index"
               data-i18n="nav_home"
               <?php echo ($activePage === 'index') ? 'aria-current="page"' : ''; ?>>
              Home
            </a>
          </li>

          <li class="nav-item">
            <a class="nav-link <?php echo ($activePage === 'services') ? 'active' : ''; ?>"
               href="services"
               data-i18n="nav_services"
               <?php echo ($activePage === 'services') ? 'aria-current="page"' : ''; ?>>
              Services
            </a>
          </li>

          <li class="nav-item">
            <a class="nav-link <?php echo ($activePage === 'kaizen') ? 'active' : ''; ?>"
               href="kaizen"
               data-i18n="nav_kaizen"
               <?php echo ($activePage === 'kaizen') ? 'aria-current="page"' : ''; ?>>
              Kaizen Hub
            </a>
          </li>

          <li class="nav-item">
            <a class="nav-link <?php echo ($activePage === 'smart-track') ? 'active' : ''; ?>"
               href="smart-track"
               data-i18n="nav_tracker"
               <?php echo ($activePage === 'smart-track') ? 'aria-current="page"' : ''; ?>>
              Smart Track
            </a>
          </li>

          <li class="nav-item">
            <a class="nav-link <?php echo ($activePage === 'about') ? 'active' : ''; ?>"
               href="about"
               data-i18n="nav_about"
               <?php echo ($activePage === 'about') ? 'aria-current="page"' : ''; ?>>
              About Us
            </a>
          </li>

          <li class="nav-item ms-lg-2">
            <button
              type="button"
              class="btn btn-sm btn-light border"
              id="langToggle"
              aria-label="Toggle language"
              aria-controls="docRoot"
              aria-live="polite"
            >
              <i class="fa-solid fa-globe me-1" style="color:var(--smart-blue-2)" aria-hidden="true"></i>
              <span class="fw-bold" id="langLabel">EN</span>
            </button>
          </li>

          <li class="nav-item ms-lg-2">
            <a class="btn btn-smart btn-sm px-3 py-2"
               href="smart-quote"
               data-i18n="nav_quote">
              GET A QUOTE
            </a>
          </li>

        </ul>
      </div>

    </div>
  </nav>
</header>

<main id="main">
<script>
(function () {
  function normalizeSlug(s) {
    return (s || '')
      .trim()
      .replace(/^\//, '')
      .split('?')[0]
      .split('#')[0]
      .replace(/\/+$/, '')
      .replace(/\.php$/i, '')
      .toLowerCase();
  }

  // These MUST match your nav href values
  const NAV_SLUGS = new Set([
    'index',
    'services',
    'kaizen',
    'smart-track',
    'about',
    'smart-quote'
  ]);

  function detectActiveFromUrl() {
    const path = (window.location.pathname || '').replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean).map(s => normalizeSlug(s));

    // Find the FIRST segment in the URL that matches one of our nav slugs.
    // This avoids problems with subfolders like /smart-logistics/services
    for (const seg of segments) {
      if (NAV_SLUGS.has(seg)) return seg;
    }

    // Home cases: "/", "/home", "/index.php"
    if (segments.length === 0) return 'index';
    if (segments[segments.length - 1] === 'home') return 'index';
    if (segments[segments.length - 1] === 'index') return 'index';

    return 'index';
  }

  function applyActiveNav() {
    const active = detectActiveFromUrl();

    const links = document.querySelectorAll('#mainNavbar a.nav-link');
    links.forEach(a => {
      a.classList.remove('active');
      a.removeAttribute('aria-current');

      const hrefSlug = normalizeSlug(a.getAttribute('href') || '');
      if (!hrefSlug) return;

      if (hrefSlug === active) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
    });

    // Optional hard proof in console (remove later)
    console.log('[nav] active =', active, 'pathname =', window.location.pathname);
  }

  // Run after DOM is ready (prevents “script ran before navbar exists”)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyActiveNav);
  } else {
    applyActiveNav();
  }
})();
</script>
