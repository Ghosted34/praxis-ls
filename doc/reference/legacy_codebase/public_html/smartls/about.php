<?php
  $pageTitle = "About Us | Smart Logistics & Services Ltd";
  $pageDescription = "Learn about Smart Logistics & Services Ltd: our mission, vision, leadership, and governance—your trusted partner in the CEMAC region.";
  $canonicalUrl = "https://smartls.cm/about.php"; // update to real domain

  // SEO: lightweight keywords (optional, but consistent across site)
  $pageKeywords = "Smart Logistics, About Smart Logistics, Logistics Cameroon, Douala, CEMAC, Freight Forwarding, Customs Brokerage, 3PL, Warehousing, Transport";

  // Nav active state safety (prevents undefined variable warnings)
  $activePage = $activePage ?? basename($_SERVER['PHP_SELF']);
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

  <!-- Canonical -->
  <link rel="canonical" href="<?php echo htmlspecialchars($canonicalUrl); ?>">

  <!-- Favicons / App Icons (MANDATORY GLOBAL) -->
  <link rel="icon" type="image/png" sizes="32x32" href="assets/img-webp/logo-smart.webp">
  <link rel="icon" type="image/png" sizes="16x16" href="assets/img-webp/logo-smart.webp">
  <link rel="icon" href="assets/img-webp/logo-smart.webp">
  <link rel="apple-touch-icon" sizes="180x180" href="assets/img-webp/logo-smart.webp">

  <!-- Theme -->
  <meta name="theme-color" content="#055B83">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Smart Logistics & Services Ltd">
  <meta property="og:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta property="og:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta property="og:url" content="<?php echo htmlspecialchars($canonicalUrl); ?>">
  <meta property="og:image" content="https://smartls.cm/images/og/about-og.jpg">
  <meta property="og:image:alt" content="Smart Logistics & Services Ltd - About Us">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/about-og.jpg">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">

  <!-- Bootstrap -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <!-- Icons -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">

  <!-- CSS -->
  <link rel="stylesheet" href="css/style.css">
</head>

<body>
<?php require __DIR__ . "/partials/header.php"; ?>

<main class="about-page">

  <!-- HERO -->
  <section class="about-page__hero">
    <div class="container">
      <div class="row g-4 align-items-end">
        <div class="col-lg-9">
          <div class="about-page__kicker" data-reveal>
            <i class="fa-solid fa-shield-halved"></i>
            <span data-i18n="about_hero_kicker">ABOUT US</span>
          </div>

          <h1 class="about-page__title" data-reveal data-i18n="about_hero_title">
            YOUR TRUSTED PARTNER IN CEMAC REGION
          </h1>

          <div class="about-page__lead" data-reveal data-i18n="about_hero_lead">
            Built for compliance, visibility, and dependable execution—operating from Douala as a gateway to the CEMAC region.
          </div>

          <div class="about-page__stats" data-reveal>
            <div class="about-page__stat">
              <div class="k" data-i18n="about_stats_founded_k">Founded</div>
              <div class="v">2020</div>
            </div>
            <div class="about-page__stat">
              <div class="k" data-i18n="about_stats_base_k">Base</div>
              <div class="v">Douala</div>
            </div>
            <div class="about-page__stat">
              <div class="k" data-i18n="about_stats_focus_k">Focus</div>
              <div class="v" data-i18n="about_stats_focus_v">CEMAC Region</div>
            </div>
          </div>
        </div>

        <div class="col-lg-3 text-lg-end" data-reveal>
          <a class="btn btn-smart px-4" href="#contact">
            <i class="fa-solid fa-paper-plane me-2"></i> <span data-i18n="about_hero_cta">Contact Us</span>
          </a>
        </div>
      </div>
    </div>
  </section>

  <!-- COMPANY OVERVIEW -->
  <section class="section about-page__section">
    <div class="container">
      <div class="row g-4 align-items-stretch">
        <div class="col-lg-7" data-reveal>
          <div class="about-page__panel card-premium p-4 p-lg-5 h-100">
            <div class="about-page__eyebrow" data-i18n="about_overview_title">COMPANY OVERVIEW</div>
            <p class="about-page__p mb-0" data-i18n="about_overview_body">
              Founded in 2020, Smart Logistics &amp; Services Ltd has expanded rapidly from Customs Brokerage to a full-service 3PL provider. Based in Douala, we serve as the gateway to the CEMAC region.
            </p>
          </div>
        </div>

        <div class="col-lg-5" data-reveal>
          <div class="about-page__image card-premium h-100">
            <div class="about-page__image-bg"
                 style="--about-bg:url('../assets/img-webp/about-sub.webp')"></div>
            <div class="about-page__image-overlay"></div>
            <div class="about-page__image-caption">
              <div class="t">Smart Logistics &amp; Services Ltd</div>
              <div class="s" data-i18n="about_overview_caption_sub">Douala • CEMAC Gateway</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- MISSION & VISION -->
  <section class="section about-page__section about-page__section--surface">
    <div class="container">
      <div class="row g-3">
        <div class="col-12 col-lg-6" data-reveal>
          <div class="about-page__card card-premium p-4 p-lg-5 h-100">
            <div class="about-page__card-top">
              <div class="about-page__icon"><i class="fa-solid fa-bullseye"></i></div>
              <div class="about-page__eyebrow" data-i18n="about_mission_vision_title">MISSION &amp; VISION</div>
            </div>
            <div class="about-page__h3" data-i18n="about_mission_label">Mission:</div>
            <p class="about-page__p" data-i18n="about_mission_body">
              To deliver exceptional logistics solutions, exceeding client expectations through timely, cost-effective, and innovative services.
            </p>

            <div class="about-page__divider"></div>

            <div class="about-page__h3" data-i18n="about_vision_label">Vision:</div>
            <p class="about-page__p mb-0" data-i18n="about_vision_body">
              To become the CEMAC region's leading logistics company, renowned for our expertise, reliability, and customer-centric approach.
            </p>
          </div>
        </div>

        <div class="col-12 col-lg-6" data-reveal>
          <div class="about-page__card card-premium p-4 p-lg-5 h-100">
            <div class="about-page__card-top">
              <div class="about-page__icon about-page__icon--orange"><i class="fa-solid fa-diagram-project"></i></div>
              <div class="about-page__eyebrow" data-i18n="about_operational_title">OPERATIONAL EMPHASIS</div>
            </div>

            <div class="about-page__list">
              <div class="about-page__li">
                <span class="dot"></span>
                <span class="txt" data-i18n="about_operational_li_1">Disciplined processes and regulatory compliance</span>
              </div>
              <div class="about-page__li">
                <span class="dot"></span>
                <span class="txt" data-i18n="about_operational_li_2">Visibility and control across complex operating environments</span>
              </div>
              <div class="about-page__li">
                <span class="dot"></span>
                <span class="txt" data-i18n="about_operational_li_3">Dependable last-mile delivery for project-driven operations</span>
              </div>
              <div class="about-page__li">
                <span class="dot"></span>
                <span class="txt" data-i18n="about_operational_li_4">Systems, expertise, and partnerships for seamless cross-border trade</span>
              </div>
            </div>

            <div class="about-page__note mt-3">
              <i class="fa-solid fa-shield-halved me-2" style="color:var(--smart-orange)"></i>
              <span data-i18n="about_operational_note">Built to support trade corridors as regional supply chains expand.</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- MESSAGE FROM CEO -->
  <section class="section about-page__section">
    <div class="container">
      <div class="row g-4 align-items-stretch">

        <div class="col-lg-4" data-reveal>
          <div class="about-page__ceo card-premium h-100">
            <div class="about-page__ceo-photo" style="--ceo:url('../assets/img-webp/smart-logistics-ceo.webp');"></div>
            <div class="about-page__ceo-meta p-4">
              <div class="n">Timothée MASSOMBA</div>
              <div class="r" data-i18n="about_ceo_role">Chief Executive Officer</div>
              <div class="c">SMART LOGISTICS &amp; SERVICES LTD</div>
            </div>
          </div>
        </div>

        <div class="col-lg-8" data-reveal>
          <article class="about-page__letter card-premium p-4 p-lg-5 h-100">
            <div class="about-page__eyebrow" data-i18n="about_ceo_title">Message from the CEO</div>

            <p class="about-page__p" data-i18n="about_ceo_p1">
              At Smart Logistics, we view logistics as a strategic driver of trade, growth, and competitiveness. Our responsibility goes beyond moving cargo. It is about delivering control, visibility, and reliable execution in complex operating environments.
            </p>

            <p class="about-page__p" data-i18n="about_ceo_p2">
              From our headquarters in Douala, we operate at a critical gateway to the CEMAC region and the wider African market. We support international organizations, multinationals, and project-driven operations that require disciplined processes, regulatory compliance, and dependable last-mile delivery.
            </p>

            <p class="about-page__p" data-i18n="about_ceo_p3">
              Africa is entering an enhanced phase of economic integration through the African Continental Free Trade Area. As cross-border flows increase and supply chains become more regional, the need for efficient freight forwarding, customs brokerage, coordinated transport, and trusted project execution will intensify. This is where Smart Logistics &amp; Services Ltd is positioning itself. We are building the systems, expertise, and partnerships required to support seamless trade across borders and corridors.
            </p>

            <p class="about-page__p" data-i18n="about_ceo_p4">
              Our ambition is clear: to be a long-term logistics authority and a preferred gateway for regional and international trade. We remain committed to exceeding expectations and enabling our clients to operate and scale with confidence.
            </p>

            <div class="about-page__sig mt-4">
              <div class="name">Timothée MASSOMBA</div>
              <div class="role" data-i18n="about_ceo_role">Chief Executive Officer</div>
              <div class="org">SMART LOGISTICS &amp; SERVICES LTD</div>
            </div>

            <div class="about-page__quote-mark" aria-hidden="true">“</div>
          </article>
        </div>

      </div>
    </div>
  </section>

  <!-- LEADERSHIP + GOVERNANCE -->
  <section class="section about-page__section about-page__section--esg">
    <div class="container">

      <div class="text-center mb-5">
        <h2 class="about-page__h2 mb-2" data-i18n="about_esg_title">Our ESG Commitment</h2>
        <p class="about-page__sub" data-i18n="about_esg_sub">
          Responsible logistics built for long-term impact in the CEMAC region.
        </p>
      </div>

      <div class="row g-3">

        <div class="col-12 col-lg-4" data-reveal>
          <div class="about-page__card about-page__card--esg about-page__card--env h-100">

            <div class="about-page__card-top">
              <div class="about-page__esg-letter">E</div>
              <div class="about-page__eyebrow" data-i18n="about_esg_env_title">Environment</div>
            </div>

            <p class="about-page__p" data-i18n="about_esg_env_p">
              Smart Logistics integrates environmentally responsible practices across its operations to reduce emissions, minimize waste, and optimize resource usage throughout the supply chain.
            </p>

            <ul class="about-page__list">
              <li data-i18n="about_esg_env_li_1">Route optimization to reduce fuel consumption and emissions</li>
              <li data-i18n="about_esg_env_li_2">Responsible handling of hazardous and regulated cargo</li>
              <li data-i18n="about_esg_env_li_3">Waste reduction and recycling within warehouse operations</li>
              <li data-i18n="about_esg_env_li_4">Gradual transition toward fuel-efficient fleets and equipment</li>
              <li data-i18n="about_esg_env_li_5">Compliance with local and international environmental regulations</li>
            </ul>
          </div>
        </div>

        <div class="col-12 col-lg-4" data-reveal>
          <div class="about-page__card about-page__card--esg about-page__card--soc h-100">

            <div class="about-page__card-top">
              <div class="about-page__esg-letter">S</div>
              <div class="about-page__eyebrow" data-i18n="about_esg_soc_title">Social</div>
            </div>

            <p class="about-page__p" data-i18n="about_esg_soc_p">
              We prioritize the safety, wellbeing, and development of our people and the communities in which we operate, recognizing that logistics is powered by human expertise.
            </p>

            <ul class="about-page__list">
              <li data-i18n="about_esg_soc_li_1">Strict health, safety, and security standards across operations</li>
              <li data-i18n="about_esg_soc_li_2">Continuous training for operational and compliance staff</li>
              <li data-i18n="about_esg_soc_li_3">Ethical labor practices and zero tolerance for discrimination</li>
              <li data-i18n="about_esg_soc_li_4">Support for humanitarian, development, and NGO supply chains</li>
              <li data-i18n="about_esg_soc_li_5">Local workforce engagement within the CEMAC region</li>
            </ul>
          </div>
        </div>

        <div class="col-12 col-lg-4" data-reveal>
          <div class="about-page__card about-page__card--esg about-page__card--gov h-100">

            <div class="about-page__card-top">
              <div class="about-page__esg-letter">G</div>
              <div class="about-page__eyebrow" data-i18n="about_esg_gov_title">Governance</div>
            </div>

            <p class="about-page__p" data-i18n="about_esg_gov_p">
              Our operations are governed by a Strategic Planning Committee and an Operational Excellence Committee, ensuring strong oversight, regulatory compliance, risk management, and operational integrity across every shipment we handle.
            </p>

            <ul class="about-page__list">
              <li data-i18n="about_esg_gov_li_1">Clear accountability and decision-making structures</li>
              <li data-i18n="about_esg_gov_li_2">Compliance with customs, trade, and international logistics standards</li>
              <li data-i18n="about_esg_gov_li_3">Risk mitigation and internal control procedures</li>
              <li data-i18n="about_esg_gov_li_4">Ethical business conduct and transparency</li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- CONTACT CTA -->
  <section class="section about-page__cta" id="contact">
    <div class="container" data-reveal>
      <div class="about-page__cta-shell card-premium p-4 p-lg-5">
        <div class="row g-3 align-items-center">
          <div class="col-lg-8">
            <div class="about-page__cta-title" data-i18n="about_cta_title">Ready to work with a disciplined logistics partner?</div>
          </div>
          <div class="col-lg-4 text-lg-end">
            <a class="btn btn-smart px-4" href="mailto:info@smartls.cm?subject=About%20Us%20Inquiry">
              <i class="fa-solid fa-paper-plane me-2"></i> <span data-i18n="about_cta_email">Email Us</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>

</main>

<?php require __DIR__ . "/partials/footer.php"; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="js/app.js"></script>

</body>
</html>
