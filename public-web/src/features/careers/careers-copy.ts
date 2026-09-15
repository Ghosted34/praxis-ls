/**
 * The careers page's copy — EN and FR, lifted out of `lib/i18n-dict.ts` (13792).
 *
 * ── WHY THIS SUBTREE LIVES IN THE FEATURE AND NOT IN THE DICTIONARY ───────
 *
 * `i18n-dict.ts` is in the ENTRY graph: every string in it is downloaded by
 * everybody, including the visitor who reads the home page and leaves. That is
 * the right trade for `site.nav.*` and `site.footer.*`, which every page
 * renders. It is the wrong one for ~80 keys that only `/careers` can ever show,
 * and it became the wrong one loudly when this feature pushed the first-paint
 * payload past its budget — `check-bundle.mjs` says in as many words that the
 * next raise should be refused and spent on exactly this kind of split.
 *
 * `site.careers.*` is read by three modules and all three are in the careers
 * chunk (`careers-page`, `careers-empty`, `candidate-form`), so moving it costs
 * nothing at any call site and returns roughly 3 kB gzip to every other page.
 *
 * ── THE TWO RULES THIS FILE MUST KEEP ─────────────────────────────────────
 *
 *   1. NO IMPORTS, NO TYPE ANNOTATIONS, NO EXPRESSIONS. Two object literals and
 *      an `as const`, exactly like `i18n-dict.ts`. Both
 *      `scripts/gen/gen-site-copy-catalogue.js` and
 *      `public-web/scripts/check-i18n.mjs` read this file as data — the
 *      generator evaluates it and REFUSES a file that has grown an import. That
 *      refusal is why the registration lives in `careers-i18n.ts` next door
 *      rather than at the bottom of this one.
 *   2. IT IS STILL TENANT-OVERRIDABLE. Being outside `i18n-dict.ts` must not
 *      quietly remove these sentences from the site-copy catalogue — on a
 *      white-label product the not-hiring band is a stranger's impression of the
 *      tenant, and it is the last thing that should be un-rewritable. The
 *      generator reads both files for that reason, and `site-copy.generated.js`
 *      carries every key below.
 *
 * The French typography rule (`doc/BRAND_GLOSSARY_FR_EN.md` §5 — a narrow
 * no-break space before `: ; ! ?`) applies here exactly as it does next door,
 * and `check:i18n` enforces it on this file too.
 */

export const en = {
      title: "Careers",
      /* Split for §8.5's entrance, like every other hero title. */
      titleMain: "Build the",
      titleAccent: "corridor",
      sub: "Everything we are hiring for right now.",
      list: "Open roles",
      empty: "No open roles right now",
      /* The old hint was "Please check back", which asks the visitor to do the
         work and promises nothing. This says the one thing about this list that
         is true here and is not true of most careers pages: a vacancy closes
         itself on its `closes_on` date, so the list cannot go stale. */
      emptyHint:
        "Every role we publish appears here, and each closes itself on its date — so this is the current list, not one somebody forgot to take down.",
      quietCta: "Get in touch",
      quietNote: "Think we should be hiring for something? Tell us.",
      openTitle: "Write to us anyway",
      openLead:
        "The right person rarely turns up the day a job is posted. Send your CV — it goes on file with the people who hire, and that file is where they look first.",
      openCta: "Send your CV",
      openFormTitle: "Send us your CV",
      openWanted: "The kind of work you are looking for",
      openWantedHint:
        "A line is enough — a department, a kind of cargo, a shift. It is what makes a CV findable later.",
      openSubmit: "Send my CV",
      openSentTitle: "Your CV is on file.",
      openSentCv: "Reference {{reference}} — CV received.",
      openSentNoCv:
        "Reference {{reference}} — no CV was attached, so the team only has what you typed.",
      openSentNote:
        "No vacancy is attached, so there is no deadline to wait on. You are in the file the team searches when one opens.",
      alertTitle: "Hear about the next one",
      alertLead:
        "One email when a role opens, nothing else. Every one carries a link that takes you off again.",
      alertEmail: "Your email",
      alertName: "Your name",
      alertCta: "Tell me when a role opens",
      alertSending: "Adding you…",
      alertSentTitle: "You are on the list.",
      alertSentNote: "You will hear from us when something opens, and not otherwise.",
      alertConsent: "Used for job alerts and nothing else.",
      unsubTitle: "Job alerts",
      unsubBusy: "Taking you off the list…",
      unsubDone: "You are off the list.",
      unsubNote: "You can sign up again from the careers page whenever you like.",
      cultureTitle: "Life here",
      cultureMore: "Read the post",
      apply: "Apply for this role",
      seeOther: "See our other open roles",
      closeNote: "Applications close",
      lookingFor: "What we are looking for",
      back: "All roles",
      closed: "This role is no longer accepting applications.",
      closedHint:
        "The advert has been taken down, which usually means it is filled. The open list is the only thing we can show you, and it is up to date.",
      testPosting:
        "this is a test posting. Anything you send here goes to the test workspace, not to a real hiring team.",
      salaryFrom: "From",
      salaryUpTo: "Up to",
      years: "years’ experience",
      published: "Posted",
      applyTitle: "Apply for this role",
      fullName: "Full name",
      email: "Email",
      phone: "Phone",
      address: "Address",
      experience: "Years of experience",
      expectedSalary: "Expected salary",
      portfolio: "Portfolio or LinkedIn URL",
      coverNote: "Why you are writing",
      coverHint:
        "Two paragraphs is plenty. Say what you have run, not what you have read.",
      cv: "Your CV",
      cvHint: "PDF, PNG or JPG, up to 8 MB.",
      cvRequired: "This role asks for a CV.",
      optional: "optional",
      submit: "Send application",
      sending: "Sending…",
      sentTitle: "Your application is in.",
      sentCv: "Reference {{reference}} — CV received.",
      sentNoCv:
        "Reference {{reference}} — no CV was attached, so the team only has what you typed.",
      sentNote:
        "Keep the reference: it is how you ask whether anything landed.",
      anotherRole: "Apply to another role",
      err: "We could not send that. Nothing was lost — check the fields marked below and try again.",
      limited:
        "Too many attempts from this connection. Please try again in an hour.",
    } as const;

export const fr = {
      title: "Carrières",
      titleMain: "Construire le",
      titleAccent: "corridor",
      sub: "Tous les postes ouverts en ce moment.",
      list: "Postes ouverts",
      empty: "Aucun poste ouvert pour l’instant",
      emptyHint:
        "Chaque poste que nous publions apparaît ici, et chacun se ferme à sa date — c’est donc la liste du jour, pas une page oubliée.",
      quietCta: "Nous écrire",
      quietNote: "Un poste devrait exister chez nous ? Dites-le-nous.",
      openTitle: "Écrivez-nous quand même",
      openLead:
        "La bonne personne se présente rarement le jour de l’annonce. Envoyez votre CV : il rejoint le dossier des personnes qui recrutent, et c’est là qu’elles cherchent d’abord.",
      openCta: "Envoyer votre CV",
      openFormTitle: "Envoyez-nous votre CV",
      openWanted: "Le type de poste que vous cherchez",
      openWantedHint:
        "Une ligne suffit — un service, un type de marchandise, un rythme. C’est ce qui rend un CV retrouvable plus tard.",
      openSubmit: "Envoyer mon CV",
      openSentTitle: "Votre CV est enregistré.",
      openSentCv: "Référence {{reference}} — CV bien reçu.",
      openSentNoCv:
        "Référence {{reference}} — aucun CV n’était joint, l’équipe n’a que ce que vous avez écrit.",
      openSentNote:
        "Aucun poste n’est rattaché, il n’y a donc pas de délai. Vous êtes dans le dossier que l’équipe consulte dès qu’un poste s’ouvre.",
      alertTitle: "Être prévenu du prochain",
      alertLead:
        "Un courriel quand un poste s’ouvre, rien d’autre. Chacun contient un lien pour vous désinscrire.",
      alertEmail: "Votre courriel",
      alertName: "Votre nom",
      alertCta: "Me prévenir à la prochaine ouverture",
      alertSending: "Inscription…",
      alertSentTitle: "Vous êtes inscrit.",
      alertSentNote: "Vous aurez de nos nouvelles quand un poste s’ouvrira, et pas autrement.",
      alertConsent: "Sert aux alertes emploi et à rien d’autre.",
      unsubTitle: "Alertes emploi",
      unsubBusy: "Désinscription en cours…",
      unsubDone: "Vous êtes désinscrit.",
      unsubNote: "Vous pouvez vous réinscrire depuis la page Carrières quand vous le souhaitez.",
      cultureTitle: "La vie ici",
      cultureMore: "Lire l’article",
      apply: "Postuler à ce poste",
      seeOther: "Voir nos autres postes ouverts",
      closeNote: "Candidatures possibles jusqu’au",
      lookingFor: "Ce que nous cherchons",
      back: "Tous les postes",
      closed: "Ce poste n’accepte plus de candidatures.",
      closedHint:
        "L’annonce a été retirée, ce qui veut dire en général qu’il est pourvu. Nous ne pouvons vous montrer que la liste des postes ouverts, et elle est à jour.",
      testPosting:
        "il s’agit d’une annonce de test. Ce que vous envoyez ici va dans l’espace de test, pas vers une équipe de recrutement réelle.",
      salaryFrom: "À partir de",
      salaryUpTo: "Jusqu’à",
      years: "ans d’expérience",
      published: "Publiée",
      applyTitle: "Postuler à ce poste",
      fullName: "Nom complet",
      email: "Courriel",
      phone: "Téléphone",
      address: "Adresse",
      experience: "Années d’expérience",
      expectedSalary: "Prétention salariale",
      portfolio: "Portfolio ou lien LinkedIn",
      coverNote: "Pourquoi vous écrivez",
      coverHint:
        "Deux paragraphes suffisent. Dites ce que vous avez piloté, pas ce que vous avez lu.",
      cv: "Votre CV",
      cvHint: "PDF, PNG ou JPG, 8 Mo maximum.",
      cvRequired: "Ce poste exige un CV.",
      optional: "facultatif",
      submit: "Envoyer la candidature",
      sending: "Envoi…",
      sentTitle: "Votre candidature est arrivée.",
      sentCv: "Référence {{reference}} — CV bien reçu.",
      sentNoCv:
        "Référence {{reference}} — aucun CV n’était joint, l’équipe n’a que ce que vous avez écrit.",
      sentNote:
        "Gardez la référence : c’est elle qui permet de demander si le dossier est bien arrivé.",
      anotherRole: "Postuler à un autre poste",
      err: "Nous n’avons pas pu envoyer. Rien n’est perdu — vérifiez les champs signalés ci-dessous et réessayez.",
      limited:
        "Trop de tentatives depuis cette connexion. Réessayez dans une heure.",
    } as const;
