-- ============================================================================
-- TENANT SEED — 9088 Repair the website copy that 9084 silently skipped.
--
-- ── WHAT WENT WRONG ────────────────────────────────────────────────────────
--
-- 9084 authors the bilingual copy for all fifteen seeded services and lands it
-- with `ON CONFLICT (service_type_id) DO NOTHING`. That clause is right — it is
-- what stops the seed overwriting copy a tenant has since rewritten — but it
-- keys on the ROW, and a row can exist without carrying a single word.
--
-- The application creates exactly that row. `service_type_web.repo.upsertProfile`
-- inserts a bare `(service_type_id)` on the first write of any kind, and the
-- Website tab's "Create web page" button makes that write with nothing but the
-- two slugs it suggests from the name. So a tenant who opened the tab on a
-- service BEFORE 9084 reached their database got:
--
--   · a profile row, in Draft, with both slugs set;
--   · every description column NULL;
--   · and a seed that then found a row, honoured the conflict clause, and
--     wrote nothing — for that service, permanently. The ledger records 9084
--     as applied, so it never runs again.
--
-- The state is recognisable on the tab: English name ✓, both slugs ✓, all four
-- description rows ○, status Draft. It reads as "the seed forgot this service",
-- and the copy was there the whole time.
--
-- ── WHAT THIS FILLS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────
--
-- FILLS, per column, only where the column is EMPTY — blank text, a zero-length
-- highlights array, a NULL slug, a NULL pillar. A column carrying anything at
-- all is left exactly as the tenant left it, untrimmed and unre-cased. The copy
-- is the same text as 9084, so a row this repairs is indistinguishable from one
-- the original seed reached.
--
-- `accent` and `sort_order` are filled only when they hold the column default
-- ('PRIMARY', 100). Neither is editable anywhere in the product — the Website
-- tab renders no control for either and `accent` is absent from the client's
-- profile type entirely — so the default is the only value a tenant could be
-- carrying, and treating it as "unset" cannot discard a decision. Say so here
-- rather than in a commit message: the day a control for them ships, this
-- assumption stops being true and this file is where someone will look.
--
-- DOES NOT PUBLISH. 9084 published, and its header argues that case well: the
-- copy states what the service IS and is true for any forwarder selling it. It
-- does not follow here. A row this file touches is one somebody already opened
-- and left in Draft, and publishing it would put words on the live site that
-- the tenant has not read, on their say-so from a button they pressed about
-- something else. The cover image is also still missing on these rows and the
-- §4.2 gate requires one, so the honest end state is a Draft that is finally
-- complete enough to review and publish. That is one click, by a person.
--
-- DOES NOT CREATE ROWS. A profile row means "this service goes on the website"
-- (12745's own header), and deciding that is not this file's business. A
-- service with no row was never reached by the tenant OR by 9084, and has
-- nothing to repair.
--
-- ── SLUGS AND THE UNIQUE INDEX ─────────────────────────────────────────────
--
-- `ux_stwp_slug_fr` / `_en` are partial UNIQUE indexes. A tenant who typed the
-- seeded slug onto a DIFFERENT service would make the obvious fill a 23505 that
-- aborts the whole seed, so each slug is written only when nothing else holds
-- it. The service keeps its empty slug and the readiness checklist keeps asking
-- for one, which is a visible, fixable state — unlike a failed migration.
--
-- ── IDEMPOTENCE ────────────────────────────────────────────────────────────
--
-- Every write is a CASE that resolves to the current value once the column is
-- populated, so a second run changes nothing. The WHERE clause additionally
-- skips rows with nothing left to fill, so `updated_at` is not bumped on rows
-- this file did not actually repair — a spurious "edited today" on a row nobody
-- touched is a small lie that costs someone an investigation.
--
-- Text is dollar-quoted, as in 9084 and for the same reason: the French half is
-- full of elisions and one missed doubled quote is a syntax error in a file
-- nobody re-reads after it goes green.
-- ============================================================================

-- Same staging shape as 9084 so the two files can be diffed column for column.
-- ON COMMIT DROP: the table cannot survive to a second run, which is what makes
-- the unguarded INSERT into it idempotent by construction.
CREATE TEMP TABLE _web_backfill (
  service_key text PRIMARY KEY,
  grp         text,
  accent      text,
  sort_order  integer,
  slug_fr     text, slug_en     text,
  short_fr    text, short_en    text,
  claim_fr    text, claim_en    text,
  long_fr     text, long_en     text,
  hl_fr       jsonb, hl_en      jsonb,
  cov_fr      text, cov_en      text
) ON COMMIT DROP;

INSERT INTO _web_backfill VALUES

('SEA_FREIGHT_IMPORT','freight','PRIMARY',10,
 $t$fret-maritime-import$t$, $t$sea-freight-import$t$,
 $t$Conteneurs complets ou groupage à l'arrivée par Douala et Kribi, réception, dédouanement et livraison compris.$t$,
 $t$Full containers or groupage arriving through Douala and Kribi — reception, clearance and delivery in one file.$t$,
 $t$Un seul dossier, du connaissement à votre entrepôt.$t$,
 $t$One file, from the bill of lading to your warehouse.$t$,
 $t$Nous prenons le dossier à la réservation chez la compagnie maritime et le suivons jusqu'à la livraison : préparation documentaire, suivi du navire, échange du connaissement, déclaration en douane et enlèvement au port.

Les frais de port, les surestaries et les frais de magasinage sont portés sur le dossier au fur et à mesure, ce qui vous laisse voir ce que coûte réellement l'importation avant la facture.$t$,
 $t$We take the file from the booking with the shipping line through to delivery: document preparation, vessel tracking, bill of lading exchange, customs declaration and collection at the port.

Port charges, demurrage and storage are posted to the file as they arise, so you see what the import actually costs before the invoice arrives.$t$,
 $t$["Conteneurs complets (FCL) et groupage (LCL)","Dédouanement et enlèvement inclus","Surestaries et magasinage suivis sur le dossier"]$t$,
 $t$["Full container (FCL) and groupage (LCL)","Customs clearance and collection included","Demurrage and storage tracked on the file"]$t$,
 $t$Ports de Douala et de Kribi, livraison partout au Cameroun et vers l'hinterland CEMAC.$t$,
 $t$Douala and Kribi ports, delivered anywhere in Cameroon and into the CEMAC hinterland.$t$),

('SEA_FREIGHT_EXPORT','freight','PRIMARY',20,
 $t$fret-maritime-export$t$, $t$sea-freight-export$t$,
 $t$Réservation, empotage et formalités d'exportation au départ des ports camerounais.$t$,
 $t$Booking, stuffing and export formalities out of the Cameroonian ports.$t$,
 $t$Vos documents d'export prêts avant la coupure.$t$,
 $t$Your export documents ready before the cut-off.$t$,
 $t$Réservation auprès de la compagnie, positionnement du conteneur, empotage, et l'ensemble des formalités d'exportation : déclaration, certificats, domiciliation bancaire et connaissement.

Le calendrier est construit à l'envers depuis la coupure documentaire, parce que c'est cette date, et non le départ du navire, qui décide si votre marchandise part cette semaine.$t$,
 $t$Booking with the line, container positioning, stuffing, and the full set of export formalities: declaration, certificates, bank domiciliation and bill of lading.

The schedule is built backwards from the documentary cut-off, because that date — not the sailing — is what decides whether your cargo leaves this week.$t$,
 $t$["Réservation et positionnement du conteneur","Formalités et certificats d'exportation","Connaissement et domiciliation bancaire"]$t$,
 $t$["Booking and container positioning","Export formalities and certificates","Bill of lading and bank domiciliation"]$t$,
 $t$Départs des ports de Douala et de Kribi vers l'ensemble des destinations desservies par les lignes régulières.$t$,
 $t$Sailings from Douala and Kribi to every destination served by the regular lines.$t$),

('AIR_FREIGHT_IMPORT','freight','ACCENT',30,
 $t$fret-aerien-import$t$, $t$air-freight-import$t$,
 $t$Marchandises sous délai à l'arrivée par Douala et Yaoundé, dédouanement compris.$t$,
 $t$Time-critical cargo arriving through Douala and Yaoundé, clearance included.$t$,
 $t$Pour ce qui ne peut pas attendre le prochain navire.$t$,
 $t$For what cannot wait for the next vessel.$t$,
 $t$Pièces de rechange, produits de santé, échantillons, matériel de chantier immobilisé : le fret aérien se justifie quand l'attente coûte plus cher que le transport.

Nous récupérons la lettre de transport aérien, préparons la déclaration avant l'atterrissage lorsque le dossier le permet, et enlevons dès la mise à disposition.$t$,
 $t$Spare parts, health products, samples, a site standing idle: air freight earns its price when waiting costs more than the transport does.

We collect the air waybill, prepare the declaration before landing where the file allows it, and collect as soon as the cargo is released.$t$,
 $t$["Suivi de la lettre de transport aérien","Déclaration préparée avant l'atterrissage","Produits sensibles et sous température"]$t$,
 $t$["Air waybill tracking","Declaration prepared before landing","Sensitive and temperature-controlled goods"]$t$,
 $t$Aéroports de Douala et de Yaoundé-Nsimalen, livraison nationale et sous-régionale.$t$,
 $t$Douala and Yaoundé-Nsimalen airports, delivered nationally and across the sub-region.$t$),

('AIR_FREIGHT_EXPORT','freight','ACCENT',40,
 $t$fret-aerien-export$t$, $t$air-freight-export$t$,
 $t$Expéditions aériennes au départ du Cameroun, de l'enlèvement à la lettre de transport.$t$,
 $t$Air shipments out of Cameroon, from collection to air waybill.$t$,
 $t$Enlevé le matin, à bord le soir.$t$,
 $t$Collected in the morning, on board that evening.$t$,
 $t$Enlèvement chez vous, emballage et pesée, formalités d'exportation et remise en magasin sous douane dans les délais de la compagnie.

Nous vous disons le poids taxable avant la réservation, parce que la différence entre poids réel et poids volumétrique est ce qui fait varier le prix d'une expédition aérienne.$t$,
 $t$Collection at your premises, packing and weighing, export formalities and delivery into the bonded warehouse within the airline's deadlines.

We give you the chargeable weight before booking, because the gap between actual and volumetric weight is what moves the price of an air shipment.$t$,
 $t$["Enlèvement, emballage et pesée","Poids taxable annoncé avant réservation","Marchandises dangereuses sur dossier agréé"]$t$,
 $t$["Collection, packing and weighing","Chargeable weight quoted before booking","Dangerous goods on an approved file"]$t$,
 $t$Départs de Douala et de Yaoundé vers l'Europe, l'Asie, l'Afrique et le Moyen-Orient.$t$,
 $t$Departures from Douala and Yaoundé to Europe, Asia, Africa and the Middle East.$t$),

('END_TO_END_SEA_FREIGHT','freight','PRIMARY',50,
 $t$fret-maritime-porte-a-porte$t$, $t$end-to-end-sea-freight$t$,
 $t$Le trajet maritime complet, de l'usine du fournisseur à votre quai de déchargement.$t$,
 $t$The whole sea journey, from the supplier's factory to your unloading bay.$t$,
 $t$Un seul prix, une seule responsabilité.$t$,
 $t$One price, one party responsible.$t$,
 $t$Enlèvement à l'origine, formalités d'exportation, transport maritime, dédouanement à l'arrivée et livraison finale, gérés comme un seul dossier avec un seul interlocuteur.

C'est l'option choisie quand personne chez vous n'a le temps de coordonner trois prestataires et d'arbitrer entre eux quand la marchandise s'arrête quelque part.$t$,
 $t$Collection at origin, export formalities, ocean transport, clearance on arrival and final delivery, run as one file with one point of contact.

This is what you pick when nobody on your side has time to coordinate three providers and referee between them when the cargo stops somewhere.$t$,
 $t$["Enlèvement à l'origine et livraison finale","Un interlocuteur unique sur tout le trajet","Un prix unique porte-à-porte"]$t$,
 $t$["Collection at origin and final delivery","A single contact across the whole journey","One door-to-door price"]$t$,
 $t$Origines desservies par nos correspondants, destinations au Cameroun et dans la sous-région.$t$,
 $t$Origins served by our agent network, destinations in Cameroon and the sub-region.$t$),

('END_TO_END_AIR_FREIGHT','freight','ACCENT',60,
 $t$fret-aerien-porte-a-porte$t$, $t$end-to-end-air-freight$t$,
 $t$Le trajet aérien complet, enlèvement à l'origine et livraison finale comprises.$t$,
 $t$The whole air journey, collection at origin and final delivery included.$t$,
 $t$La rapidité de l'aérien, sans les trous entre les prestataires.$t$,
 $t$Air speed, without the gaps between providers.$t$,
 $t$Enlèvement chez votre fournisseur, formalités des deux côtés, vol et livraison finale : le dossier reste ouvert jusqu'à la signature du bon de livraison.

L'intérêt n'est pas seulement la vitesse mais la continuité — un envoi aérien qui attend trois jours un dédouanement a perdu ce que vous aviez payé.$t$,
 $t$Collection at your supplier, formalities on both sides, flight and final delivery: the file stays open until the delivery note is signed.

The point is not only speed but continuity — an air shipment sitting three days in clearance has lost exactly what you paid for.$t$,
 $t$["Enlèvement chez le fournisseur","Formalités à l'origine et à l'arrivée","Livraison jusqu'au destinataire final"]$t$,
 $t$["Collection at the supplier","Formalities at origin and on arrival","Delivered to the final consignee"]$t$,
 $t$Origines desservies par nos correspondants, livraison au Cameroun et vers l'hinterland.$t$,
 $t$Origins served by our agent network, delivered in Cameroon and into the hinterland.$t$),

('END_TO_END_RAIL_FREIGHT','freight','SUCCESS',70,
 $t$fret-ferroviaire-porte-a-porte$t$, $t$end-to-end-rail-freight$t$,
 $t$Trajet combiné rail et route, du port jusqu'au destinataire final.$t$,
 $t$Combined rail and road, from the port through to the final consignee.$t$,
 $t$Le rail pour la distance, la route pour le dernier kilomètre.$t$,
 $t$Rail for the distance, road for the last mile.$t$,
 $t$Le rail porte la partie longue du trajet et la route fait les deux extrémités. Nous organisons le passage entre les deux, y compris le chargement sur wagon et la reprise à l'arrivée.

C'est l'option qui a du sens sur les volumes réguliers vers l'intérieur, où le coût au kilomètre compte plus que le gain d'une journée.$t$,
 $t$Rail carries the long leg and road covers both ends. We organise the handover between them, including loading onto the wagon and collection at the far end.

It is the option that makes sense on regular inland volumes, where cost per kilometre matters more than saving a day.$t$,
 $t$["Chargement sur wagon et reprise à l'arrivée","Combiné rail-route sur un seul dossier","Adapté aux flux réguliers vers l'intérieur"]$t$,
 $t$["Wagon loading and collection at the far end","Rail and road combined on one file","Suited to regular inland flows"]$t$,
 $t$Corridor ferroviaire national, avec reprise routière jusqu'au destinataire.$t$,
 $t$The national rail corridor, with a road leg through to the consignee.$t$),

('PROJECT_CARGO','freight','SUCCESS',80,
 $t$cargaison-speciale$t$, $t$project-and-break-bulk$t$,
 $t$Colis lourds, hors gabarit et conventionnels, étudiés avant d'être déplacés.$t$,
 $t$Heavy lift, out-of-gauge and conventional cargo, studied before it is moved.$t$,
 $t$Une étude de transport avant le premier levage.$t$,
 $t$A transport study before the first lift.$t$,
 $t$Groupes électrogènes, transformateurs, engins de chantier, structures : ce qui ne rentre pas dans un conteneur se prépare, avec relevé d'itinéraire, choix du matériel de levage et autorisations de circulation.

Nous produisons l'étude avant de citer un prix, parce qu'un devis donné sans avoir vérifié un pont ou un virage n'est pas un devis.$t$,
 $t$Generators, transformers, plant, structures: what does not fit a container has to be prepared — route survey, lifting equipment, and the movement permits that go with it.

We produce the study before quoting, because a price given without checking a bridge or a turn is not a price.$t$,
 $t$["Relevé d'itinéraire et étude de levage","Autorisations de circulation exceptionnelle","Escorte et suivi sur le trajet"]$t$,
 $t$["Route survey and lifting study","Abnormal-load movement permits","Escort and monitoring in transit"]$t$,
 $t$Ports de Douala et de Kribi vers les sites industriels et miniers du Cameroun et de la sous-région.$t$,
 $t$Douala and Kribi ports to industrial and mining sites in Cameroon and the sub-region.$t$),

('HINTERLAND_TRANSIT','logistics','SUCCESS',90,
 $t$transit-hinterland$t$, $t$hinterland-transit$t$,
 $t$Transit sous douane vers le Tchad et la République centrafricaine.$t$,
 $t$Bonded transit to Chad and the Central African Republic.$t$,
 $t$Le corridor, avec la caution et les scellés qui vont avec.$t$,
 $t$The corridor, with the bond and the seals that go with it.$t$,
 $t$Le transit hinterland n'est pas un simple transport routier international : la marchandise reste sous douane pendant tout le trajet, sous caution, scellée, et l'apurement conditionne la mainlevée.

Nous montons le dossier de transit, suivons le convoi jusqu'au bureau de destination et rapportons l'apurement, qui est la seule preuve que l'opération est close.$t$,
 $t$Hinterland transit is not simply international trucking: the cargo stays under customs control for the whole journey, bonded and sealed, and the discharge of that bond is what closes the operation.

We build the transit file, follow the convoy to the destination office and bring back the discharge, which is the only proof the movement is finished.$t$,
 $t$["Caution et scellés douaniers","Suivi du convoi jusqu'au bureau de destination","Apurement rapporté au dossier"]$t$,
 $t$["Customs bond and seals","Convoy followed to the destination office","Discharge returned to the file"]$t$,
 $t$Corridors Douala – N'Djamena et Douala – Bangui.$t$,
 $t$The Douala–N'Djamena and Douala–Bangui corridors.$t$),

('RAIL_HINTERLAND_TRANSIT','logistics','SUCCESS',100,
 $t$transit-ferroviaire-hinterland$t$, $t$rail-hinterland-transit$t$,
 $t$Transit sous douane vers l'hinterland avec la partie longue du trajet effectuée par rail.$t$,
 $t$Bonded transit to the hinterland with the long leg carried by rail.$t$,
 $t$Moins de route, moins d'aléas sur le corridor.$t$,
 $t$Less road, fewer things to go wrong on the corridor.$t$,
 $t$Même régime douanier que le transit routier — caution, scellés, apurement — mais la marchandise voyage sur wagon jusqu'au terminal intérieur avant de reprendre la route.

Le rail réduit l'exposition du convoi et la variabilité des délais sur les tronçons les plus difficiles du corridor.$t$,
 $t$The same customs regime as road transit — bond, seals, discharge — but the cargo travels by wagon to the inland terminal before rejoining the road.

Rail reduces the convoy's exposure and the spread of transit times on the harder stretches of the corridor.$t$,
 $t$["Régime de transit sous caution","Rail jusqu'au terminal intérieur","Reprise routière jusqu'au bureau de destination"]$t$,
 $t$["Bonded transit regime","Rail to the inland terminal","Road leg to the destination office"]$t$,
 $t$Corridor ferroviaire national puis route vers le Tchad et la République centrafricaine.$t$,
 $t$The national rail corridor, then road into Chad and the Central African Republic.$t$),

('INLAND_TRANSPORTATION','logistics','ACCENT',110,
 $t$transport-terrestre$t$, $t$inland-transportation$t$,
 $t$Camionnage national, du port ou de l'entrepôt jusqu'au point de livraison.$t$,
 $t$National trucking, from the port or the warehouse to the delivery point.$t$,
 $t$Un camion adapté au chargement, pas l'inverse.$t$,
 $t$A truck matched to the load, not the other way round.$t$,
 $t$Porte-conteneurs, plateaux, fourgons et bennes selon ce qui est chargé, avec bon de livraison signé au déchargement et retour du conteneur vide géré.

Le transport intérieur est souvent le poste où un dossier d'importation dérape : nous le tenons sur le même dossier que le reste, avec les mêmes jalons.$t$,
 $t$Container carriers, flatbeds, vans and tippers depending on what is loaded, with a signed delivery note at unloading and the empty container return handled.

Inland transport is where an import file most often slips: we keep it on the same file as everything else, with the same milestones.$t$,
 $t$["Matériel adapté au type de chargement","Bon de livraison signé au déchargement","Retour du conteneur vide géré"]$t$,
 $t$["Equipment matched to the load type","Signed delivery note at unloading","Empty container return handled"]$t$,
 $t$Ensemble du territoire camerounais, au départ de Douala, Kribi et Yaoundé.$t$,
 $t$Across Cameroon, from Douala, Kribi and Yaoundé.$t$),

('RAIL_TRANSPORTATION','logistics','SUCCESS',120,
 $t$transport-ferroviaire$t$, $t$rail-transportation$t$,
 $t$Acheminement par wagon sur le réseau national, chargement et déchargement compris.$t$,
 $t$Movement by wagon on the national network, loading and unloading included.$t$,
 $t$Le mode le moins cher au kilomètre, quand le volume suit.$t$,
 $t$The cheapest mode per kilometre, when the volume is there.$t$,
 $t$Réservation du wagon, positionnement, chargement au terminal, acheminement et déchargement à destination, avec le suivi porté sur le dossier comme pour tout autre mode.

Le rail devient intéressant à partir d'un certain volume régulier ; en dessous, nous vous le dirons plutôt que de vous vendre un wagon à moitié plein.$t$,
 $t$Wagon booking, positioning, loading at the terminal, movement and unloading at destination, with tracking on the file exactly as for any other mode.

Rail pays off above a certain regular volume; below it we will say so rather than sell you a half-empty wagon.$t$,
 $t$["Réservation et positionnement du wagon","Chargement et déchargement aux terminaux","Adapté aux volumes réguliers"]$t$,
 $t$["Wagon booking and positioning","Loading and unloading at the terminals","Suited to regular volumes"]$t$,
 $t$Réseau ferroviaire national, terminaux de Douala, Yaoundé et Ngaoundéré.$t$,
 $t$The national rail network, with terminals at Douala, Yaoundé and Ngaoundéré.$t$),

('WAREHOUSING','logistics','PRIMARY',130,
 $t$entreposage$t$, $t$warehousing$t$,
 $t$Stockage sous douane ou de droit commun, avec état du stock consultable.$t$,
 $t$Bonded or general storage, with stock levels you can see.$t$,
 $t$Vous savez ce qui est en stock sans téléphoner.$t$,
 $t$You know what is in stock without telephoning.$t$,
 $t$Réception, mise en stock, préparation de commandes et expédition, en magasin sous douane ou en entrepôt de droit commun selon le régime de la marchandise.

Les mouvements sont enregistrés à l'entrée et à la sortie, et l'état du stock est disponible depuis le portail client plutôt que sur demande.$t$,
 $t$Receiving, put-away, order preparation and dispatch, in a bonded store or a general warehouse depending on the goods' regime.

Movements are recorded in and out, and the stock position is available from the client portal rather than on request.$t$,
 $t$["Magasin sous douane et entrepôt de droit commun","Mouvements enregistrés à l'entrée et à la sortie","État du stock depuis le portail client"]$t$,
 $t$["Bonded store and general warehouse","Movements recorded in and out","Stock position from the client portal"]$t$,
 $t$Installations de Douala, avec livraison depuis le stock partout au Cameroun.$t$,
 $t$Douala facilities, with delivery from stock anywhere in Cameroon.$t$),

('CUSTOMS_BROKERAGE','value-added','ACCENT',140,
 $t$dedouanement$t$, $t$customs-brokerage$t$,
 $t$Déclarations, régimes et contentieux, que le transport soit le nôtre ou non.$t$,
 $t$Declarations, regimes and disputes — whether or not we moved the cargo.$t$,
 $t$Le classement décidé avant, pas discuté après.$t$,
 $t$Classification settled up front, not argued afterwards.$t$,
 $t$Classement tarifaire, valeur en douane, régime applicable, exonérations, circuit rouge et suites contentieuses : le travail commence sur les documents, avant l'arrivée de la marchandise.

C'est un service autonome. Vous pouvez nous confier le seul dédouanement d'un envoi transporté par quelqu'un d'autre.$t$,
 $t$Tariff classification, customs value, applicable regime, exemptions, red-channel handling and any dispute that follows: the work starts on the documents, before the goods arrive.

It stands on its own. You can hand us the clearance of a shipment somebody else carried.$t$,
 $t$["Classement tarifaire et valeur en douane","Exonérations et régimes particuliers","Circuit rouge et contentieux"]$t$,
 $t$["Tariff classification and customs value","Exemptions and special regimes","Red-channel handling and disputes"]$t$,
 $t$Bureaux des ports de Douala et de Kribi et des aéroports de Douala et Yaoundé.$t$,
 $t$The customs offices at Douala and Kribi ports and at Douala and Yaoundé airports.$t$),

('BUSINESS_REPRESENTATION','value-added','PRIMARY',150,
 $t$representation-commerciale$t$, $t$business-representation$t$,
 $t$Une présence locale pour les entreprises qui n'ont pas encore d'établissement au Cameroun.$t$,
 $t$A local presence for companies without an establishment in Cameroon yet.$t$,
 $t$Quelqu'un sur place, avant d'ouvrir un bureau.$t$,
 $t$Someone on the ground, before you open an office.$t$,
 $t$Réception et suivi des dossiers, relations avec les administrations et les partenaires locaux, et présence physique lors des opérations qui l'exigent.

Le service existe parce que beaucoup d'opérations s'arrêtent faute d'un interlocuteur local capable de se déplacer le jour même.$t$,
 $t$Receiving and following files, dealing with the administrations and local partners, and being physically present for the operations that require it.

The service exists because a great many operations stall for want of a local contact who can be somewhere the same day.$t$,
 $t$["Interlocuteur local désigné","Relations avec les administrations","Présence physique lors des opérations"]$t$,
 $t$["A named local contact","Dealings with the administrations","Physical presence at operations"]$t$,
 $t$Douala, Yaoundé et Kribi, avec déplacements dans la sous-région selon le dossier.$t$,
 $t$Douala, Yaoundé and Kribi, travelling into the sub-region as the file requires.$t$);

-- ── The repair ─────────────────────────────────────────────────────────────
-- One UPDATE. `blank(x)` would be a function; inline CASE keeps the file
-- self-contained, because a seed that installs a helper has to clean it up.
UPDATE service_type_web_profile p
   SET short_description_fr = CASE WHEN BTRIM(COALESCE(p.short_description_fr, '')) = '' THEN w.short_fr ELSE p.short_description_fr END,
       short_description_en = CASE WHEN BTRIM(COALESCE(p.short_description_en, '')) = '' THEN w.short_en ELSE p.short_description_en END,
       long_description_fr  = CASE WHEN BTRIM(COALESCE(p.long_description_fr,  '')) = '' THEN w.long_fr  ELSE p.long_description_fr  END,
       long_description_en  = CASE WHEN BTRIM(COALESCE(p.long_description_en,  '')) = '' THEN w.long_en  ELSE p.long_description_en  END,
       claim_fr             = CASE WHEN BTRIM(COALESCE(p.claim_fr, '')) = '' THEN w.claim_fr ELSE p.claim_fr END,
       claim_en             = CASE WHEN BTRIM(COALESCE(p.claim_en, '')) = '' THEN w.claim_en ELSE p.claim_en END,
       coverage_fr          = CASE WHEN BTRIM(COALESCE(p.coverage_fr, '')) = '' THEN w.cov_fr ELSE p.coverage_fr END,
       coverage_en          = CASE WHEN BTRIM(COALESCE(p.coverage_en, '')) = '' THEN w.cov_en ELSE p.coverage_en END,
       -- jsonb_array_length(NULL) is NULL, hence the COALESCE to 0: a NULL
       -- column and an empty array are both "no highlights".
       highlights_fr        = CASE WHEN COALESCE(jsonb_array_length(p.highlights_fr), 0) = 0 THEN w.hl_fr ELSE p.highlights_fr END,
       highlights_en        = CASE WHEN COALESCE(jsonb_array_length(p.highlights_en), 0) = 0 THEN w.hl_en ELSE p.highlights_en END,
       -- The meta pair falls back the way 9084 wrote it: the title is the
       -- service's own name, the description is the card teaser.
       meta_title_fr        = CASE WHEN BTRIM(COALESCE(p.meta_title_fr, '')) = '' THEN st.name_fr ELSE p.meta_title_fr END,
       meta_title_en        = CASE WHEN BTRIM(COALESCE(p.meta_title_en, '')) = '' THEN COALESCE(st.name_en, st.name_fr) ELSE p.meta_title_en END,
       meta_description_fr  = CASE WHEN BTRIM(COALESCE(p.meta_description_fr, '')) = '' THEN w.short_fr ELSE p.meta_description_fr END,
       meta_description_en  = CASE WHEN BTRIM(COALESCE(p.meta_description_en, '')) = '' THEN w.short_en ELSE p.meta_description_en END,
       -- Slug: empty, and only if no other profile already holds it. The
       -- subquery reads the pre-UPDATE snapshot, which is what we want — two
       -- rows in this batch can never be handed the same slug because the
       -- staging table's slugs are distinct per service.
       slug_fr = CASE
                   WHEN BTRIM(COALESCE(p.slug_fr, '')) <> '' THEN p.slug_fr
                   WHEN EXISTS (SELECT 1 FROM service_type_web_profile o
                                 WHERE o.slug_fr = w.slug_fr
                                   AND o.service_type_id <> p.service_type_id) THEN p.slug_fr
                   ELSE w.slug_fr
                 END,
       slug_en = CASE
                   WHEN BTRIM(COALESCE(p.slug_en, '')) <> '' THEN p.slug_en
                   WHEN EXISTS (SELECT 1 FROM service_type_web_profile o
                                 WHERE o.slug_en = w.slug_en
                                   AND o.service_type_id <> p.service_type_id) THEN p.slug_en
                   ELSE w.slug_en
                 END,
       -- NULL pillar → the leftovers bucket on the public page. `g` is a LEFT
       -- join: a tenant who deleted the pillar gets no pillar, not an error.
       group_id             = COALESCE(p.group_id, g.group_id),
       -- Column defaults only — see the header on why that is safe here.
       accent               = CASE WHEN p.accent = 'PRIMARY' THEN w.accent ELSE p.accent END,
       sort_order           = CASE WHEN p.sort_order = 100 THEN w.sort_order ELSE p.sort_order END
  FROM _web_backfill w
  JOIN service_type st ON st.key = w.service_key
  LEFT JOIN service_type_web_group g ON g.key = w.grp AND g.is_active = true
 WHERE p.service_type_id = st.service_type_id
   -- Only rows with something genuinely missing, so `updated_at` stays honest.
   AND (BTRIM(COALESCE(p.short_description_fr, '')) = ''
     OR BTRIM(COALESCE(p.short_description_en, '')) = ''
     OR BTRIM(COALESCE(p.long_description_fr,  '')) = ''
     OR BTRIM(COALESCE(p.long_description_en,  '')) = ''
     OR BTRIM(COALESCE(p.claim_fr, '')) = ''
     OR BTRIM(COALESCE(p.claim_en, '')) = ''
     OR BTRIM(COALESCE(p.coverage_fr, '')) = ''
     OR BTRIM(COALESCE(p.coverage_en, '')) = ''
     OR BTRIM(COALESCE(p.meta_title_fr, '')) = ''
     OR BTRIM(COALESCE(p.meta_title_en, '')) = ''
     OR BTRIM(COALESCE(p.meta_description_fr, '')) = ''
     OR BTRIM(COALESCE(p.meta_description_en, '')) = ''
     OR COALESCE(jsonb_array_length(p.highlights_fr), 0) = 0
     OR COALESCE(jsonb_array_length(p.highlights_en), 0) = 0
     OR BTRIM(COALESCE(p.slug_fr, '')) = ''
     OR BTRIM(COALESCE(p.slug_en, '')) = ''
     OR p.group_id IS NULL);

-- ============================================================================
-- VERIFY
--   SELECT st.key, p.is_published,
--          BTRIM(COALESCE(p.short_description_fr,'')) = '' AS short_fr_missing,
--          BTRIM(COALESCE(p.long_description_en,'')) = ''  AS long_en_missing
--     FROM service_type_web_profile p
--     JOIN service_type st ON st.service_type_id = p.service_type_id
--    ORDER BY st.key;          -- expect: no *_missing true on a seeded key
--
--   -- The reported service, specifically:
--   SELECT p.short_description_fr, p.long_description_fr
--     FROM service_type_web_profile p
--     JOIN service_type st ON st.service_type_id = p.service_type_id
--    WHERE st.key = 'PROJECT_CARGO';
--
--   -- Nothing was published by this file:
--   SELECT count(*) FROM service_type_web_profile WHERE is_published;  -- unchanged
--
-- IRREVERSIBLE: a backfill leaves no record of which columns it filled, so
-- there is no down statement that could distinguish the copy this wrote from
-- copy the tenant has since edited on top of it. Undoing it means NULLing
-- columns that may now hold authored text — data loss dressed as a rollback.
-- If this file lands somewhere it should not have, restore the pre-migration
-- dump (scripts/deploy.sh takes one) rather than writing the inverse UPDATE.
-- ============================================================================
