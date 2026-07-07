
document.addEventListener('DOMContentLoaded', function () {
  const toggler = document.querySelector('.navbar-toggler');
  const mainNav = document.getElementById('mainNav');

  if (!toggler || !mainNav) return;

  // Listen for bootstrap collapse events to add/remove the .is-open class
  mainNav.addEventListener('show.bs.collapse', () => {
    toggler.classList.add('is-open');
  });
  mainNav.addEventListener('hide.bs.collapse', () => {
    toggler.classList.remove('is-open');
  });

  // Close collapse when clicking outside of it
  document.addEventListener('click', (e) => {
    // Do nothing if nav is closed
    if (!mainNav.classList.contains('show')) return;

    // If click is inside the navbar area or the toggler, ignore
    if (mainNav.contains(e.target) || toggler.contains(e.target)) return;

    // Otherwise hide the collapse using Bootstrap's API
    const bsCollapse = bootstrap.Collapse.getInstance(mainNav) || new bootstrap.Collapse(mainNav, { toggle: false });
    bsCollapse.hide();
  });

  // Optional: close on 'Escape' key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mainNav.classList.contains('show')) {
      const bsCollapse = bootstrap.Collapse.getInstance(mainNav) || new bootstrap.Collapse(mainNav, { toggle: false });
      bsCollapse.hide();
      toggler.focus();
    }
  });

});

(function () {
  "use strict";

  // ============================================================
  // i18n Translation Engine (ONLY translation engine)
  // ============================================================
  const LANG_KEY = "slas_lang";
  const DEFAULT_LANG = "en";

  async function fetchDict(lang) {
    const url = `lang/${lang}.json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${url} (HTTP ${res.status})`);
    return res.json();
  }

  function applyDict(dict, lang) {
    document.documentElement.setAttribute("lang", lang);
    localStorage.setItem(LANG_KEY, lang);
    document.cookie = `slas_lang=${lang}; path=/; max-age=31536000; samesite=lax`;


    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key] != null) el.textContent = dict[key];
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (dict[key] != null) el.setAttribute("placeholder", dict[key]);
    });

    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (dict[key] != null) el.innerHTML = dict[key];
    });

    const label = document.getElementById("langLabel");
    if (label) label.textContent = lang.toUpperCase();

    localStorage.setItem(LANG_KEY, lang);
  }

  async function setLanguage(lang) {
    try {
      const dict = await fetchDict(lang);
      applyDict(dict, lang);
    } catch (e) {
      console.error("[i18n] setLanguage failed:", e);
      if (lang !== DEFAULT_LANG) {
        try {
          const dict = await fetchDict(DEFAULT_LANG);
          applyDict(dict, DEFAULT_LANG);
        } catch (e2) {
          console.error("[i18n] fallback failed:", e2);
        }
      }
    }
  }

  // Bind after DOM is ready (so #langToggle exists)
  document.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem(LANG_KEY) || DEFAULT_LANG;
    setLanguage(saved);

    const btn = document.getElementById("langToggle");
    if (!btn) {
      console.warn("[i18n] #langToggle not found on this page.");
      return;
    }

    btn.addEventListener("click", () => {
      const current = localStorage.getItem(LANG_KEY) || DEFAULT_LANG;
      setLanguage(current === "en" ? "fr" : "en");
    });
  });

  window.setLanguage = setLanguage;

  // ============================================================
  // 1) Navbar scroll state
  // ============================================================
  (function () {
    const nav = document.getElementById("mainNavbar");
    if (!nav) return;
    const onScroll = () => {
      if (window.scrollY > 10) nav.classList.add("is-scrolled");
      else nav.classList.remove("is-scrolled");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  })();

  // ============================================================
  // 2) Reveal animations
  // ============================================================
  (function () {
    const els = document.querySelectorAll("[data-reveal]");
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("is-visible");
        });
      },
      { threshold: 0.14 }
    );
    els.forEach((el) => io.observe(el));
  })();

  // ============================================================
  // 3) Counters
  // ============================================================
  function animateCounter(el, target, durationMs) {
    const startTime = performance.now();
    const fmt = (n) => n.toLocaleString();
    function tick(now) {
      const p = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.floor(target * eased);
      el.textContent = fmt(val);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  (function () {
    const counters = document.querySelectorAll("[data-counter]");
    if (!counters.length) return;
    const seen = new Set();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target;
          if (seen.has(el)) return;
          seen.add(el);
          const target = parseInt(el.getAttribute("data-counter"), 10);
          if (Number.isFinite(target)) animateCounter(el, target, 1100);
        });
      },
      { threshold: 0.35 }
    );
    counters.forEach((el) => io.observe(el));
  })();

  // ============================================================
  // 4) Smart Track stub (Phase 1)
  // ============================================================
  window.smartQuickTrack = function smartQuickTrack(e) {
    if (e) e.preventDefault();
    const ref = (document.getElementById("heroTrackRef")?.value || "").trim();
    if (!ref) {
      alert("Please enter your Tracking Reference number.");
      return false;
    }
    alert("Tracking reference captured: " + ref + "\nNext: connect Smart Track endpoint in Phase 2.");
    return false;
  };
})();

// smart track home page js
