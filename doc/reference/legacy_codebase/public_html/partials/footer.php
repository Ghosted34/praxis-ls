<footer class="pt-5 pb-4" style="background: var(--smart-charcoal); color:#fff;" role="contentinfo" aria-label="Site footer">
  <div class="container">

    <?php
      // Helps footer section links work site-wide without breaking SPA-like anchors
      $isHome = (basename($_SERVER['PHP_SELF'] ?? '') === 'index');
      $homePrefix = $isHome ? '' : 'index';
    ?>

    <div class="row g-4 mb-4">
      <!-- Brand -->
      <div class="col-lg-4">
        <img
          src="https://smartls.cm/assets/img-webp/logo-smart.webp"
          alt="Smart Logistics &amp; Services Ltd logo"
          width="176"
          height="44"
          decoding="async"
          class="mb-3"
          style="filter: brightness(0) invert(1);"
        >
        <p class="small mb-3" style="color: rgba(255,255,255,.72); max-width: 60ch;"
           data-i18n="footer_brand_blurb">
          SMART LOGISTICS &amp; SERVICES LTD delivers compliant, reliable logistics solutions with enterprise visibility across the CEMAC region.
        </p>
      </div>

      <!-- Quick links -->
      <div class="col-lg-2" aria-label="Footer quick links">
        <h3 class="h6 mb-3" style="font-weight:700;" data-i18n="footer_quick_links_title">Quick Links</h3>
        <ul class="list-unstyled small mb-0" role="list">
          <li class="mb-2">
            <a class="footer-link" href="<?php echo $homePrefix; ?>/../services" data-i18n="footer_quick_services">Services</a>
          </li>
          <li class="mb-2">
            <a class="footer-link" href="<?php echo $homePrefix; ?>#industries" data-i18n="footer_quick_industries">Industries</a>
          </li>
          <!-- <li class="mb-2">
            <a class="footer-link" href="portfolio" data-i18n="footer_quick_portfolio">Portfolio</a>
          </li> -->
          <li>
            <a class="footer-link" href="<?php echo $homePrefix; ?>#contact" data-i18n="footer_quick_contact">Contact</a>
          </li>
        </ul>
      </div>

      <div class="col-lg-3" aria-label="Corporate policies">
        <h3 class="h6 mb-3" style="font-weight:700;">Corporate Policies</h3>
        <ul class="list-unstyled small mb-0">
          <li class="mb-2">
            <a href="#" class="footer-link policy-link" data-bs-toggle="modal" data-bs-target="#policyModal" data-policy="quality">
              Quality Policy
            </a>
          </li>
          <li class="mb-2">
            <a href="#" class="footer-link policy-link" data-bs-toggle="modal" data-bs-target="#policyModal" data-policy="hse">
              HSE Policy
            </a>
          </li>
          <li class="mb-2">
            <a href="#" class="footer-link policy-link" data-bs-toggle="modal" data-bs-target="#policyModal" data-policy="esg">
              Green Logistics & ESG
            </a>
          </li>
          <li class="mb-2">
            <a href="#" class="footer-link policy-link" data-bs-toggle="modal" data-bs-target="#policyModal" data-policy="conduct">
              Code of Conduct
            </a>
          </li>
          <li>
            <a href="#" class="footer-link policy-link" data-bs-toggle="modal" data-bs-target="#policyModal" data-policy="anticorruption">
              Anti-Corruption Policy
            </a>
          </li>
        </ul>
      </div>


      <!-- Contact + Social -->
      <div class="col-lg-3" aria-label="Footer contact information">
        <h3 class="h6 mb-3" style="font-weight:700;" data-i18n="footer_contact_title">Contact</h3>
        <ul class="list-unstyled small mb-3" style="color: rgba(255,255,255,.72);" role="list">
          <li class="mb-2">
            <i class="fa-solid fa-location-dot me-2" aria-hidden="true"></i>
            <span data-i18n="footer_contact_location">Douala, Cameroon</span>
          </li>
          <li class="mb-2">
            <i class="fa-solid fa-phone me-2" aria-hidden="true"></i>
            <a class="footer-link" href="tel:+237233420281">+237 696 12 25 11</a>
          </li>
          <li>
            <i class="fa-solid fa-envelope me-2" aria-hidden="true"></i>
            <a class="footer-link" href="mailto:info@smartls.cm">info@smartls.cm</a>
          </li>
        </ul>

        <div class="d-flex gap-3" aria-label="Social links">
          <a href="https://www.linkedin.com/company/smartls-ltd"
             class="footer-social"
             aria-label="LinkedIn"
             target="_blank"
             rel="noopener noreferrer">
            <i class="fa-brands fa-linkedin-in" aria-hidden="true"></i>
          </a>

          <a href="https://wa.me/237696122511"
             class="footer-social"
             aria-label="WhatsApp"
             target="_blank"
             rel="noopener noreferrer">
            <i class="fa-brands fa-whatsapp" aria-hidden="true"></i>
          </a>

          <a href="https://www.facebook.com/61566939331403/"
             class="footer-social"
             aria-label="Facebook"
             target="_blank"
             rel="noopener noreferrer">
            <i class="fa-brands fa-facebook-f" aria-hidden="true"></i>
          </a>
        </div>
      </div>
    </div>

    <!-- Bottom bar -->
    <div class="border-top pt-3" style="border-color: rgba(255,255,255,.12);">
      <div class="d-flex flex-column flex-md-row justify-content-between gap-2 small"
           style="color: rgba(255,255,255,.66);">

        <div>
          <span data-i18n="footer_rights_prefix">©</span>
          <?php echo date("Y"); ?>
          <span data-i18n="footer_rights_suffix">SMART LOGISTICS &amp; SERVICES LTD. All Rights Reserved.</span>
        </div>

        <div class="d-flex gap-3" aria-label="Legal links">
          <a href="#" class="footer-link" data-bs-toggle="modal" data-bs-target="#privacyModal" data-i18n="footer_privacy_link">Privacy Policy</a>
          <a href="#" class="footer-link" data-bs-toggle="modal" data-bs-target="#termsModal" data-i18n="footer_terms_link">Terms of Use</a>
        </div>
      </div>
    </div>

  </div>
  <!-- Policy modal (replace existing policyModal) -->
<div class="modal fade" id="policyModal" tabindex="-1" aria-labelledby="policyModalTitle" aria-hidden="true">
  <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
    <div class="modal-content legal-modal">

      <div class="modal-header">
        <h5 class="modal-title" id="policyModalTitle"></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>

      <!-- This wrapper will be printed (title + body together) -->
      <div class="modal-body" id="policyPrintArea" style="white-space:normal;">
        <h2 class="policy-pdf-title" id="policyPrintTitle" style="margin-top:0;"></h2>
        <div id="policyModalBody"></div>
      </div>

      <!-- Download button fixed inside modal content (bottom-right) -->
      <div class="policy-modal-footer">
        <button id="policyDownloadBtn" class="btn policy-download-btn" type="button" aria-label="Download policy as PDF">
          <i class="fa-solid fa-download me-2"></i>Download PDF
        </button>
      </div>

    </div>
  </div>
</div>





  <!-- Privacy Modal -->
  <div class="modal fade" id="privacyModal" tabindex="-1" aria-hidden="true" aria-labelledby="privacyModalTitle">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="document">
      <div class="modal-content legal-modal">

        <div class="modal-header">
          <h5 class="modal-title" id="privacyModalTitle" data-i18n="legal_privacy_title">Privacy Policy</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>

        <div class="modal-body">
          <div data-i18n-html="legal_privacy_body_html">
            <p>
              Smart Logistics &amp; Services Ltd is committed to protecting personal and business information entrusted to us.
            </p>

            <p>
              Personal data is collected and processed lawfully, fairly, and transparently for legitimate business purposes,
              including service delivery, regulatory compliance, and operational communication.
            </p>

            <ul>
              <li>Data is collected only where necessary and used for defined purposes.</li>
              <li>Appropriate technical and organizational safeguards are in place.</li>
              <li>Access to data is restricted to authorized personnel.</li>
              <li>Data is retained only as long as required by business or legal obligations.</li>
              <li>Data subjects may request access, correction, or deletion of personal data.</li>
            </ul>

            <p>
              Inquiries related to data protection may be directed to
              <a href="mailto:info@smartls.cm">info@smartls.cm</a>.
            </p>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- Terms Modal -->
  <div class="modal fade" id="termsModal" tabindex="-1" aria-hidden="true" aria-labelledby="termsModalTitle">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="document">
      <div class="modal-content legal-modal">

        <div class="modal-header">
          <h5 class="modal-title" id="termsModalTitle" data-i18n="legal_terms_title">Terms of Use</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>

        <div class="modal-body">
          <div data-i18n-html="legal_terms_body_html">
            <p>
              This website is provided for informational and business purposes only. By accessing it, users agree to comply with these terms.
            </p>

            <ul>
              <li>Smart Logistics &amp; Services Ltd retains all intellectual property rights to website content.</li>
              <li>Information is provided without guarantee of completeness or uninterrupted availability.</li>
              <li>The company is not liable for damages arising from website use or external links.</li>
            </ul>

            <p>
              Use of this website constitutes acceptance of these terms under applicable laws and regulations.
            </p>
          </div>
        </div>

      </div>
    </div>
  </div>

</footer>
<!-- html2pdf library (client-side PDF generation) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.9.2/html2pdf.bundle.min.js"></script>

<script>
/* ---------- policies object (your exact text kept) ---------- */
const policies = {
  quality: {
    title: "QUALITY POLICY STATEMENT",
    text: `Smart Logistics & Services Ltd is committed to delivering logistics and supply chain solutions that consistently meet customer requirements, applicable statutory and regulatory obligations, and internationally recognized quality standards.
Quality management is integral to our operations across freight forwarding, customs brokerage, inland transport, warehousing, and project logistics. Our objective is to ensure reliable, compliant, and repeatable service delivery in complex operating environments.
In alignment with ISO 9001:2015 principles, we commit to:
• Establishing, implementing, and maintaining an effective Quality Management System based on a process and risk-based approach.
• Understanding customer needs and contractual requirements and translating them into controlled operational processes.
• Ensuring compliance with customs regulations, trade laws, safety requirements, and applicable international standards.
• Monitoring, measuring, and analyzing performance to drive continual improvement.
• Managing risks and opportunities that may impact service quality and customer satisfaction.
• Providing appropriate resources, training, and competence development for all personnel.
• Conducting internal audits, management reviews, and corrective actions to ensure ongoing system effectiveness.
Top management is accountable for the effectiveness of the Quality Management System and for promoting a culture of quality throughout the organization. All employees are responsible for complying with established procedures and contributing to continuous improvement.`
  },

  hse: {
    title: "HSE POLICY STATEMENT",
    text: `Smart Logistics & Services Ltd is committed to conducting its operations in a manner that protects the health and safety of employees, contractors, clients, and the public, while minimizing adverse environmental impacts.
HSE considerations are integrated into all operational activities, including cargo handling, transport operations, customs clearance, warehousing, and project logistics.
Our commitments include:
• Providing a safe and healthy working environment through systematic hazard identification, risk assessment, and implementation of control measures.
• Complying with all applicable occupational health, safety, and environmental laws, regulations, and industry requirements.
• Preventing accidents, injuries, occupational illnesses, and environmental incidents through proactive planning and supervision.
• Ensuring that employees and contractors are competent, trained, and aware of their HSE responsibilities.
• Promoting safe work practices, including the authority to stop work where unsafe conditions exist.
• Ensuring safe handling, storage, and transportation of hazardous, sensitive, and regulated cargo.
• Implementing emergency preparedness, incident reporting, investigation, and corrective action procedures.
• Monitoring HSE performance and continually improving our systems and controls.
Management is responsible for providing leadership, resources, and oversight to implement this policy. All employees and contractors are required to comply with HSE rules and report unsafe acts or conditions.
Our objective is zero harm to people, assets, and the environment.`
  },

  esg: {
    title: "GREEN LOGISTICS & ESG COMMITMENT",
    text: `Smart Logistics & Services Ltd is committed to responsible logistics practices that support environmental protection, social responsibility, and strong governance.
We recognize that sustainable logistics performance is essential to long-term business resilience and stakeholder trust. Our ESG commitments are embedded in operational planning, supplier selection, and performance management.
We commit to:
Environmental Responsibility
• Optimizing transport routes, cargo consolidation, and dwell times to reduce fuel consumption and emissions.
• Promoting efficient customs and port operations to minimize congestion and environmental impact.
• Encouraging the use of compliant, well-maintained vehicles and equipment.
• Reducing waste and paper usage through digitalization and process automation.
• Preventing pollution through spill control, waste management, and emergency response planning.
Social Responsibility
• Providing safe, fair, and respectful working conditions.
• Investing in training, local capacity development, and operational competence.
• Respecting human rights and promoting ethical conduct across our operations and supply chain.
Governance
• Operating with transparency, accountability, and compliance.
• Applying risk management and internal controls across business activities.
• Engaging suppliers and partners that align with our ESG expectations.
Smart Logistics & Services Ltd is committed to monitoring ESG performance and continuously improving our contribution to sustainable logistics development in Africa and beyond.`
  },

  conduct: {
    title: "CODE OF CONDUCT",
    text: `Smart Logistics & Services Ltd conducts its business with integrity, professionalism, and respect for the law. This Code of Conduct applies to all employees, officers, contractors, and representatives.
All personnel are expected to:
• Act honestly, ethically, and responsibly in all business dealings.
• Comply with applicable laws, regulations, and internal policies.
• Protect company assets, confidential information, and client data.
• Avoid conflicts of interest or disclose them where they arise.
• Treat colleagues, clients, and partners with respect and professionalism.
• Maintain accurate records and truthful reporting.
• Refuse and report any activity that may compromise ethical standards.
Violations of this Code may result in disciplinary action, contract termination, or legal consequences.`
  },

  anticorruption: {
    title: "ANTI-CORRUPTION & ANTI-BRIBERY POLICY",
    text: `Smart Logistics & Services Ltd conducts its business with integrity, professionalism, and respect for the law. This Code of Conduct applies to all employees, officers, contractors, and representatives.
All personnel are expected to:
• Act honestly, ethically, and responsibly in all business dealings.
• Comply with applicable laws, regulations, and internal policies.
• Protect company assets, confidential information, and client data.
• Avoid conflicts of interest or disclose them where they arise.
• Treat colleagues, clients, and partners with respect and professionalism.
• Maintain accurate records and truthful reporting.
• Refuse and report any activity that may compromise ethical standards.
Violations of this Code may result in disciplinary action, contract termination, or legal consequences.
Smart Logistics & Services Ltd maintains a zero-tolerance approach to bribery, corruption, fraud, and unethical business practices.
Bribery or corruption in any form, whether direct or indirect, is strictly prohibited. This includes improper payments, facilitation payments, kickbacks, gifts, or advantages intended to influence business decisions or public officials.
We commit to:
• Complying with applicable anti-corruption laws and international best practices.
• Prohibiting bribery involving public officials, customs authorities, private entities, or third parties.
• Conducting business transactions transparently and recording them accurately.
• Implementing internal controls to detect and prevent corrupt practices.
• Ensuring employees and partners understand their anti-corruption obligations.
• Encouraging reporting of suspected violations without fear of retaliation.
Any employee or partner who becomes aware of potential corruption must report it immediately to management. Proven violations will result in disciplinary action and may be reported to relevant authorities.`
  }
};

/* ---------- helper: convert plain text into HTML (paragraphs & lists) ---------- */
function formatPolicyTextToHtml(text){
  const lines = text.replace(/\r/g,'').split('\n').map(l => l.trim());
  let html = '';
  let inList = false;

  lines.forEach(line => {
    if (!line) {
      if (inList) { html += '</ul>'; inList = false; }
      return;
    }

    // bullet lines start with '•' or '-' or '*' or '•'
    if (/^[•\-\*]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      const item = line.replace(/^[•\-\*]\s+/, '');
      html += `<li>${escapeHtml(item)}</li>`;
    } else if (line.match(/^[A-Z0-9 ]{4,}$/) && !inList) {
      // headings in your text (all-caps lines) -> treat as <h3>
      html += `<h3 style="margin-top:.85rem;margin-bottom:.4rem;">${escapeHtml(line)}</h3>`;
    } else {
      // normal paragraph
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${escapeHtml(line)}</p>`;
    }
  });

  if (inList) html += '</ul>';
  return html;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; });
}

/* ---------- attach click handlers to policy links ---------- */
document.querySelectorAll('.policy-link').forEach(el => {
  el.addEventListener('click', function(e){
    e.preventDefault();
    const key = this.dataset.policy;
    const p = policies[key];
    if (!p) return;

    // modal DOM nodes
    const policyModalEl = document.getElementById('policyModal');
    const titleNode = document.getElementById('policyModalTitle');
    const printTitleNode = document.getElementById('policyPrintTitle');
    const bodyNode = document.getElementById('policyModalBody');

    // set title & body (modal header + printable area)
    titleNode.innerText = p.title;
    printTitleNode.innerText = p.title;

    // set explicit color inline on printable title so html2canvas captures it reliably
    const rootColor = getComputedStyle(document.documentElement).getPropertyValue('--smart-blue-2') || '#1F99D8';
    printTitleNode.style.color = rootColor.trim();

    // format text -> HTML and inject
    bodyNode.innerHTML = formatPolicyTextToHtml(p.text);

    // store filename on download button
    const filename = p.title.toLowerCase().replace(/\s+/g,'-') + '.pdf';
    const downloadBtn = document.getElementById('policyDownloadBtn');
    downloadBtn.dataset.filename = filename;

    // show modal
    const bsModal = new bootstrap.Modal(policyModalEl);
    bsModal.show();
  });
});

/* ---------- PDF generation: hide modal first, then generate to avoid stuck backdrop ---------- */
document.getElementById('policyDownloadBtn').addEventListener('click', function(){
  const policyModalEl = document.getElementById('policyModal');
  const printArea = document.getElementById('policyPrintArea');
  const filename = this.dataset.filename || 'policy.pdf';

  // Options for html2pdf
  const opt = {
    margin:       12,
    filename:     filename,
    image:        { type: 'jpeg', quality: 0.92 },
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  // Wait for modal to hide completely, then generate the PDF
  const onHidden = function () {
    // small delay to ensure backdrop removed
    setTimeout(() => {
      html2pdf().set(opt).from(printArea).save().then(() => {
        // no-op; keep modal hidden after download
      }).catch(err => {
        console.error("PDF generation error:", err);
      });
    }, 160);
    policyModalEl.removeEventListener('hidden.bs.modal', onHidden);
  };

  policyModalEl.addEventListener('hidden.bs.modal', onHidden);

  // hide the modal programmatically (this triggers hidden.bs.modal)
  const instance = bootstrap.Modal.getInstance(policyModalEl) || new bootstrap.Modal(policyModalEl);
  instance.hide();
});

(function () {
  // Safety: warn if multiple bootstrap scripts
  try {
    // If bootstrap.Modal exists we assume Bootstrap loaded
    if (window.bootstrap && window.bootstrap.Modal) {
      // detect duplicates by checking for multiple script tags that mention bootstrap.bundle or bootstrap
      const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
      const bsCount = scripts.filter(src => /bootstrap.*(bundle|bootstrap)/i.test(src)).length;
      if (bsCount > 1) {
        console.warn("[Bootstrap] Multiple bootstrap script tags detected (" + bsCount + "). This can cause modal/backdrop issues.");
      }
    }
  } catch(e) {
    console.warn("Bootstrap detection error", e);
  }

  // Utility to clean leftover backdrops and modal-open class
  function cleanModalBackdrop() {
    // remove all backdrops left in DOM
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(b => b.remove());

    // remove modal-open from body and restore overflow/padding
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }

  // Hook onto the standard bootstrap event 'hidden.bs.modal'
  document.addEventListener('hidden.bs.modal', function (ev) {
    // small delay to let Bootstrap try cleanup first (safe)
    setTimeout(cleanModalBackdrop, 50);
  }, true);

  // Defensive: if user clicks close or download and something still leaves backdrop, provide a global click/keyup escape to force clean
  window.addEventListener('click', function () {
    // if there's a backdrop and no visible modal, clean it
    const backdrop = document.querySelector('.modal-backdrop');
    const anyVisible = document.querySelectorAll('.modal.show').length > 0;
    if (backdrop && !anyVisible) cleanModalBackdrop();
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      // give Bootstrap a tick to hide, then clean
      setTimeout(() => {
        const anyVisible = document.querySelectorAll('.modal.show').length > 0;
        if (!anyVisible) cleanModalBackdrop();
      }, 80);
    }
  });

  // Extra: when we programmatically hide a modal (used for PDF generation), ensure the backdrop is removed after hide
  // (this avoids a stuck overlay if html2pdf runs while modal still closing)
  const policyModalEl = document.getElementById('policyModal');
  if (policyModalEl) {
    policyModalEl.addEventListener('hidden.bs.modal', () => {
      // ensure clean (again)
      setTimeout(cleanModalBackdrop, 50);
    });
  }

  // If you want to force-clean right now (for testing), uncomment:
  // cleanModalBackdrop();
})();
</script>


