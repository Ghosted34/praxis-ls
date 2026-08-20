# Praxis LS — Bilingual Glossary & French Style Rules

**What this is for.** Every word of customer-facing copy, in both languages, is
written against this file: the website, the app UI, documents, mail, the deck,
sales collateral. It exists so that a buyer who reads "Operation file" on
praxisls.com and then sees **Dossier d'exploitation** in the demo recognises the
same system — and so no French sentence we publish reads as a translation.

**Source.** The app's own dictionary, `client/src/lib/i18n-dict.ts` (en/fr,
3,626 lines), plus `doc/OHADA_Accounting_Tax_KnowledgeBase.md`. Where this file
and the dictionary disagree, **fix both in the same PR** — a glossary that has
drifted from the product is worse than none.

> A shallow parse of the dictionary's flat keys shows the French half is genuine
> translation rather than leakage: of 148 shared keys only six carry identical
> values, and five of those are legitimately identical in French (Documents,
> Messages, Client, Destination, Incoterm). One key, `requestQuoteSub`, exists
> in `en` and is missing from `fr`.

---

## 0. The rule that matters most

> **French is the source language for this domain. English is the peer
> translation — not the other way round.**

The vocabulary of OHADA freight forwarding _is French_: transitaire,
dédouanement, connaissement, régie d'avance, liasse fiscale. Copy drafted in
English and translated outward produces text that is grammatically perfect and
audibly foreign to the exact buyer you want. Draft FR first. Then write EN as
its own document, not as a mirror of it.

### The trap that would cost the most

| English                            | ❌ Never  | ✅ Always   |
| ---------------------------------- | --------- | ----------- |
| **file** (the operational dossier) | _fichier_ | **dossier** |

`fichier` means a computer file. A transitaire reading "fichier d'exploitation"
hears "the software's data file" and concludes the product was built by people
who have never stood in a customs hall. This is the single highest-cost
mistranslation available in this domain.

Note the direction of travel: we are renaming **dossier → file in English**
(the term appears ~3,164 times across `client/ src/ packages/
platform-console/`, overwhelmingly in English prose and JSDoc). French keeps
_dossier_ and should use it **more** than it currently does.

---

## 1. Logistics & operations

| English                    | Français                         | Note                                          |
| -------------------------- | -------------------------------- | --------------------------------------------- |
| Operation file             | **Dossier d'exploitation**       | _dossier transit_ for a pure transit job      |
| Transit order              | Ordre de transit                 |                                               |
| Freight forwarder          | **Transitaire**                  | the buyer's own word for themselves           |
| Licensed customs broker    | Commissionnaire en douane agréé  |                                               |
| Customs clearance          | **Dédouanement**                 | not _dégagement_                              |
| Customs declaration        | Déclaration en douane            |                                               |
| Customs duty               | Droits de douane                 |                                               |
| Bonded warehouse           | Entrepôt sous douane             |                                               |
| Bill of lading (B/L)       | **Connaissement**                | sea                                           |
| Air waybill (AWB)          | Lettre de transport aérien (LTA) | air                                           |
| Waybill / consignment note | Lettre de voiture                | road                                          |
| Consignee                  | Destinataire                     |                                               |
| Shipper                    | Expéditeur                       | _chargeur_ in shipping-line context           |
| Carrier                    | Transporteur                     |                                               |
| Container                  | Conteneur                        | never _container_                             |
| Milestone                  | **Jalon**                        | _étape_ only in a generic UI sense            |
| ETA / ATA                  | ETA / ATA                        | kept — the industry uses them                 |
| Port of discharge (POD)    | Port de déchargement             |                                               |
| Delivery note              | Bon de livraison (BL)            |                                               |
| Warehouse                  | Entrepôt                         |                                               |
| Inbound / receiving        | Réception                        |                                               |
| Goods received note (GRN)  | Bon de réception                 |                                               |
| Outbound / dispatch        | Expédition                       |                                               |
| Stock / inventory          | Stock · inventaire               | _inventaire_ = the count; _stock_ = the goods |
| Cycle counting             | Inventaire tournant              |                                               |
| Fleet                      | Flotte · parc automobile         | _parc_ for the asset register                 |
| Dispatch (vehicles)        | Affectation des véhicules        |                                               |
| Driver                     | Chauffeur                        |                                               |
| Fuel                       | Carburant                        |                                               |
| Maintenance                | Entretien                        | _maintenance_ acceptable for scheduled work   |

## 2. Accounting & tax (OHADA / SYSCOHADA)

| English                            | Français                               | Note                                              |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------- |
| Chart of accounts                  | **Plan comptable**                     |                                                   |
| General ledger                     | **Grand livre**                        |                                                   |
| Journal / journals                 | Journal · journaux                     |                                                   |
| Journal entry                      | Écriture comptable                     |                                                   |
| Posting                            | Comptabilisation · imputation          | "posts to the ledger" → _s'impute au grand livre_ |
| Trial balance                      | Balance générale                       |                                                   |
| Financial statements               | États financiers                       |                                                   |
| DSF                                | **Déclaration Statistique et Fiscale** | always expand on first use                        |
| Liasse fiscale                     | Liasse fiscale                         | no English equivalent — keep in EN copy too       |
| Accounts receivable                | Créances clients                       |                                                   |
| Accounts payable                   | Dettes fournisseurs                    |                                                   |
| Proforma invoice                   | Facture proforma                       |                                                   |
| Final invoice                      | Facture définitive                     |                                                   |
| Credit note                        | Avoir                                  | not _note de crédit_                              |
| VAT                                | **TVA**                                |                                                   |
| Withholding tax                    | Retenue à la source                    |                                                   |
| Fixed assets                       | Immobilisations                        |                                                   |
| Depreciation                       | Amortissement                          |                                                   |
| Disbursement (forwarder's advance) | **Débours**                            | precise and industry-standard                     |
| Imprest / petty-cash float         | **Régie d'avance**                     | already used in the PRD                           |
| Costing                            | Chiffrage · calcul des coûts           | _étude de prix_ at quotation stage                |
| Margin simulator                   | Simulateur de marge                    |                                                   |
| Three-way match                    | Rapprochement à trois voies            |                                                   |
| Purchase order                     | Bon de commande                        |                                                   |
| Purchase request                   | Demande d'achat                        |                                                   |
| Immutable ledger                   | Journal inaltérable                    |                                                   |
| Audit trail                        | **Piste d'audit**                      |                                                   |
| Segregation of duties              | Séparation des tâches                  |                                                   |
| Approval workflow                  | Circuit de validation                  |                                                   |
| Financial year                     | Exercice comptable                     |                                                   |
| Month-end close                    | Clôture mensuelle                      |                                                   |

## 3. Product, platform & security

| English                     | Français                          | Note                                                                    |
| --------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| Tenant                      | **Organisation** · entité cliente | ❌ never _locataire_ — that is a landlord's tenant                      |
| User                        | Utilisateur                       |                                                                         |
| Role                        | Rôle                              |                                                                         |
| Permissions / access rights | **Habilitations**                 | the correct enterprise term; _permissions_ reads like consumer software |
| Dashboard                   | Tableau de bord                   |                                                                         |
| Report                      | Rapport · état                    | _état_ for a standard accounting output                                 |
| Settings                    | Paramètres                        |                                                                         |
| Sandbox / test environment  | **Environnement de test**         | avoid _bac à sable_ in enterprise copy                                  |
| Live environment            | Environnement de production       |                                                                         |
| Go-live                     | Mise en production                |                                                                         |
| Onboarding (a customer)     | **Mise en service** · déploiement | ❌ never _embarquement_                                                 |
| Feature                     | Fonctionnalité                    |                                                                         |
| Release                     | Version                           |                                                                         |
| Backup                      | Sauvegarde                        |                                                                         |
| Restore drill               | Test de restauration              |                                                                         |
| Data residency              | Localisation des données          |                                                                         |
| Retention                   | Conservation                      |                                                                         |
| Support ticket              | Demande d'assistance              |                                                                         |
| White-label                 | Marque blanche                    |                                                                         |
| Dedicated database          | Base de données dédiée            |                                                                         |

## 4. Website & conversion

| English                | Français                       |
| ---------------------- | ------------------------------ |
| Book a demo            | **Demander une démo**          |
| Talk to us             | Parlons-en                     |
| Learn more             | En savoir plus                 |
| See how it works       | Voir comment ça marche         |
| Pricing                | Tarifs                         |
| Contact sales          | Contacter l'équipe commerciale |
| Log in                 | Se connecter                   |
| Security               | Sécurité                       |
| Standards              | Normes                         |
| Customers / case study | Références · étude de cas      |
| Documentation          | Documentation                  |
| Get started            | Commencer                      |

---

## 5. French style rules

These are what separate professional French from translated French. They are
mechanical, they are checkable, and readers in this market notice every one.

### Typography

1. **Narrow non-breaking space before `: ; ! ?` and `»`.** `Tarifs : sur
demande` — never `Tarifs: sur demande`.
2. **Guillemets, not quotes.** « comme ceci », with a non-breaking space inside
   each.
3. **Sentence case in headings. French has no title case.**
   ✅ `Une comptabilité conforme, écriture par écriture`
   ❌ `Une Comptabilité Conforme, Écriture Par Écriture`
4. **Numbers:** non-breaking space as thousands separator, comma as decimal —
   `1 250 000,50 XAF`. Currency **after** the amount. English: `XAF 1,250,000.50`.
5. **Dates:** `20 août 2026` — month lowercase, no ordinal. English: `20 August 2026`.
6. **Accents on capitals are mandatory.** `États financiers`, `Écritures`.
   Dropping them is the clearest tell of machine output.
7. **Percentages:** `15 %` with a non-breaking space. English: `15%`.

### Register

8. **Always `vous`.** Never `tu`, in any surface, including error messages.
9. **Prefer the active voice and the present tense.** French B2B copy drifts
   into heavy nominalisation; resist it. ✅ `Chaque opération s'impute au grand
livre.` ❌ `L'imputation de chaque opération au grand livre est assurée.`
10. **Keep the anglicisms the industry actually speaks** — ETA, ATA, B/L,
    incoterm, reporting — and translate the ones it does not. When unsure, ask a
    transitaire, not a dictionary.
11. **Never machine-translate a heading, a CTA or a legal line.** These are the
    three places a bad translation is most visible and most expensive.

### Length

12. **French runs 15–25% longer than English.** Every layout must survive it.
    Test the FR build at 320px before signing off any component, and never set a
    fixed-width button around an English string.

---

## 6. Terms we do not translate

`OHADA` · `SYSCOHADA` · `DSF` · `liasse fiscale` · `régie d'avance` · `débours` ·
`Incoterm` · `ETA` / `ATA` · `B/L` · `LTA` · `TVA` · `XAF` / `XOF` · `Praxis LS`

_Liasse fiscale_, _régie d'avance_ and _débours_ stay French **in the English
copy too**. There is no English equivalent that a reader in this market would
recognise, and using the French term signals that we know the domain.

---

## 7. Adding a term

1. Add the pair here, in the right section.
2. Add or correct the key in `client/src/lib/i18n-dict.ts` — both halves.
3. If it appears on the website, update both language trees in the same PR.

One term, one meaning, three places. Anything less and the drift starts again.
