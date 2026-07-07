<?php
// Active nav detection (prevents "Undefined variable $activePage")
$activePage = $activePage ?? basename($_SERVER['PHP_SELF'] ?? '');

// Optional: normalize any paths that might be passed in
$activePage = basename($activePage);
?>

<a class="visually-hidden-focusable skip-link" href="#main">Skip to main content</a>

<header>
  <nav class="navbar navbar-expand-lg fixed-top" id="mainNavbar" role="navigation" aria-label="Primary">
    <div class="container py-2">

      <a class="navbar-brand d-flex align-items-center gap-2" href="index.php" aria-label="Smart Logistics Home">
        <img
          src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png"
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
            <a class="nav-link <?php echo ($activePage === 'index.php') ? 'active' : ''; ?>"
               href="index.php"
               data-i18n="nav_home"
               <?php echo ($activePage === 'index.php') ? 'aria-current="page"' : ''; ?>>
              Home
            </a>
          </li>

          <li class="nav-item">
            <a class="nav-link <?php echo ($activePage === 'services.php') ? 'active' : ''; ?>"
               href="services.php"
               data-i18n="nav_services"
               <?php echo ($activePage === 'services.php') ? 'aria-current="page"' : ''; ?>>
              Services
            </a>
          </li>

          <li class="nav-item">
            <a class="nav-link <?php echo ($activePage === 'portfolio.php') ? 'active' : ''; ?>"
               href="portfolio.php"
               data-i18n="nav_portfolio"
               <?php echo ($activePage === 'portfolio.php') ? 'aria-current="page"' : ''; ?>>
              Portfolio
            </a>
          </li>

          <li class="nav-item">
            <a class="nav-link <?php echo ($activePage === 'kaizen.php') ? 'active' : ''; ?>"
               href="kaizen.php"
               data-i18n="nav_kaizen"
               <?php echo ($activePage === 'kaizen.php') ? 'aria-current="page"' : ''; ?>>
              Kaizen Hub
            </a>
          </li>

          <li class="nav-item">
            <a class="nav-link <?php echo ($activePage === 'about.php') ? 'active' : ''; ?>"
               href="about.php"
               data-i18n="nav_about"
               <?php echo ($activePage === 'about.php') ? 'aria-current="page"' : ''; ?>>
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
               href="smart-quote.php"
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
