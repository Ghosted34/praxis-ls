/**
 * The two dictionaries. English and French, this time in one file, because this
 * app has a much smaller surface than the ERP and every string in it is written
 * for a stranger.
 *
 * ── WHAT IS COPIED FROM `client/src/lib/i18n-dict.ts`, AND WHY THAT IS RIGHT ─
 *
 * `portal.*` is the tenant app's own section, moved rather than rewritten. The
 * French is reviewed copy that has been in front of clients for months; a second
 * translation of the same screen would be a second thing to maintain and the first
 * opportunity for the portal and the ERP to disagree about what "Answered" is
 * called. Same words, same language, one source.
 *
 * `site.*` is new: the marketing surfaces (`/public/*`) never had a dictionary —
 * `client/src/features/public/public-site.tsx` carried an inline EN/FR object.
 * The service descriptions and the hero are that file's copy, kept verbatim,
 * because they are the strings the team wrote for this product and no one asked
 * for a rewrite.
 *
 * ── THE FRENCH RULES THIS FILE OBEYS (doc/BRAND_GLOSSARY_FR_EN.md §5) ───────
 *
 * Narrow no-break space (U+202F) before `: ; ! ?` and inside guillemets; sentence
 * case in headings — French has no title case; accents on capitals; `15 %`,
 * `1 250 000,50 XAF`, `20 août 2026`; always `vous`. These are mechanical, they
 * are checkable, and in this market a missing thin space in a heading is read as
 * machine output. If you add a string, add the space.
 */

export const en = {
  common: {
    loading: "Loading…",
    retry: "Try again",
    back: "Back",
    close: "Close",
    refresh: "Refresh",
    download: "Download",
    send: "Send",
    status: "Status",
    none: "—",
  },
  /**
   * The four presentation states and the shipment vocabulary
   * (`components/state/`, doc/PUBLIC_WEB_PLAN.md §3.3).
   *
   * These sit at the top level rather than under `site` because the client
   * portal renders the same milestone chain: a stage that reads "In progress"
   * on the public page and something else once the client signs in is the
   * inconsistency §3.3 exists to prevent.
   */
  states: {
    loading: "Loading…",
    requestRef: "Support reference:",
    milestone: {
      completed: "Completed",
      current: "In progress",
      upcoming: "Upcoming",
    },
  },
  /**
   * Sentences shown when something FAILS.
   *
   * They live here, and not next to the code that throws them, for the reason
   * the rest of this file exists: this app is bilingual and a French visitor who
   * loses their connection should not be told about it in English. They were the
   * last English strings in the app, and they survived because `check:i18n`
   * scans `.tsx` files for text between JSX tags — a literal in a `.ts` module
   * was structurally invisible to it. The gate now reads `.ts` too.
   */
  errors: {
    loadFailed: "We could not load this page. Please try again in a moment.",
    rateLimited:
      "Too many attempts from this connection. Please try again in a few minutes.",
    network: "We could not reach the server. Check your connection and try again.",
    badResponse: "The server answered in a way we could not read.",
    intakeRateLimited: "Too many attempts. Please try again later.",
    generic: "Something went wrong. Please try again.",
    docGone: "That document is no longer available.",
    roomDocGone: "That document is no longer in the data room.",
    sessionExpired: "Your session has expired — sign in again.",
    downloadFailed: "Download failed.",
    exportFailed: "We could not export the conversation.",
    fileTooLarge: "That file is {{size}} MB — the limit is {{limit}} MB.",
    fileUnreadable:
      "That file could not be read. Try saving it again, or pick another.",
  },
  shell: {
    signOut: "Sign out",
  },

  /* ── The portal: verbatim from the staff app (see the header note) ────── */
  portal: {
    signInPromise: [
      "Live status on every shipment we are moving for you.",
      "Every document we hold on your file, ready to download.",
      "A message line straight to the team handling your cargo.",
    ],
    invited: "Have an invitation link?",
    trackWithout: "Track a shipment without signing in",
    hintTreasury: "Class-5 balances will appear here.",
    hintLedger: "No ledger movements for this period.",
    hintTrail: "Financial and document postings for the period will appear here.",
    hintRooms: "Requests you make and the documents shared in answer appear here.",
    describeFirst: "Describe the document you need first.",
    accessRunsTo: "Your access runs to {{date}}.",
    yourShipments: "Your current shipments and invoices.",
    portalName: "Client portal",
    signIn: "Sign in",
    signingIn: "Signing in…",
    forgotPassword: "Forgot your password?",
    signInSub: "Track your shipments, documents and invoices.",
    email: "Email",
    password: "Password",
    welcome: "Welcome",
    shipments: "Shipments",
    invoices: "Invoices",
    documents: "Documents",
    onboarding: "Onboarding",
    messages: "Messages",
    requestQuote: "Request a quote",
    myQuotes: "My quote requests",
    financials: "Financials",
    auditRoom: "Audit room",
    dataRoom: "Data room",
    // Both sentences appear where the reader is deciding whether to trust a
    // number or send a message, so each says what happened and what to do — no
    // apology and no exclamation mark, nothing that reads as an error state.
    unbalancedHint:
      "Assets and liabilities do not balance for this period — the figures are provisional.",
    dataRoomHint:
      "Ask the tenant for a document — a signed transit order, a customs file — and the documents they share with you appear here.",
    noActiveAccess: "No active access",
    noActiveAccessHint:
      "Your access has expired or been withdrawn. Please contact your account manager.",
    noShipments: "No shipments yet",
    noShipmentsHint: "New files will appear here as they're opened.",
    nothingOutstanding: "Nothing outstanding",
    nothingOutstandingHint: "Issued invoices will appear here.",
    noDocuments: "No documents yet",
    noDocumentsHint:
      "Files your team shares with you will appear here — bills of lading, waybills and other shipment documents.",
    downloading: "Downloading…",
    filed: "Filed",
    opened: "Opened",
    due: "Due",
    noMessages:
      "No messages yet — ask your account team anything about your shipments.",
    writeMessage: "Write a message to your account team…",
    sending: "Sending…",
    exportChat: "Export chat (PDF)",
    exporting: "Exporting…",
    accountComplete: "Your account",
    complete: "complete",
    requestQuoteSub:
      "Tell us about your shipment and we'll come back with a price.",
    service: "Service (Sea freight import…)",
    serviceType: "Service type (optional)",
    origin: "Origin (POL)",
    destination: "Destination (POD)",
    weight: "Est. weight (kg)",
    incoterm: "Incoterm (FOB, CIF…)",
    cargo: "Cargo description (optional)",
    submitting: "Submitting…",
    noQuotes: "No quote requests",
    noQuotesHint: "Quotes you request appear here with their status.",
    requestDocument: "Request document",
    requesting: "Requesting…",
    whatDocument: "What document do you need, and for which period/file?",
    noRequests: "No requests yet",
    noRequestsHint:
      "Requests you make and the documents shared in answer appear here.",
    answered: "Answered",
    open: "Open",
    noDocsShared:
      "No documents shared yet — the tenant has not answered this request.",
    shared: "Shared",
    accessTo: "access to",
    basis: "basis",
    haveAccess: "Already have access?",
    noAccess: "Need access to your shipments?",
    noAccessHint:
      "Access is issued by your account manager. Ask them for an invitation and you can set your own password.",
    needEmailFirst: "Enter your email address first.",
    forgotSent:
      "If that address has portal access, we've sent a link to set a new password. It can only be used once.",
    signInFailed: "We couldn't sign you in with that email and password.",
    backToSignIn: "Back to sign in",
    setPasswordTitle: "Choose a password",
    oneTimeLink: "This link can only be used once.",
    incompleteLink:
      "That link is incomplete. Please use the link exactly as it appears in your email.",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    passwordHint:
      "At least 12 characters. We also check it against known data breaches.",
    passwordMismatch: "The two passwords don't match.",
    setPasswordFailed:
      "That password was not accepted. Please try a different one.",
    saving: "Saving…",
    setPasswordCta: "Set password and continue",
    backToShipments: "All shipments",
    progress: "Progress",
    stepsDone: "{{done}} of {{total}} steps complete",
    noStages: "Nothing to show yet",
    noStagesHint: "Steps appear here as your file is set up.",
    completedOn: "Completed {{date}}",
    expectedOn: "Expected {{date}}",
    scheduledLater: "Scheduled once the shipment is under way",
    trackingNow: "now tracking {{date}}",
    askAboutThis: "Ask about this",
    askTitle: "Ask about this step",
    askIntro:
      "Your query goes to the team handling this shipment and stays attached to the file.",
    askPlaceholder: "What's holding this up?",
    askLabel: "Your question",
    aboutStage: "About: {{label}}",
    querySentTitle: "Query sent",
    querySentBody:
      "Thank you — the team handling this shipment has it, and you will see the reply here.",
    assumptionsTitle: "What these dates assume",
    assumptionsIntro:
      "Your schedule depends on parties whose hours we do not control. These are the conditions it was built on.",
    statusTodo: "To do",
    statusInProgress: "In progress",
    statusDone: "Done",
    statusBlocked: "On hold",
  },

  /* ── The marketing surfaces ─────────────────────────────────────────── */
  site: {
    chrome: {
      skip: "Skip to content",
      language: "Language",
      theme: "Theme",
      themeLight: "Light theme",
      themeDark: "Dark theme",
      menu: "Menu",
      closeMenu: "Close menu",
      login: "Sign in",
      portalEntry: "Client portal",
      toEnglish: "Read this page in English",
      toFrench: "Lire cette page en français",
      home: "Home",
    },
    nav: {
      about: "About",
      services: "Services",
      track: "Track",
      portfolio: "Our work",
      insights: "Insights",
      careers: "Careers",
      contact: "Contact",
      /* The services panel. Its own keys rather than reused ones: "All
         services" is a destination and `nav.services` is a section, and a
         dictionary that conflates them is a dictionary that breaks the day
         somebody renames one of them. */
      servicesToggle: "Show services",
      servicesAll: "All services",
      servicesMore: "+{{count}} more",
      servicesPitch:
        "Not sure which one you need? Describe the shipment and the right desk answers.",
    },
    /**
     * Insights — the renamed Kaizen Hub (WS5). "Insights" everywhere: module,
     * route and the label a reader sees. The old name was ambiguous in two
     * directions, and a hub nobody can place is a hub nobody opens.
     */
    corridor: {
      eyebrow: "The network",
      title: "The corridors we run",
      /* Two subtitles, because the scene has two honest states. The second one
         is shown when the ledger has nothing to publish, and it says so rather
         than letting an ornament be read as a route map. */
      sub: "Every lane here is one we have completed files on. Move through it.",
      subAbstract: "A picture of how a network fits together. Ours fills in as files complete.",
      figureLabel: "Corridor network — use the arrow keys to move between places",
      figureLabelAbstract: "An illustration of a network",
      /* Shown only where a public entity of the tenant's covers that country —
         "we are here", which is a stronger claim than "we deliver here". */
      present: "We are here",
      files: "files",
      tilt: "Move the scene by tilting your phone",
    },
    /**
     * The About page (§9.1) and everything on it — the entity network (§9.2),
     * the leadership renderer (§9.3) and the three proof treatments (§9.4).
     *
     * ── ALMOST NOTHING HERE IS CONTENT ────────────────────────────────────
     *
     * Every fact on that page is the tenant's: their mission, their timeline,
     * their people, their partners. What lives in this dictionary is the
     * FURNITURE — the heading over the tenant's own list, the word "Founded"
     * before their year, the sentence that wraps a person's name into an alt
     * attribute. That split is why `site.about.sub` is the only sentence with
     * any prose in it, and why it only ever renders for a tenant who has
     * written no summary of their own.
     *
     * ── THE `{{name}}` STRINGS ARE ALT TEXT, AND THAT IS DELIBERATE ───────
     *
     * `portraitAlt`, `entityCoverAlt`, `markAlt` and `linkedinOf` interpolate a
     * proper noun the tenant typed. The NAME is not translated — a company's
     * trademark and a person's name are theirs in both languages — and the
     * sentence around it is. That is the whole reason the asset upload control
     * has no alt-text field: a second copy of a name, typed into a form, is
     * the copy a screen-reader user hears after somebody fixes a spelling in
     * the first.
     */
    about: {
      title: "About us",
      kicker: "Who we are",
      titleMain: "The people behind",
      titleAccent: "the freight",
      sub: "A logistics group, its companies, and the people who run them.",
      founded: "Founded",
      hq: "Head office",

      storyKicker: "Our story",
      storyTitle: "What we are for",
      mission: "Our mission",
      vision: "Where we are going",
      principles: "How we work",

      messageKicker: "From the desk",
      messageTitle: "A word from our chief executive",

      timelineKicker: "Our history",
      timelineTitle: "How we got here",
      timelineYear: "Year",

      peopleKicker: "Leadership",
      peopleTitle: "The people accountable",
      readBio: "Read biography",
      linkedin: "LinkedIn",
      linkedinOf: "{{name}} on LinkedIn",
      portraitAlt: "Portrait of {{name}}",

      networkKicker: "The group",
      networkTitle: "Our companies",
      networkLead:
        "Each one is a registered company with its own licences, its own people and its own ground. Where two of them cover the same country, the ring joins them.",
      networkLabel:
        "Our companies as a network — use the arrow keys to move between them",
      /* A LABEL AND A NUMBER, not a pluralised sentence.
         i18next resolves `key_one` / `key_other` at runtime, but
         `check:i18n` reads the dictionary statically and sees only a `t()`
         call for a key that does not exist — so a plural pair is a dangling
         call to the gate and a working string to the browser, which is the
         worst of the two. Recorded as a finding. A label avoids the
         agreement problem in both languages at every count. */
      networkPlaces: "Coverage: {{count}}",
      entityFocus: "What it handles",
      entityCoverage: "Where it operates",
      entityAddress: "Registered address",
      entityPeople: "Who runs it",
      entityCoverAlt: "{{name}}",

      proofKicker: "Proof",
      proofTitle: "Accredited, and accountable",
      credentialsTitle: "Certifications and licences",
      credentialRef: "Reference",
      credentialIssued: "Issued",
      credentialValid: "Valid until",
      membershipsTitle: "Memberships",
      /* NOT "Trusted by" (N11). The heading states the relationship; whether
         it is impressive is the reader's call, and telling them is the
         sentence a procurement officer discounts. */
      clientsTitle: "Organisations we work with",
      carriersTitle: "The lines we move on",
      carriersLead:
        "Carriers and networks we book capacity with. Their marks are theirs; we show them with permission.",
      markAlt: "{{name}}",
    },
    announce: {
      /* The band under the hero. Two strings, and that is the whole surface:
         everything else in it is the tenant's own announcement. */
      eyebrow: "Latest",
      more: "All announcements",
    },
    insights: {
      kicker: "Insights",
      title: "What we are learning",
      titleMain: "What we are",
      titleAccent: "learning",
      sub: "Notes from the desk on customs, freight and the corridors we work — written by the people doing the work.",
      filterLabel: "Filter by topic",
      /* §8.6's kind filter. The COARSER cut, above the topics: "articles or
         announcements" is a different question from "which subject", and a
         reader who wants the notices should not hunt for them among essays. */
      kindLabel: "Filter by kind",
      kindAll: "Everything",
      kindArticle: "Articles",
      kindAnnouncement: "Announcements",
      all: "All",
      loading: "Loading the articles…",
      loadingArticle: "Loading the article…",
      pagination: "Pages",
      previous: "Previous",
      next: "Next",
      pageOf: "Page {{page}} of {{total}}",
      none: "Nothing published yet",
      noneHint:
        "The desk writes these as the work throws up something worth passing on. Come back, or ask us directly.",
      noneForTag: "Nothing under that topic yet",
      noneForTagHint: "Other topics have articles — clear the filter to see them.",
      showAll: "Show every article",
      by: "By",
      backToIndex: "All articles",
      gone: "That article is not here",
      goneHint:
        "The link may be old, or mistyped. Everything published is on the index.",
      otherLanguageOnly:
        "This article has not been translated yet. Switch language to read it.",
      gallery: "Images from this article",
    },
    hero: {
      eyebrow: "Logistics · Customs · Warehousing",
      title: "Freight that moves your business forward",
      titleMain: "Freight that moves your business",
      titleAccent: "forward",
      sub: "Sea, air and hinterland logistics across the OHADA/CEMAC region — with one team, one platform, and total visibility.",
      cta: "Request a quote",
      cta2: "Track a shipment",
      /* The cue under the hero's figure rail. Decorative and aria-hidden — it
         names a gesture rather than a destination — but it is still a visible
         sentence, so it is a dictionary string and not a literal. */
      scrollCue: "Scroll to explore",
    },
    track: {
      kicker: "Shipment visibility",
      title: "Where is my cargo?",
      label: "File or container reference",
      placeholder: "e.g. SBL-OPS-2026-0142",
      submit: "Track",
      busy: "Tracking…",
      hint: "Enter the reference printed on your shipment documents. No account needed.",
      notFound:
        "We could not find that reference. Check it against your documents and try again.",
      empty: "Enter a reference to see its progress.",
      reference: "File reference",
      current: "Current stage",
      notFoundHint:
        "Tracking works on the exact reference printed on your documents — a bill of lading number will not match until the desk has opened a file.",
      limited:
        "Too many tracking attempts from this connection. Wait a few minutes and try again.",
      limitedHint:
        "The limit is per network, not per person: an office behind one connection shares it.",
    },
    services: {
      eyebrow: "Services",
      title: "What we do",
      sub: "One team handles the movement, the paperwork and the money behind it.",
      more: "See this service",
      all: "All services",
      items: [
        {
          t: "Sea & air freight",
          d: "Imports and exports with the routing, documentation and customs work handled end to end.",
        },
        {
          t: "Customs clearance",
          d: "DGI-compliant declarations, tax exemptions and red-channel handling that keep your cargo moving.",
        },
        {
          t: "Warehousing",
          d: "Bonded and general warehousing with stock visibility from your phone.",
        },
        {
          t: "Hinterland transport",
          d: "Trucking from Douala, Kribi and Yaoundé to anywhere in the sub-region.",
        },
      ],
    },
    how: {
      eyebrow: "How it works",
      title: "What working with us looks like",
      sub: "Three moves, and you always know which one you are in.",
      steps: [
        {
          t: "You send the shipment",
          d: "A quote request or a phone call, with the origin, the destination and what you are moving.",
        },
        {
          t: "We price and book",
          d: "Routing, carrier, customs treatment and a written proposal you can forward to whoever approves it.",
        },
        {
          t: "You watch it move",
          d: "Every stage on a tracking page, and every document in your portal — no chasing by email.",
        },
      ],
    },
    proof: {
      eyebrow: "Case notes",
      title: "Work we can show you",
      sub: "Published case notes from operations we have run.",
      more: "Read the story",
      empty:
        "We publish case notes as work finishes. Nothing to show yet — ask us for references instead.",
      lanes: "Lanes we run",
      lanesSub:
        "Completed files over the last 24 months, counted from the operations ledger.",
      files: "completed files",
      /* The proof strip's accessible name. Every visible word in that band is
         the tenant's own content, so this is the only string it needs — and it
         needs one, because a landmark with no name is a landmark a screen
         reader announces as "region". */
      stripLabel: "Key figures",
    },
    portalBand: {
      eyebrow: "Client portal",
      title: "Your shipments, documents and invoices in one place",
      sub: "Clients get a portal: live file status, every document we hold for you, and a message line to the team handling your cargo.",
      cta: "Open the client portal",
      invited: "Have an invitation link? Set your password there.",
    },
    /* ── The ESG interactive (§8.4) ────────────────────────────────────────
       THE PILLAR NAMES ARE OURS; EVERYTHING INSIDE A PILLAR IS THE TENANT'S.
       Environment / Social / Governance is the standard triad — naming the
       three columns is a layout decision, not a claim about this company — and
       `packages/shared/schemas/site-settings.js` fixes them to exactly three
       for that reason. The prose and every bullet come from `site_about.esg`,
       which is why there is no fallback copy here: a tenant who has written no
       ESG gets no band, not our words under their logo (N12). */
    esg: {
      kicker: "Responsibility",
      title: "How we",
      titleAccent: "operate",
      environment: "Environment",
      social: "Social",
      governance: "Governance",
      figureAlt: "{{pillar}} — the commitments listed beside this drawing, drawn",
    },
    quote: {
      title: "Get a quote",
      sub: "Tell us about your shipment and we'll come back with a price.",
      /* The standalone /quote page: an eyebrow pill, and a heading whose second
         half carries the accent colour (UI_UPGRADE_PLAN §4 pattern 2). */
      kicker: "Quote desk",
      titleMain: "Tell us about",
      titleAccent: "your shipment",
      whatHappens: "What happens next",
      bandLead:
        "Four short steps — what you need, the route, the cargo, and where to send the answer. Most take under two minutes.",
      bandCta: "Start a quote",
      /* The second door, and it is a LINK not a button — §7.6's hierarchy.
         Tracking is the service; the quote is the conversion. */
      bandTrack: "Track a shipment",
      name: "Your name",
      company: "Company",
      email: "Email",
      phone: "Phone (optional)",
      service: "Service",
      servicePick: "Choose a service",
      servicePlaceholder: "Sea freight import",
      origin: "Origin (POL)",
      originPlaceholder: "e.g. Shanghai",
      destination: "Destination (POD)",
      destinationPlaceholder: "e.g. Douala",
      incoterm: "Incoterm",
      incotermPick: "Choose an Incoterm",
      cargo: "Cargo description",
      cargoHint:
        "Weight, volume, container count, commodity, hazmat — anything the desk needs to price it.",
      /* ── WS2: the four-step wizard ─────────────────────────────────── */
      stepsLabel: "Quote steps",
      stepNeed: "What you need",
      stepRoute: "Route",
      stepStorage: "Storage",
      stepDetails: "Cargo details",
      stepContact: "Your details",
      /* Keyed by STEP, not by position. The route step does not exist for a
         service the tenant has marked as having no movement to describe, so
         "stepHint2" meant the cargo step on a four-step enquiry and the contact
         step on a three-step one. */
      stepHint_need: "Two answers, so we know which desk this belongs to.",
      stepHint_route: "Where it starts and where it has to end up.",
      stepHint_details: "Everything here is optional — each answer makes the price closer to final.",
      stepHint_contact: "Where to send the answer.",
      next: "Continue",
      mode: "How is it moving?",
      modeSEA: "By sea",
      modeSEAHint: "Containers, FCL or LCL, through the ports we clear.",
      modeAIR: "By air",
      modeAIRHint: "Time-critical cargo and anything on a deadline.",
      modeROAD: "By road or rail",
      modeROADHint: "Cross-border haulage and hinterland transit.",
      modeWAREHOUSE: "Storage only",
      modeWAREHOUSEHint: "Secure storage and handling, no transport leg.",
      /* RAIL, CUSTOMS and OTHER exist because the mode list is now read off the
         tenant's published services rather than hardcoded to four. A tenant
         whose business is customs brokerage, or who runs the Douala–N'Djamena
         rail corridor as its own line, gets a card for it — and OTHER is a real
         answer, not a miss: a service none of the six words describes belongs on
         the form rather than dropped from it. */
      modeMore: "+{{count}} more",
      modeRAIL: "By rail",
      modeRAILHint: "Rail corridors and the road legs at either end of them.",
      modeCUSTOMS: "Customs only",
      modeCUSTOMSHint: "Clearance and declarations, with the transport arranged elsewhere.",
      modeOTHER: "Something else",
      modeOTHERHint: "Anything the four above do not describe — tell us and we will route it.",
      stepCounter: "Step {{step}} of {{total}}",
      originPort: "Port of loading",
      destinationPort: "Port of discharge",
      originAirport: "Airport of departure",
      destinationAirport: "Airport of arrival",
      originPlace: "Place of collection",
      destinationPlace: "Place of delivery",
      placeHint: "Start typing and pick from the list, or just type it — both work.",
      placeSuggestions: "Place suggestions",
      incotermHint: "The delivery term agreed with your supplier. Ask them if you are not sure.",
      warehouseLocation: "Where do you need the storage?",
      warehousePlaceholder: "e.g. Douala, Bonabéri",
      warehouseDuration: "For how long?",
      durationPick: "Choose a duration",
      durationLESS_THAN_7_DAYS: "Under a week",
      durationDAYS_7_TO_14: "One to two weeks",
      durationDAYS_15_TO_30: "Two weeks to a month",
      durationOVER_30_DAYS: "More than a month",
      durationUNKNOWN: "Not sure yet",
      weight: "Estimated weight (kg)",
      weightHint: "A rough figure is enough.",
      projectCargo: "Project or out-of-gauge cargo",
      projectCargoHint: "Oversized, heavy-lift, or anything that will not fit a standard container.",
      attachment: "Attach a document (optional)",
      attachmentHint: "A packing list, a proforma invoice or a photo. PDF, PNG or JPEG, up to 8 MB.",
      fileType: "That file type is not accepted. Send a PDF, a PNG or a JPEG.",
      fileTooLarge: "That file is {{size}} — the limit is {{limit}}.",
      fileUnreadable: "That file could not be read. Try another copy of it.",
      fileRemove: "Remove the attachment",
      notes: "Anything else we should know?",
      notesHint: "Deadlines, special handling, a reference of your own.",
      errMode: "Choose how the cargo is moving.",
      errService: "Choose the service you need.",
      errOrigin: "Tell us where it starts.",
      errDestination: "Tell us where it has to end up.",
      errIncoterm: "Choose an Incoterm.",
      errWarehouse: "Tell us where you need the storage.",
      errName: "Tell us your name.",
      errEmail: "Enter an email address we can reply to.",
      submit: "Request quote",
      sending: "Sending…",
      sent: "Thank you — we've received your request and will reply shortly.",
      reference: "Your quote reference is",
      err: "Something went wrong. Please try again.",
      limited:
        "Too many requests from this connection. Please try again in an hour, or call us.",
      privacy: "Your details are only used to answer your request.",
      requiredNote: "Fields marked with * are required.",
      steps: [
        {
          t: "You get a reference",
          d: "Straight away, on the screen — quote it on the phone or in an email and anyone here can find your request.",
        },
        {
          t: "The desk sees it",
          d: "Requests land in one queue with the leads from the sales team, so nothing waits behind a form nobody monitors.",
        },
        {
          t: "We come back on the same channel",
          d: "Email if you left an email, a call if you left a phone number.",
        },
      ],
    },
    contact: {
      title: "Talk to someone",
      sub: "Questions, partnership, or a shipment that is going wrong — this reaches the desk that handles it.",
      /* The standalone /contact page: an eyebrow pill, and a heading whose
         second half carries the accent colour (UI_UPGRADE_PLAN §4 pattern 2). */
      kicker: "Contact desk",
      titleMain: "Talk to",
      titleAccent: "someone here",
      bandLead:
        "A question, a partnership, or a file that has gone wrong. Every message comes back with a reference, and nothing needs an account.",
      bandCta: "Send a message",
      otherTitle: "Faster than a message",
      otherTrack:
        "A reference is enough. The same milestones the desk would read back to you, without waiting for a reply.",
      /* §8.5's coverage figure. "Where are you" is the second question a
         contact page is asked, and this one could not answer it. */
      coverageKicker: "Presence",
      coverageTitle: "Where we are, and where we deliver",
      coverageAlt:
        "A diagram linking each office to the places it covers. The same offices and places are listed as text below.",
      offices: "Offices",
      covers: "Delivers to",
      coverageNone: "Coverage areas are not published for these offices yet.",
      otherPortal:
        "Already a client. Your files, documents and invoices, with nothing to look up.",
      otherQuote:
        "Pricing a shipment. Four short steps put it in front of the desk that quotes it.",
      otherGo: "Open",
      subject: "Subject (optional)",
      type: "What is this about?",
      typeGeneral: "A shipment or a quote",
      typePartnership: "Agency or vendor partnership",
      typeCareers: "A job application",
      typeMedia: "Press or media",
      message: "How can we help?",
      send: "Send message",
      sending: "Sending…",
      sent: "Received. We'll come back to you by email.",
      err: "Something went wrong. Please try again.",
      limited:
        "Too many messages from this connection. Please try again in an hour.",
      promise: [
        {
          t: "A reference, not a black hole",
          d: "Every message gets one, and it is shown on screen the moment it is sent.",
        },
        {
          t: "Routed, not forwarded",
          d: "Choosing what your message is about puts it in front of the desk that answers that kind of question.",
        },
        {
          t: "No account needed",
          d: "If you are already a client, the portal is quicker for anything about a shipment you have with us.",
        },
      ],
    },
    proposals: {
      title: "Proposal",
      client: "Prepared for",
      route: "Route",
      lines: "Costs",
      expireNote:
        "This page is the same document as the PDF — including the figures, which we do not re-format here.",
      unavailable: "This proposal link is no longer valid.",
      unavailableHint:
        "Shared proposals expire. Ask your contact to send a fresh link.",
      download: "Download PDF",
      print: "Print",
    },
    footer: {
      company: "Company",
      services: "Services",
      clients: "For clients",
      legal: "Legal",
      rights: "All rights reserved.",
      powered: "Powered by JBS Praxis",
      about: "About",
      contact: "Contact",
      portfolio: "Success stories",
      careers: "Careers",
      track: "Track a shipment",
      portal: "Client portal",
      quote: "Request a quote",
      privacy: "Privacy",
      terms: "Terms of service",
      newsletter:
        "One occasional note on routes, capacity and customs changes. No marketing.",
      newsletterCta: "Subscribe",
      sending: "Sending…",
      newsletterEmail: "Email address",
      newsletterOk: "You're on the list.",
      newsletterLimited:
        "Too many sign-ups from this connection. Please try again in an hour.",
      newsletterErr: "That address did not work. Please try again.",
      /* §9.5. `social` names the nav landmark; `socialOn` is the accessible
         name of one link, because a row of seven links all called "Social" is
         a row a screen-reader user cannot navigate. */
      social: "Social",
      socialOn: "{{platform}}, in a new tab",
      credentials: "Accredited:",
      legalEntity: "Legal entity:",
    },
    preview: {
      reference: "SBL-OPS-2026-0142",
      status: "In progress",
      stages: [
        { label: "File opened", state: "done" },
        { label: "Vessel departed", state: "done" },
        { label: "Customs cleared", state: "done" },
        { label: "Delivery scheduled", state: "current" },
      ],
    },
    servicesPage: {
      title: "Services",
      /* Split for §8.2's entrance, the way every other hero title is: the
         accent word is the one the eye lands on, and `SectionHead` colours it
         per ground (`--brand-orange` on the plate, `--primary-ink` on white). */
      titleMain: "What we",
      titleAccent: "handle",
      sub: "What we handle, end to end.",
      empty:
        "Service pages are being written. Ask for a quote in the meantime.",
      unavailable: "This service page is not published.",
      coverage: "Coverage",
      highlights: "What is included",
      faq: "Questions we are asked",
      related: "Related services",
      gallery: "From the yard",
      updated: "Published",
      cta: "Get a quote for this service",
      back: "All services",
      noLong: "The full description for this service is being written.",
      video: "Watch",
      onThisPage: "On this page",
      readMore: "Read the full detail",
      readLess: "Show less",
    },
    portfolioPage: {
      title: "Success stories",
      titleMain: "Success",
      titleAccent: "stories",
      sub: "Operations we have run, in our own words.",
      empty: "Nothing published yet.",
      unavailable: "Story unavailable",
      back: "All stories",
      summary: "The brief",
      execution: "How it ran",
      results: "What it changed",
      client: "Client",
    },
    trackPage: {
      title: "Track a shipment",
      titleMain: "Track a",
      titleAccent: "shipment",
      sub: "Enter the exact file reference shown on your shipment documents.",
      progress: "Progress",
      ofStages: "client-visible stages",
      current: "Current stage",
      timeline: "Shipment timeline",
      origin: "Origin",
      destination: "Destination",
      needAccount:
        "Only the stages your account manager makes visible appear here. For anything else, your portal shows the documents.",
      openPortal: "Open the client portal",
      service: "Service",
      lastUpdate: "Last update",
      lastUpdateNone: "No stage completed yet",
      closed: "All visible stages are complete",
      noStages: "This file has no client-visible stages yet",
      noStagesHint:
        "The desk publishes each stage as it is confirmed. Come back once the first one is marked, or open the portal for the documents already on file.",
      loading: "Looking up that reference…",
      searchAgain: "Try another reference",
      /* ── §8.1's verdict line ────────────────────────────────────────────
         Three statuses, written as an ANSWER rather than as a record's state.
         "IN_PROGRESS" is what the column says; "On the move" is what somebody
         who asked where their cargo is wants to read. */
      theAnswer: "Where this shipment is",
      verdictOpened: "Opened, not yet moving",
      verdictMoving: "On the move",
      verdictDone: "Delivered",
      /* Deliberately NOT "estimated arrival". There is no ETA in this API and no
         feed behind this page — this is the date the desk scheduled for the last
         outstanding stage, and it is labelled as exactly that. */
      scheduled: "Scheduled",
      noSchedule: "No stage has been scheduled on this file yet.",
      whereRef:
        "The reference is on the documents your account manager sent you — the booking confirmation, the transport order or the invoice.",
      noMatch: "No match",
      notFoundNotLost:
        "This says nothing about your cargo. It means no file on this site carries that exact reference — most often a digit read across from a photograph, or a reference from a different provider.",
      askDesk: "Ask the desk",
      tooMany: "Too many lookups",
      /* SHORT, because it sits at display size. `errors.loadFailed` is a full
         sentence and belongs under a title, not as one. */
      failedTitle: "The lookup did not go through",
    },
    notFound: {
      kicker: "Wrong turn",
      title: "That page does not exist",
      hint: "The link may be old, or mistyped. Start from the homepage, or track a shipment by reference.",
      home: "Back to the homepage",
    },
    crash: {
      title: "This page stopped working",
      hint: "Nothing you sent us is lost — a request that had already gone through is on its way to the desk. Reloading usually fixes it. If it does not, the homepage gets you to the same forms.",
      reload: "Reload the page",
      home: "Back to the homepage",
    },
  },

  /* English-text → display string. `tr()` falls back to the key itself, so
     anything not listed here renders English harmlessly rather than blank. */
  strings: {
    Account: "Account",
    "Audit trail": "Audit trail",
    "Cash on hand": "Cash on hand",
    "Cash position": "Cash position",
    Charges: "Charges",
    Credit: "Credit",
    Debit: "Debit",
    Progress: "Progress",
    Revenue: "Revenue",
    Total: "Total",
    "Trial balance": "Trial balance",
    Due: "Due",
    Completed: "Completed",
    Location: "Location",
    Reference: "Reference",
    "Shipment reference": "Shipment reference",
    Documents: "Documents",
    Shipments: "Shipments",
    Invoices: "Invoices",
    Messages: "Messages",
    English: "English",
    Français: "Français",
    "Origin pending": "Origin pending",
    "Destination pending": "Destination pending",
    "Current stage": "Current stage",
    "Shipment timeline": "Shipment timeline",
    Preparing: "Preparing",
    "In progress": "In progress",
    "Progress note": "Progress note",
    // Status-pill vocabulary. `Pill` prints `tr(enumLabel(status))`, so every
    // token any public screen can receive has to appear here in both languages,
    // or the French page shows an English pill — the exact defect that made the
    // portal read half-translated before the `tr()` hop was added to `Pill`.
    "Not started": "Not started",
    Pending: "Pending",
    Current: "Current",
    Upcoming: "Upcoming",
    Warning: "Warning",
    Attention: "Attention",
    Done: "Done",
    Scheduled: "Scheduled",
    Draft: "Draft",
    Sent: "Sent",
    Open: "Open",
    Closed: "Closed",
    New: "New",
    Active: "Active",
    Paused: "Paused",
    Expired: "Expired",
    Cancelled: "Cancelled",
    Approved: "Approved",
    Rejected: "Rejected",
    Accepted: "Accepted",
    Signed: "Signed",
    Issued: "Issued",
    Published: "Published",
    Paid: "Paid",
    Overdue: "Overdue",
    Won: "Won",
    Lost: "Lost",
    Qualified: "Qualified",
    Converted: "Converted",
    Reviewing: "Reviewing",
    Triaged: "Triaged",
    Green: "Green",
    Amber: "Amber",
    Red: "Red",
    "Full time": "Full time",
    "Part time": "Part time",
    Internship: "Internship",
    Contract: "Contract",
    Freelance: "Freelance",
    "Loading…": "Loading…",
    "Compte de résultat": "Income statement",
    Bilan: "Balance sheet",
    Produits: "Revenue",
    Actif: "Assets",
    Passif: "Liabilities",
    Résultat: "Result",
    "Résultat net": "Net result",
    "Hors activités ordinaires (net)": "Non-recurring items (net)",
    "Net result": "Net result",
    "Balance sheet total": "Balance sheet total",
    "Produits for the period": "Revenue for the period",
    "Produits less charges": "Revenue less expenses",
    "Today, not period-end": "Today, not period-end",
    "No movements": "No movements",
    "No postings": "No postings",
    "No requests yet": "No requests yet",
    "No treasury accounts": "No treasury accounts",
    "No ledger movements for this period.":
      "No ledger movements for this period.",
    "Class-5 balances will appear here.": "Class-5 balances will appear here.",
    "Financial and document postings for the period will appear here.":
      "Financial and document postings for the period will appear here.",
    "Requests you make and the documents shared in answer appear here.":
      "Requests you make and the documents shared in answer appear here.",
    "What document do you need, and for which period/file?":
      "What document do you need, and for which period/file?",
    "Describe the document you need first.":
      "Describe the document you need first.",
    "Your current shipments and invoices.":
      "Your current shipments and invoices.",
    "No active access": "No active access",
    "Quote request": "Quote request",
    "Request document": "Request document",
    "Account team": "Account team",
    "Ask your account team": "Ask your account team",
    "Write a message…": "Write a message…",
    "Something went wrong. Please try again.":
      "Something went wrong. Please try again.",
  },
} as const;

export const fr = {
  common: {
    loading: "Chargement…",
    retry: "Réessayer",
    back: "Retour",
    close: "Fermer",
    refresh: "Actualiser",
    download: "Télécharger",
    send: "Envoyer",
    status: "Statut",
    none: "—",
  },
  states: {
    loading: "Chargement…",
    requestRef: "Référence support :",
    milestone: {
      completed: "Terminée",
      current: "En cours",
      upcoming: "À venir",
    },
  },
  errors: {
    loadFailed:
      "Nous n’avons pas pu charger cette page. Veuillez réessayer dans un instant.",
    rateLimited:
      "Trop de tentatives depuis cette connexion. Veuillez réessayer dans quelques minutes.",
    network:
      "Nous n’avons pas pu joindre le serveur. Vérifiez votre connexion et réessayez.",
    badResponse: "Le serveur a répondu d’une manière que nous n’avons pas pu lire.",
    intakeRateLimited: "Trop de tentatives. Veuillez réessayer plus tard.",
    generic: "Une erreur est survenue. Veuillez réessayer.",
    docGone: "Ce document n’est plus disponible.",
    roomDocGone: "Ce document n’est plus dans la data room.",
    sessionExpired: "Votre session a expiré — reconnectez-vous.",
    downloadFailed: "Échec du téléchargement.",
    exportFailed: "Nous n’avons pas pu exporter la conversation.",
    fileTooLarge: "Ce fichier fait {{size}} Mo — la limite est de {{limit}} Mo.",
    fileUnreadable:
      "Ce fichier n’a pas pu être lu. Enregistrez-le à nouveau ou choisissez-en un autre.",
  },
  shell: {
    signOut: "Se déconnecter",
  },

  portal: {
    signInPromise: [
      "Le statut en direct de chaque expédition que nous traitons pour vous.",
      "Tous les documents de votre dossier, prêts à télécharger.",
      "Une ligne directe vers l’équipe qui gère votre marchandise.",
    ],
    invited: "Vous avez un lien d’invitation ?",
    trackWithout: "Suivre une expédition sans se connecter",
    hintTreasury: "Les soldes de classe 5 apparaîtront ici.",
    hintLedger: "Aucun mouvement comptable pour cette période.",
    hintTrail: "Les écritures financières et documentaires de la période apparaîtront ici.",
    hintRooms: "Vos demandes et les documents transmis en réponse apparaîtront ici.",
    describeFirst: "Décrivez d’abord le document dont vous avez besoin.",
    accessRunsTo: "Votre accès court jusqu’au {{date}}.",
    yourShipments: "Vos expéditions et factures en cours.",
    portalName: "Portail client",
    signIn: "Connexion",
    signingIn: "Connexion…",
    forgotPassword: "Mot de passe oublié ?",
    signInSub: "Suivez vos expéditions, documents et factures.",
    email: "Courriel",
    password: "Mot de passe",
    welcome: "Bienvenue",
    shipments: "Expéditions",
    invoices: "Factures",
    documents: "Documents",
    onboarding: "Intégration",
    messages: "Messages",
    requestQuote: "Demander un devis",
    myQuotes: "Mes demandes de devis",
    financials: "Finances",
    auditRoom: "Salle d’audit",
    dataRoom: "Data room",
    // Miroir des deux phrases ci-dessus. §5 : apostrophe typographique, aucune
    // espace avant la virgule, espace insécable étroit avant un « ? ».
    unbalancedHint:
      "L’actif et le passif ne s’équilibrent pas pour cette période — les chiffres sont provisoires.",
    dataRoomHint:
      "Demandez un document à l’entreprise — un ordre de transit signé, un dossier douanier — et les documents partagés avec vous apparaîtront ici.",
    noActiveAccess: "Aucun accès actif",
    noActiveAccessHint:
      "Votre accès a expiré ou a été retiré. Veuillez contacter votre gestionnaire de compte.",
    noShipments: "Aucune expédition",
    noShipmentsHint:
      "Les nouveaux dossiers apparaîtront ici dès leur ouverture.",
    nothingOutstanding: "Rien à payer",
    nothingOutstandingHint: "Les factures émises apparaîtront ici.",
    noDocuments: "Aucun document",
    noDocumentsHint:
      "Les fichiers partagés par votre équipe apparaîtront ici — connaissements, lettres de transport et autres documents d’expédition.",
    downloading: "Téléchargement…",
    filed: "Classé",
    opened: "Ouvert",
    due: "Échéance",
    noMessages:
      "Aucun message — posez à votre équipe toute question sur vos expéditions.",
    writeMessage: "Écrivez un message à votre équipe…",
    sending: "Envoi…",
    exportChat: "Exporter la conversation (PDF)",
    exporting: "Export…",
    accountComplete: "Votre compte",
    complete: "complété",
    requestQuoteSub:
      "Décrivez votre expédition et nous revenons vers vous avec un prix.",
    service: "Service (ex. Fret maritime import…)",
    serviceType: "Type de service (optionnel)",
    origin: "Origine (POL)",
    destination: "Destination (POD)",
    weight: "Poids estimé (kg)",
    incoterm: "Incoterm (FOB, CIF…)",
    cargo: "Description de la cargaison (optionnel)",
    submitting: "Envoi…",
    noQuotes: "Aucune demande de devis",
    noQuotesHint: "Vos demandes de devis apparaîtront ici avec leur statut.",
    requestDocument: "Demander un document",
    requesting: "Demande…",
    whatDocument:
      "De quel document avez-vous besoin, et pour quelle période/dossier ?",
    noRequests: "Aucune demande",
    noRequestsHint:
      "Vos demandes et les documents partagés en réponse apparaîtront ici.",
    answered: "Répondu",
    open: "Ouvert",
    noDocsShared:
      "Aucun document partagé pour l’instant — l’entreprise n’a pas encore répondu.",
    shared: "Partagé",
    accessTo: "accès jusqu’au",
    basis: "base",
    haveAccess: "Vous avez déjà un accès ?",
    noAccess: "Besoin d’un accès à vos expéditions ?",
    noAccessHint:
      "L’accès est délivré par votre gestionnaire de compte. Demandez-lui une invitation et vous choisirez votre mot de passe.",
    needEmailFirst: "Saisissez d’abord votre adresse de courriel.",
    forgotSent:
      "Si cette adresse a accès au portail, nous avons envoyé un lien pour définir un nouveau mot de passe. Il n’est utilisable qu’une seule fois.",
    signInFailed:
      "Nous n’avons pas pu vous connecter avec ce courriel et ce mot de passe.",
    backToSignIn: "Retour à la connexion",
    setPasswordTitle: "Choisir un mot de passe",
    oneTimeLink: "Ce lien n’est utilisable qu’une seule fois.",
    incompleteLink:
      "Ce lien est incomplet. Utilisez le lien exactement tel qu’il apparaît dans votre courriel.",
    newPassword: "Nouveau mot de passe",
    confirmPassword: "Confirmer le mot de passe",
    passwordHint:
      "12 caractères minimum. Nous le comparons aussi aux fuites de données connues.",
    passwordMismatch: "Les deux mots de passe ne correspondent pas.",
    setPasswordFailed:
      "Ce mot de passe n’a pas été accepté. Essayez-en un autre.",
    saving: "Enregistrement…",
    setPasswordCta: "Définir le mot de passe et continuer",
    backToShipments: "Tous les envois",
    progress: "Avancement",
    stepsDone: "{{done}} étapes sur {{total}} achevées",
    noStages: "Rien à montrer pour l’instant",
    noStagesHint:
      "Les étapes apparaissent ici au fur et à mesure de l’ouverture du dossier.",
    completedOn: "Achevé le {{date}}",
    expectedOn: "Prévu le {{date}}",
    scheduledLater: "Planifié dès que l’expédition sera lancée",
    trackingNow: "nouvelle date : {{date}}",
    askAboutThis: "Poser une question",
    askTitle: "Poser une question sur cette étape",
    askIntro:
      "Votre question part vers l’équipe qui traite cet envoi et reste jointe au dossier.",
    askPlaceholder: "Qu’est-ce qui bloque ?",
    askLabel: "Votre question",
    aboutStage: "À propos de : {{label}}",
    querySentTitle: "Question envoyée",
    querySentBody:
      "Merci — l’équipe qui traite cet envoi l’a reçue, et vous verrez la réponse ici.",
    assumptionsTitle: "Ce que ces dates supposent",
    assumptionsIntro:
      "Votre calendrier dépend d’acteurs dont nous ne maîtrisons pas les horaires. Voici les conditions sur lesquelles il a été établi.",
    statusTodo: "À faire",
    statusInProgress: "En cours",
    statusDone: "Fait",
    statusBlocked: "En attente",
  },

  site: {
    chrome: {
      skip: "Aller au contenu",
      language: "Langue",
      theme: "Thème",
      themeLight: "Thème clair",
      themeDark: "Thème sombre",
      menu: "Menu",
      closeMenu: "Fermer le menu",
      login: "Connexion",
      portalEntry: "Portail client",
      toEnglish: "Read this page in English",
      toFrench: "Lire cette page en français",
      home: "Accueil",
    },
    nav: {
      about: "À propos",
      services: "Services",
      track: "Suivi",
      portfolio: "Nos réalisations",
      insights: "Analyses",
      careers: "Carrières",
      contact: "Contact",
      servicesToggle: "Afficher les services",
      servicesAll: "Tous les services",
      servicesMore: "+{{count}} de plus",
      servicesPitch:
        "Vous ne savez pas lequel choisir ? Décrivez l’expédition et le bon service vous répond.",
    },
    corridor: {
      eyebrow: "Le réseau",
      title: "Les corridors que nous opérons",
      sub: "Chaque ligne ici est une ligne sur laquelle nous avons des dossiers clos. Parcourez-la.",
      subAbstract: "Une image de la façon dont un réseau s’assemble. Le nôtre se remplit à mesure que les dossiers se clôturent.",
      figureLabel: "Réseau de corridors — utilisez les flèches pour passer d’un lieu à l’autre",
      figureLabelAbstract: "Une illustration de réseau",
      present: "Nous y sommes implantés",
      files: "dossiers",
      tilt: "Inclinez votre téléphone pour parcourir la scène",
    },
    /** Voir la version anglaise pour la raison d’être de chaque clé : tout ce
     *  qui est ici est du mobilier, jamais un fait sur le client. */
    about: {
      title: "À propos",
      kicker: "Qui nous sommes",
      titleMain: "Les femmes et les hommes",
      titleAccent: "derrière le fret",
      sub: "Un groupe logistique, ses sociétés, et celles et ceux qui les dirigent.",
      founded: "Création",
      hq: "Siège social",

      storyKicker: "Notre histoire",
      storyTitle: "Notre raison d’être",
      mission: "Notre mission",
      vision: "Notre cap",
      principles: "Nos principes",

      messageKicker: "Le mot du dirigeant",
      messageTitle: "Message du directeur général",

      timelineKicker: "Notre parcours",
      timelineTitle: "Les étapes",
      timelineYear: "Année",

      peopleKicker: "Direction",
      peopleTitle: "Les responsables",
      readBio: "Lire la biographie",
      linkedin: "LinkedIn",
      linkedinOf: "{{name}} sur LinkedIn",
      portraitAlt: "Portrait de {{name}}",

      networkKicker: "Le groupe",
      networkTitle: "Nos sociétés",
      networkLead:
        "Chacune est une société immatriculée, avec ses licences, ses équipes et son terrain. Lorsque deux d’entre elles couvrent le même pays, l’anneau les relie.",
      networkLabel:
        "Nos sociétés en réseau — utilisez les flèches pour passer de l’une à l’autre",
      networkPlaces: "Couverture : {{count}}",
      entityFocus: "Ce qu’elle traite",
      entityCoverage: "Où elle opère",
      entityAddress: "Siège social",
      entityPeople: "Qui la dirige",
      entityCoverAlt: "{{name}}",

      proofKicker: "Nos garanties",
      proofTitle: "Agréés, et responsables",
      credentialsTitle: "Certifications et licences",
      credentialRef: "Référence",
      credentialIssued: "Délivrée le",
      credentialValid: "Valable jusqu’au",
      membershipsTitle: "Adhésions",
      clientsTitle: "Les organisations avec lesquelles nous travaillons",
      carriersTitle: "Les lignes que nous empruntons",
      carriersLead:
        "Les transporteurs et réseaux auprès desquels nous réservons de la capacité. Leurs marques leur appartiennent ; nous les affichons avec leur accord.",
      markAlt: "{{name}}",
    },
    announce: {
      eyebrow: "À la une",
      more: "Toutes les annonces",
    },
    insights: {
      kicker: "Analyses",
      title: "Ce que nous apprenons",
      titleMain: "Ce que nous",
      titleAccent: "apprenons",
      sub: "Les notes du bureau sur la douane, le fret et les corridors où nous opérons — écrites par ceux qui font le travail.",
      filterLabel: "Filtrer par thème",
      kindLabel: "Filtrer par type",
      kindAll: "Tout",
      kindArticle: "Articles",
      kindAnnouncement: "Annonces",
      all: "Tout",
      loading: "Chargement des articles…",
      loadingArticle: "Chargement de l’article…",
      pagination: "Pages",
      previous: "Précédent",
      next: "Suivant",
      pageOf: "Page {{page}} sur {{total}}",
      none: "Rien de publié pour l’instant",
      noneHint:
        "Le bureau écrit ces notes quand le travail fait apparaître quelque chose qui mérite d’être transmis. Revenez, ou demandez-nous directement.",
      noneForTag: "Rien sous ce thème pour l’instant",
      noneForTagHint: "D’autres thèmes contiennent des articles — retirez le filtre pour les voir.",
      showAll: "Afficher tous les articles",
      by: "Par",
      backToIndex: "Tous les articles",
      gone: "Cet article n’est pas ici",
      goneHint: "Le lien est peut-être ancien ou mal recopié. Tout ce qui est publié figure sur l’index.",
      otherLanguageOnly:
        "Cet article n’est pas encore traduit. Changez de langue pour le lire.",
      gallery: "Images de cet article",
    },
    hero: {
      eyebrow: "Logistique · Douane · Entreposage",
      title: "Le fret qui fait avancer votre entreprise",
      titleMain: "Le fret qui fait avancer",
      titleAccent: "votre entreprise",
      sub: "Logistique maritime, aérienne et terrestre dans la région OHADA/CEMAC — une équipe, une plateforme, une visibilité totale.",
      cta: "Demander un devis",
      cta2: "Suivre un envoi",
      scrollCue: "Faire défiler",
    },
    track: {
      kicker: "Visibilité des envois",
      title: "Où est ma marchandise ?",
      label: "Référence de dossier ou de conteneur",
      placeholder: "ex. SBL-OPS-2026-0142",
      submit: "Suivre",
      busy: "Recherche…",
      hint: "Saisissez la référence imprimée sur vos documents d’expédition. Aucun compte nécessaire.",
      notFound:
        "Nous n’avons pas trouvé cette référence. Vérifiez-la sur vos documents et réessayez.",
      empty: "Saisissez une référence pour voir son avancement.",
      reference: "Référence du dossier",
      current: "Étape en cours",
      notFoundHint:
        "Le suivi fonctionne sur la référence exacte imprimée sur vos documents — un numéro de connaissement ne correspondra pas tant que le bureau n’a pas ouvert de dossier.",
      limited:
        "Trop de tentatives de suivi depuis cette connexion. Attendez quelques minutes et réessayez.",
      limitedHint:
        "La limite est par réseau et non par personne : un bureau derrière une seule connexion la partage.",
    },
    services: {
      eyebrow: "Services",
      title: "Nos services",
      sub: "Une seule équipe gère le transport, les formalités et ce qu’ils coûtent.",
      more: "Voir ce service",
      all: "Tous les services",
      items: [
        {
          t: "Fret maritime & aérien",
          d: "Importations et exportations avec routage, documentation et formalités douanières de bout en bout.",
        },
        {
          t: "Dédouanement",
          d: "Déclarations conformes à la DGI, exonérations fiscales et gestion du circuit rouge.",
        },
        {
          t: "Entreposage",
          d: "Entrepôts sous douane et classiques avec visibilité du stock depuis votre téléphone.",
        },
        {
          t: "Transport intérieur",
          d: "Camionnage depuis Douala, Kribi et Yaoundé vers toute la sous-région.",
        },
      ],
    },
    how: {
      eyebrow: "Comment ça se passe",
      title: "Ce que travailler avec nous veut dire",
      sub: "Trois temps, et vous savez toujours lequel vous êtes en train de vivre.",
      steps: [
        {
          t: "Vous nous décrivez l’envoi",
          d: "Une demande de devis ou un appel : origine, destination et ce que vous transportez.",
        },
        {
          t: "Nous chiffrons et réservons",
          d: "Routage, transporteur, traitement douanier et une proposition écrite à transmettre à qui doit l’approuver.",
        },
        {
          t: "Vous suivez l’avancement",
          d: "Chaque étape sur une page de suivi, et chaque document dans votre portail — sans relance par courriel.",
        },
      ],
    },
    proof: {
      eyebrow: "Notes de cas",
      title: "Ce que nous pouvons vous montrer",
      sub: "Notes de cas publiées sur des opérations que nous avons menées.",
      more: "Lire le cas",
      empty:
        "Nous publions ces notes au fil des opérations terminées. Rien à montrer pour l’instant — demandez-nous des références.",
      lanes: "Axes que nous opérons",
      lanesSub:
        "Dossiers terminés sur les 24 derniers mois, comptés depuis le registre des opérations.",
      files: "dossiers terminés",
      stripLabel: "Chiffres clés",
    },
    portalBand: {
      eyebrow: "Portail client",
      title: "Vos expéditions, documents et factures au même endroit",
      sub: "Chaque client dispose d’un portail : statut des dossiers en direct, tous les documents que nous détenons pour vous, et une ligne directe avec l’équipe qui traite votre marchandise.",
      cta: "Ouvrir le portail client",
      invited:
        "Vous avez un lien d’invitation ? Choisissez votre mot de passe depuis ce lien.",
    },
    esg: {
      kicker: "Responsabilité",
      title: "Notre façon",
      titleAccent: "d’opérer",
      environment: "Environnement",
      social: "Social",
      governance: "Gouvernance",
      figureAlt: "{{pillar}} — les engagements listés à côté de ce dessin, dessinés",
    },
    quote: {
      title: "Demander un devis",
      sub: "Décrivez votre expédition et nous revenons vers vous avec un prix.",
      kicker: "Service devis",
      titleMain: "Parlez-nous de",
      titleAccent: "votre expédition",
      whatHappens: "La suite",
      bandLead:
        "Quatre étapes courtes — votre besoin, le trajet, la marchandise, et où envoyer la réponse. Comptez moins de deux minutes.",
      bandCta: "Demander un devis",
      bandTrack: "Suivre un envoi",
      name: "Votre nom",
      company: "Société",
      email: "Courriel",
      phone: "Téléphone (facultatif)",
      service: "Service",
      servicePick: "Choisir un service",
      servicePlaceholder: "Fret maritime import",
      origin: "Origine (POL)",
      originPlaceholder: "ex. Shanghai",
      destination: "Destination (POD)",
      destinationPlaceholder: "ex. Douala",
      incoterm: "Incoterm",
      incotermPick: "Choisir un incoterm",
      cargo: "Description de la cargaison",
      cargoHint:
        "Poids, volume, nombre de conteneurs, marchandise, matières dangereuses — tout ce dont le bureau a besoin pour chiffrer.",
      stepsLabel: "Étapes du devis",
      stepNeed: "Votre besoin",
      stepRoute: "Trajet",
      stepStorage: "Stockage",
      stepDetails: "Détails de la marchandise",
      stepContact: "Vos coordonnées",
      stepHint_need: "Deux réponses, pour savoir à quel bureau cela revient.",
      stepHint_route: "Où cela commence et où cela doit arriver.",
      stepHint_details: "Tout est facultatif ici — chaque réponse rapproche le prix du prix final.",
      stepHint_contact: "Où envoyer la réponse.",
      next: "Continuer",
      mode: "Comment la marchandise voyage-t-elle ?",
      modeSEA: "Par mer",
      modeSEAHint: "Conteneurs, FCL ou LCL, via les ports où nous dédouanons.",
      modeAIR: "Par air",
      modeAIRHint: "Marchandises urgentes et tout ce qui a une échéance.",
      modeROAD: "Par route ou rail",
      modeROADHint: "Transport transfrontalier et transit vers l’hinterland.",
      modeWAREHOUSE: "Stockage uniquement",
      modeWAREHOUSEHint: "Stockage et manutention sécurisés, sans transport.",
      modeMore: "+{{count}} de plus",
      modeRAIL: "Par rail",
      modeRAILHint: "Corridors ferroviaires et les tronçons routiers à chaque extrémité.",
      modeCUSTOMS: "Douane uniquement",
      modeCUSTOMSHint: "Dédouanement et déclarations, le transport étant organisé ailleurs.",
      modeOTHER: "Autre chose",
      modeOTHERHint: "Tout ce que les options ci-dessus ne décrivent pas — dites-le-nous et nous orienterons la demande.",
      stepCounter: "Étape {{step}} sur {{total}}",
      originPort: "Port de chargement",
      destinationPort: "Port de déchargement",
      originAirport: "Aéroport de départ",
      destinationAirport: "Aéroport d’arrivée",
      originPlace: "Lieu d’enlèvement",
      destinationPlace: "Lieu de livraison",
      placeHint: "Commencez à saisir et choisissez dans la liste, ou saisissez librement — les deux fonctionnent.",
      placeSuggestions: "Suggestions de lieux",
      incotermHint: "L’incoterm convenu avec votre fournisseur. Demandez-lui en cas de doute.",
      warehouseLocation: "Où avez-vous besoin du stockage ?",
      warehousePlaceholder: "ex. Douala, Bonabéri",
      warehouseDuration: "Pour combien de temps ?",
      durationPick: "Choisissez une durée",
      durationLESS_THAN_7_DAYS: "Moins d’une semaine",
      durationDAYS_7_TO_14: "Une à deux semaines",
      durationDAYS_15_TO_30: "De deux semaines à un mois",
      durationOVER_30_DAYS: "Plus d’un mois",
      durationUNKNOWN: "Pas encore fixé",
      weight: "Poids estimé (kg)",
      weightHint: "Un ordre de grandeur suffit.",
      projectCargo: "Colis lourd ou hors gabarit",
      projectCargoHint: "Surdimensionné, très lourd, ou tout ce qui n’entre pas dans un conteneur standard.",
      attachment: "Joindre un document (facultatif)",
      attachmentHint: "Une liste de colisage, une facture proforma ou une photo. PDF, PNG ou JPEG, jusqu’à 8 Mo.",
      fileType: "Ce type de fichier n’est pas accepté. Envoyez un PDF, un PNG ou un JPEG.",
      fileTooLarge: "Ce fichier fait {{size}} — la limite est de {{limit}}.",
      fileUnreadable: "Ce fichier n’a pas pu être lu. Essayez une autre copie.",
      fileRemove: "Retirer la pièce jointe",
      notes: "Autre chose à nous signaler ?",
      notesHint: "Délais, manutention particulière, une référence qui vous est propre.",
      errMode: "Indiquez comment la marchandise voyage.",
      errService: "Choisissez le service dont vous avez besoin.",
      errOrigin: "Indiquez le point de départ.",
      errDestination: "Indiquez la destination.",
      errIncoterm: "Choisissez un incoterm.",
      errWarehouse: "Indiquez où vous avez besoin du stockage.",
      errName: "Indiquez votre nom.",
      errEmail: "Saisissez une adresse courriel à laquelle répondre.",
      submit: "Demander un devis",
      sending: "Envoi…",
      sent: "Merci — nous avons reçu votre demande et vous répondrons rapidement.",
      reference: "Votre référence de devis est",
      err: "Une erreur est survenue. Veuillez réessayer.",
      limited:
        "Trop de demandes depuis cette connexion. Réessayez dans une heure, ou appelez-nous.",
      privacy: "Vos informations ne servent qu’à répondre à votre demande.",
      requiredNote: "Les champs marqués d’un * sont obligatoires.",
      steps: [
        {
          t: "Vous recevez une référence",
          d: "Immédiatement, à l’écran — citez-la au téléphone ou dans un courriel et n’importe qui ici retrouve votre demande.",
        },
        {
          t: "Le bureau la voit",
          d: "Les demandes arrivent dans la même file que les prospects de l’équipe commerciale : rien n’attend dans une boîte que personne ne surveille.",
        },
        {
          t: "Nous répondons sur le même canal",
          d: "Par courriel si vous avez laissé un courriel, par téléphone si vous avez laissé un numéro.",
        },
      ],
    },
    contact: {
      title: "Parler à quelqu’un",
      sub: "Une question, un partenariat, un envoi qui déraille : ce message arrive au bureau qui le traite.",
      kicker: "Nous contacter",
      titleMain: "Parler à",
      titleAccent: "quelqu’un",
      bandLead:
        "Une question, un partenariat, ou un dossier qui déraille. Chaque message revient avec une référence, et aucun compte n’est nécessaire.",
      bandCta: "Envoyer un message",
      otherTitle: "Plus rapide qu’un message",
      otherTrack:
        "Une référence suffit. Les mêmes jalons que le bureau vous lirait, sans attendre de réponse.",
      coverageKicker: "Présence",
      coverageTitle: "Où nous sommes, et où nous livrons",
      coverageAlt:
        "Un schéma reliant chaque bureau aux zones qu’il dessert. Les mêmes bureaux et zones sont listés en texte ci-dessous.",
      offices: "Bureaux",
      covers: "Dessert",
      coverageNone:
        "Les zones desservies ne sont pas encore publiées pour ces bureaux.",
      otherPortal:
        "Déjà client. Vos dossiers, documents et factures, sans rien à rechercher.",
      otherQuote:
        "Chiffrer une expédition. Quatre étapes courtes la placent devant le bureau qui la cote.",
      otherGo: "Ouvrir",
      subject: "Objet (facultatif)",
      type: "De quoi s’agit-il ?",
      typeGeneral: "Une expédition ou un devis",
      typePartnership: "Partenariat d’agence ou de prestataire",
      typeCareers: "Une candidature",
      typeMedia: "Presse ou médias",
      message: "Comment pouvons-nous aider ?",
      send: "Envoyer le message",
      sending: "Envoi…",
      sent: "Reçu. Nous vous répondrons par courriel.",
      err: "Une erreur est survenue. Veuillez réessayer.",
      limited:
        "Trop de messages depuis cette connexion. Réessayez dans une heure.",
      promise: [
        {
          t: "Une référence, pas un trou noir",
          d: "Chaque message en reçoit une, affichée à l’écran dès l’envoi.",
        },
        {
          t: "Aiguillé, pas transféré",
          d: "Dire de quoi il s’agit place la demande devant le bureau qui traite ce type de question.",
        },
        {
          t: "Sans compte",
          d: "Si vous êtes déjà client, le portail est plus rapide pour tout ce qui concerne un envoi en cours.",
        },
      ],
    },
    proposals: {
      title: "Proposition",
      client: "Établie pour",
      route: "Trajet",
      lines: "Coûts",
      expireNote:
        "Cette page est le même document que le PDF — y compris les chiffres, que nous ne reformatons pas ici.",
      unavailable: "Ce lien de proposition n’est plus valide.",
      unavailableHint:
        "Les propositions partagées expirent. Demandez à votre contact un nouveau lien.",
      download: "Télécharger le PDF",
      print: "Imprimer",
    },
    footer: {
      company: "Société",
      services: "Services",
      clients: "Espace client",
      legal: "Mentions légales",
      rights: "Tous droits réservés.",
      powered: "Propulsé par JBS Praxis",
      about: "À propos",
      contact: "Contact",
      portfolio: "Nos réalisations",
      careers: "Carrières",
      track: "Suivre un envoi",
      portal: "Portail client",
      quote: "Demander un devis",
      privacy: "Confidentialité",
      terms: "Conditions d’utilisation",
      newsletter:
        "Une note occasionnelle sur les routes, la capacité et les changements douaniers. Pas de marketing.",
      newsletterCta: "S’abonner",
      sending: "Envoi…",
      newsletterEmail: "Adresse de courriel",
      newsletterOk: "Vous êtes inscrit.",
      newsletterLimited:
        "Trop d’inscriptions depuis cette connexion. Réessayez dans une heure.",
      newsletterErr: "Cette adresse n’a pas fonctionné. Veuillez réessayer.",
      social: "Réseaux sociaux",
      socialOn: "{{platform}}, dans un nouvel onglet",
      credentials: "Agréments :",
      legalEntity: "Entité juridique :",
    },
    preview: {
      reference: "SBL-OPS-2026-0142",
      status: "En cours",
      stages: [
        { label: "Dossier ouvert", state: "done" },
        { label: "Navire parti", state: "done" },
        { label: "Dédouané", state: "done" },
        { label: "Livraison planifiée", state: "current" },
      ],
    },
    servicesPage: {
      title: "Services",
      titleMain: "Ce que nous",
      titleAccent: "prenons en charge",
      sub: "Ce que nous prenons en charge, de bout en bout.",
      empty:
        "Les pages de services sont en cours de rédaction. Demandez un devis en attendant.",
      unavailable: "Cette page de service n’est pas publiée.",
      coverage: "Zone couverte",
      highlights: "Ce qui est inclus",
      faq: "Les questions qu’on nous pose",
      related: "Services liés",
      gallery: "Sur le terrain",
      updated: "Publié",
      cta: "Demander un devis pour ce service",
      back: "Tous les services",
      noLong:
        "La description complète de ce service est en cours de rédaction.",
      video: "Vidéo",
      onThisPage: "Sur cette page",
      readMore: "Lire le détail complet",
      readLess: "Réduire",
    },
    portfolioPage: {
      title: "Nos réalisations",
      titleMain: "Nos",
      titleAccent: "réalisations",
      sub: "Des opérations que nous avons menées, dans nos propres mots.",
      empty: "Rien de publié pour l’instant.",
      unavailable: "Réalisation indisponible",
      back: "Toutes les réalisations",
      summary: "Le besoin",
      execution: "Le déroulé",
      results: "Ce que cela a changé",
      client: "Client",
    },
    trackPage: {
      title: "Suivre un envoi",
      titleMain: "Suivre un",
      titleAccent: "envoi",
      sub: "Saisissez la référence exacte indiquée sur vos documents d’expédition.",
      progress: "Avancement",
      ofStages: "étapes visibles par le client",
      current: "Étape en cours",
      timeline: "Chronologie de l’envoi",
      origin: "Origine",
      destination: "Destination",
      needAccount:
        "Seules les étapes rendues visibles par votre gestionnaire de compte apparaissent ici. Pour le reste, votre portail contient les documents.",
      openPortal: "Ouvrir le portail client",
      service: "Service",
      lastUpdate: "Dernière mise à jour",
      lastUpdateNone: "Aucune étape encore terminée",
      closed: "Toutes les étapes visibles sont terminées",
      noStages: "Ce dossier n’a pas encore d’étape visible par le client",
      noStagesHint:
        "Le bureau publie chaque étape à mesure qu’elle est confirmée. Revenez une fois la première validée, ou ouvrez le portail pour les documents déjà au dossier.",
      loading: "Recherche de cette référence…",
      searchAgain: "Essayer une autre référence",
      theAnswer: "Où se trouve cet envoi",
      verdictOpened: "Ouvert, pas encore en mouvement",
      verdictMoving: "En mouvement",
      verdictDone: "Livré",
      scheduled: "Prévu",
      noSchedule: "Aucune étape n’est encore planifiée sur ce dossier.",
      whereRef:
        "La référence figure sur les documents transmis par votre gestionnaire de compte : la confirmation de réservation, l’ordre de transport ou la facture.",
      noMatch: "Aucune correspondance",
      notFoundNotLost:
        "Cela ne dit rien de votre marchandise. Aucun dossier de ce site ne porte cette référence exacte — le plus souvent un chiffre relevé sur une photo, ou une référence provenant d’un autre prestataire.",
      askDesk: "Contacter le bureau",
      tooMany: "Trop de recherches",
      failedTitle: "La recherche n’a pas abouti",
    },
    notFound: {
      kicker: "Mauvaise adresse",
      title: "Cette page n’existe pas",
      hint: "Le lien est peut-être ancien ou mal recopié. Repartez de l’accueil, ou suivez un envoi par sa référence.",
      home: "Retour à l’accueil",
    },
    crash: {
      title: "Cette page s’est arrêtée",
      hint: "Rien de ce que vous nous avez envoyé n’est perdu — une demande déjà partie est en route vers le bureau. Recharger règle le problème la plupart du temps. Sinon, la page d’accueil mène aux mêmes formulaires.",
      reload: "Recharger la page",
      home: "Retour à l’accueil",
    },
  },

  strings: {
    Account: "Compte",
    "Audit trail": "Piste d’audit",
    "Cash on hand": "Trésorerie disponible",
    "Cash position": "Position de trésorerie",
    Charges: "Frais",
    Credit: "Crédit",
    Debit: "Débit",
    Progress: "Avancement",
    Revenue: "Chiffre d’affaires",
    Total: "Total",
    "Trial balance": "Balance générale",
    Due: "Échéance",
    Completed: "Terminé",
    Location: "Localisation",
    Reference: "Référence",
    "Shipment reference": "Référence d’expédition",
    Documents: "Documents",
    Shipments: "Expéditions",
    Invoices: "Factures",
    Messages: "Messages",
    English: "Anglais",
    Français: "Français",
    "Origin pending": "Origine à confirmer",
    "Destination pending": "Destination à confirmer",
    "Current stage": "Étape en cours",
    "Shipment timeline": "Chronologie de l’envoi",
    Preparing: "Préparation",
    "In progress": "En cours",
    "Progress note": "Note d’avancement",
    "Not started": "Pas encore démarré",
    Pending: "En attente",
    Current: "En cours",
    Upcoming: "À venir",
    Warning: "Alerte",
    Attention: "À surveiller",
    Done: "Fait",
    Scheduled: "Planifié",
    Draft: "Brouillon",
    Sent: "Envoyé",
    Open: "Ouvert",
    Closed: "Fermé",
    New: "Nouveau",
    Active: "Actif",
    Paused: "En pause",
    Expired: "Expiré",
    Cancelled: "Annulé",
    Approved: "Approuvé",
    Rejected: "Rejeté",
    Accepted: "Accepté",
    Signed: "Signé",
    Issued: "Émis",
    Published: "Publié",
    Paid: "Payé",
    Overdue: "En retard",
    Won: "Gagné",
    Lost: "Perdu",
    Qualified: "Qualifié",
    Converted: "Converti",
    Reviewing: "En cours d’examen",
    Triaged: "Qualifié au premier tri",
    Green: "Vert",
    Amber: "Orange",
    Red: "Rouge",
    "Full time": "Temps plein",
    "Part time": "Temps partiel",
    Internship: "Stage",
    Contract: "Contrat",
    Freelance: "Indépendant",
    "Loading…": "Chargement…",
    "Compte de résultat": "Compte de résultat",
    Bilan: "Bilan",
    Produits: "Produits",
    Actif: "Actif",
    Passif: "Passif",
    Résultat: "Résultat",
    "Résultat net": "Résultat net",
    "Hors activités ordinaires (net)": "Hors activités ordinaires (net)",
    "Net result": "Résultat net",
    "Balance sheet total": "Total du bilan",
    "Produits for the period": "Produits de la période",
    "Produits less charges": "Produits moins charges",
    "Today, not period-end": "Aujourd’hui, et non à la fin de la période",
    "No movements": "Aucun mouvement",
    "No postings": "Aucune écriture",
    "No requests yet": "Aucune demande pour l’instant",
    "No treasury accounts": "Aucun compte de trésorerie",
    "No ledger movements for this period.":
      "Aucun mouvement de caisse pour cette période.",
    "Class-5 balances will appear here.":
      "Les soldes de classe 5 apparaîtront ici.",
    "Financial and document postings for the period will appear here.":
      "Les écritures financières et les documents de la période apparaîtront ici.",
    "Requests you make and the documents shared in answer appear here.":
      "Les demandes que vous formulez et les documents partagés en réponse apparaissent ici.",
    "What document do you need, and for which period/file?":
      "De quel document avez-vous besoin, et pour quelle période ou quel dossier ?",
    "Describe the document you need first.":
      "Décrivez d’abord le document dont vous avez besoin.",
    "Your current shipments and invoices.": "Vos envois et factures en cours.",
    "No active access": "Aucun accès actif",
    "Quote request": "Demande de devis",
    "Request document": "Demander un document",
    "Account team": "Équipe compte",
    "Ask your account team": "Écrivez à votre équipe compte",
    "Write a message…": "Écrire un message…",
    "Something went wrong. Please try again.":
      "Une erreur est survenue. Veuillez réessayer.",
  },
} as const;
