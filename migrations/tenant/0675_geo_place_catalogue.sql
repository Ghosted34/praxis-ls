-- ============================================================================
-- 0675 — the global place catalogue: the ports, airports and terminals a
-- freight file actually routes through, available before anybody types a word.
--
-- WHY THIS EXISTS. 0478 seeded 24 places: the ones the demo lanes needed. Every
-- other place in the world arrived by silent forward-geocoding on first use,
-- which produced three problems an operator sees and cannot fix:
--
--   1. The picker was empty until somebody had already typed a place wrong once.
--   2. "Kribi" and "Port of Kribi" became two rows with two coordinates.
--   3. Nothing in the row said whether a human had ever looked at it.
--
-- A catalogue fixes all three by being there first: the common case becomes
-- SELECT a known port, and the provider is only consulted for the genuinely
-- unknown — a customer's door, a private terminal — which is the one job a
-- geocoder is actually good at.
--
-- ── PROVENANCE AND LICENCE, stated per row and not only here ────────────────
--
-- CODES: UN/LOCODE (United Nations Code for Trade and Transport Locations),
-- maintained by UNECE and published for free public use. The code is the
-- freight industry's own identifier — it is what appears on the booking, the
-- B/L and the manifest — which is exactly why it belongs in the search index.
--
-- COORDINATES: the port, airport or city reference point, from public
-- geographic sources, rounded to 4 decimal places (~11 m). They are REFERENCE
-- POINTS FOR ROUTE VISUALISATION AND DISTANCE ESTIMATION, not survey data and
-- not for navigation. A berth is not a point and this table does not pretend
-- otherwise. `provenance` records this on every row so the claim travels with
-- the data instead of living in a migration nobody re-reads.
--
-- NOT A BULK DUMP. Every row below is hand-listed and reviewable in this file:
-- 322 places across 112 countries — 232 seaports, 50 air-cargo airports, 38
-- cities and a handful of inland/rail terminals — covering the corridors this
-- product serves (Central and West Africa), the trade lanes into them (Europe,
-- Asia, the Gulf), and the principal ports of the rest of the world. A tenant
-- adds what it needs through the picker's manual-place flow; nobody has to wait
-- for a migration.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
--
-- It does not touch a coordinate that already exists. ON CONFLICT DO NOTHING,
-- so a place an admin corrected by hand (source='MANUAL') or a row 0478 seeded
-- keeps exactly the coordinate it has. The only thing written to an existing
-- row is its UN/LOCODE, and only when that column is still NULL and the row is
-- SEED or CATALOGUE — never MANUAL, never GEOAPIFY. Filling a hole is not the
-- same as overwriting an answer.
--
-- Idempotent: ON CONFLICT DO NOTHING on the insert, and a gap-filling UPDATE
-- that is a no-op on its second run.
-- ============================================================================

WITH catalogue (query_key, name, country, kind, unlocode, latitude, longitude) AS (
  VALUES
  -- ── Cameroon, Chad, CAR, Gabon, Congo, DRC — the home corridor ───────────
    ('douala',            'Douala',                 'CM', 'SEAPORT',       'CMDLA',   4.0482,    9.7004),
    ('kribi',             'Kribi',                  'CM', 'SEAPORT',       'CMKBI',   2.9369,    9.9107),
    ('limbe',             'Limbe',                  'CM', 'SEAPORT',       NULL,      4.0186,    9.2060),
    ('yaounde',           'Yaoundé',                'CM', 'CITY',          'CMYAO',   3.8480,   11.5021),
    ('garoua',            'Garoua',                 'CM', 'CITY',          'CMGOU',   9.3014,   13.3964),
    ('ngaoundere',        'Ngaoundéré',             'CM', 'RAIL_TERMINAL', NULL,      7.3167,   13.5833),
    ('bafoussam',         'Bafoussam',              'CM', 'CITY',          NULL,      5.4781,   10.4176),
    ('bamenda',           'Bamenda',                'CM', 'CITY',          NULL,      5.9631,   10.1591),
    ('ndjamena',          'N''Djamena',             'TD', 'CITY',          'TDNDJ',  12.1348,   15.0557),
    ('moundou',           'Moundou',                'TD', 'CITY',          NULL,      8.5667,   16.0833),
    ('bangui',            'Bangui',                 'CF', 'CITY',          'CFBGF',   4.3948,   18.5582),
    ('libreville',        'Libreville',             'GA', 'SEAPORT',       'GALBV',   0.4162,    9.4673),
    ('owendo',            'Owendo',                 'GA', 'SEAPORT',       'GAOWE',   0.2867,    9.5000),
    ('port gentil',       'Port-Gentil',            'GA', 'SEAPORT',       'GAPOG',  -0.7167,    8.7833),
    ('pointe noire',      'Pointe-Noire',           'CG', 'SEAPORT',       'CGPNR',  -4.7833,   11.8333),
    ('brazzaville',       'Brazzaville',            'CG', 'CITY',          'CGBZV',  -4.2634,   15.2429),
    ('matadi',            'Matadi',                 'CD', 'SEAPORT',       'CDMAT',  -5.8167,   13.4667),
    ('kinshasa',          'Kinshasa',               'CD', 'CITY',          'CDFIH',  -4.3217,   15.3125),
    ('malabo',            'Malabo',                 'GQ', 'SEAPORT',       'GQSSG',   3.7550,    8.7833),
    ('bata',              'Bata',                   'GQ', 'SEAPORT',       'GQBSG',   1.8639,    9.7658),
    ('sao tome',          'São Tomé',               'ST', 'SEAPORT',       'STTMS',   0.3365,    6.7273),

  -- ── West Africa ─────────────────────────────────────────────────────────
    ('lagos',             'Lagos',                  'NG', 'SEAPORT',       'NGLOS',   6.4556,    3.3948),
    ('apapa',             'Apapa',                  'NG', 'SEAPORT',       'NGAPP',   6.4500,    3.3667),
    ('tin can island',    'Tin Can Island',         'NG', 'SEAPORT',       'NGTIN',   6.4400,    3.3400),
    ('onne',              'Onne',                   'NG', 'SEAPORT',       'NGONN',   4.6833,    7.1500),
    ('port harcourt',     'Port Harcourt',          'NG', 'SEAPORT',       'NGPHC',   4.7736,    7.0134),
    ('calabar',           'Calabar',                'NG', 'SEAPORT',       'NGCBQ',   4.9757,    8.3417),
    ('cotonou',           'Cotonou',                'BJ', 'SEAPORT',       'BJCOO',   6.3500,    2.4333),
    ('lome',              'Lomé',                   'TG', 'SEAPORT',       'TGLFW',   6.1375,    1.2123),
    ('tema',              'Tema',                   'GH', 'SEAPORT',       'GHTEM',   5.6678,   -0.0167),
    ('takoradi',          'Takoradi',               'GH', 'SEAPORT',       'GHTKD',   4.8845,   -1.7554),
    ('accra',             'Accra',                  'GH', 'CITY',          'GHACC',   5.6037,   -0.1870),
    ('abidjan',           'Abidjan',                'CI', 'SEAPORT',       'CIABJ',   5.3200,   -4.0167),
    ('san pedro',         'San-Pédro',              'CI', 'SEAPORT',       'CISPY',   4.7500,   -6.6333),
    ('monrovia',          'Monrovia',               'LR', 'SEAPORT',       'LRMLW',   6.3500,  -10.8000),
    ('freetown',          'Freetown',               'SL', 'SEAPORT',       'SLFNA',   8.4833,  -13.2333),
    ('conakry',           'Conakry',                'GN', 'SEAPORT',       'GNCKY',   9.5092,  -13.7122),
    ('banjul',            'Banjul',                 'GM', 'SEAPORT',       'GMBJL',  13.4500,  -16.5833),
    ('dakar',             'Dakar',                  'SN', 'SEAPORT',       'SNDKR',  14.6667,  -17.4333),
    ('nouakchott',        'Nouakchott',             'MR', 'SEAPORT',       'MRNKC',  18.0333,  -16.0167),
    ('bamako',            'Bamako',                 'ML', 'CITY',          'MLBKO',  12.6392,   -8.0029),
    ('ouagadougou',       'Ouagadougou',            'BF', 'CITY',          'BFOUA',  12.3714,   -1.5197),
    ('niamey',            'Niamey',                 'NE', 'CITY',          'NENIM',  13.5127,    2.1128),

  -- ── North Africa ────────────────────────────────────────────────────────
    ('tanger med',        'Tanger Med',             'MA', 'SEAPORT',       'MAPTM',  35.8869,   -5.5000),
    ('casablanca',        'Casablanca',             'MA', 'SEAPORT',       'MACAS',  33.6000,   -7.6167),
    ('agadir',            'Agadir',                 'MA', 'SEAPORT',       'MAAGA',  30.4167,   -9.6333),
    ('alexandria',        'Alexandria',             'EG', 'SEAPORT',       'EGALY',  31.1833,   29.8667),
    ('port said',         'Port Said',              'EG', 'SEAPORT',       'EGPSD',  31.2653,   32.3019),
    ('damietta',          'Damietta',               'EG', 'SEAPORT',       'EGDAM',  31.4667,   31.7500),
    ('suez',              'Suez',                   'EG', 'SEAPORT',       'EGSUZ',  29.9668,   32.5498),
    ('cairo',             'Cairo',                  'EG', 'CITY',          'EGCAI',  30.0444,   31.2357),
    ('algiers',           'Algiers',                'DZ', 'SEAPORT',       'DZALG',  36.7667,    3.0667),
    ('oran',              'Oran',                   'DZ', 'SEAPORT',       'DZORN',  35.7000,   -0.6333),
    ('tunis',             'Tunis',                  'TN', 'SEAPORT',       'TNTUN',  36.8000,   10.1833),
    ('rades',             'Radès',                  'TN', 'SEAPORT',       'TNRDS',  36.7833,   10.2833),
    ('tripoli',           'Tripoli',                'LY', 'SEAPORT',       'LYTIP',  32.9000,   13.1833),
    ('misrata',           'Misrata',                'LY', 'SEAPORT',       'LYMRA',  32.3667,   15.2167),

  -- ── East and Southern Africa ────────────────────────────────────────────
    ('djibouti',          'Djibouti',               'DJ', 'SEAPORT',       'DJJIB',  11.6000,   43.1500),
    ('port sudan',        'Port Sudan',             'SD', 'SEAPORT',       'SDPZU',  19.6167,   37.2167),
    ('massawa',           'Massawa',                'ER', 'SEAPORT',       'ERMSW',  15.6100,   39.4500),
    ('addis ababa',       'Addis Ababa',            'ET', 'CITY',          'ETADD',   9.0192,   38.7525),
    ('mombasa',           'Mombasa',                'KE', 'SEAPORT',       'KEMBA',  -4.0621,   39.6682),
    ('nairobi',           'Nairobi',                'KE', 'CITY',          'KENBO',  -1.2864,   36.8172),
    ('dar es salaam',     'Dar es Salaam',          'TZ', 'SEAPORT',       'TZDAR',  -6.8161,   39.2803),
    ('kampala',           'Kampala',                'UG', 'CITY',          'UGKLA',   0.3476,   32.5825),
    ('kigali',            'Kigali',                 'RW', 'CITY',          'RWKGL',  -1.9441,   30.0619),
    ('durban',            'Durban',                 'ZA', 'SEAPORT',       'ZADUR', -29.8667,   31.0167),
    ('cape town',         'Cape Town',              'ZA', 'SEAPORT',       'ZACPT', -33.9167,   18.4333),
    ('port elizabeth',    'Port Elizabeth',         'ZA', 'SEAPORT',       'ZAPLZ', -33.9667,   25.6167),
    ('ngqura',            'Ngqura',                 'ZA', 'SEAPORT',       'ZAZBA', -33.8000,   25.6833),
    ('richards bay',      'Richards Bay',           'ZA', 'SEAPORT',       'ZARCB', -28.8000,   32.0333),
    ('johannesburg',      'Johannesburg',           'ZA', 'CITY',          'ZAJNB', -26.2041,   28.0473),
    ('walvis bay',        'Walvis Bay',             'NA', 'SEAPORT',       'NAWVB', -22.9500,   14.5000),
    ('luanda',            'Luanda',                 'AO', 'SEAPORT',       'AOLAD',  -8.7833,   13.2333),
    ('lobito',            'Lobito',                 'AO', 'SEAPORT',       'AOLOB', -12.3500,   13.5333),
    ('maputo',            'Maputo',                 'MZ', 'SEAPORT',       'MZMPM', -25.9667,   32.5833),
    ('beira',             'Beira',                  'MZ', 'SEAPORT',       'MZBEW', -19.8333,   34.8333),
    ('nacala',            'Nacala',                 'MZ', 'SEAPORT',       'MZMNC', -14.5333,   40.6833),
    ('port louis',        'Port Louis',             'MU', 'SEAPORT',       'MUPLU', -20.1500,   57.5000),
    ('toamasina',         'Toamasina',              'MG', 'SEAPORT',       'MGTMM', -18.1500,   49.4167),
    ('antananarivo',      'Antananarivo',           'MG', 'CITY',          'MGTNR', -18.8792,   47.5079),

  -- ── Northern Europe ─────────────────────────────────────────────────────
    ('antwerp',           'Antwerp',                'BE', 'SEAPORT',       'BEANR',  51.2602,    4.4028),
    ('zeebrugge',         'Zeebrugge',              'BE', 'SEAPORT',       'BEZEE',  51.3333,    3.2000),
    ('ghent',             'Ghent',                  'BE', 'SEAPORT',       'BEGNE',  51.1000,    3.7500),
    ('brussels',          'Brussels',               'BE', 'CITY',          'BEBRU',  50.8503,    4.3517),
    ('rotterdam',         'Rotterdam',              'NL', 'SEAPORT',       'NLRTM',  51.9482,    4.1408),
    ('amsterdam',         'Amsterdam',              'NL', 'SEAPORT',       'NLAMS',  52.3833,    4.8833),
    ('hamburg',           'Hamburg',                'DE', 'SEAPORT',       'DEHAM',  53.5333,    9.9833),
    ('bremerhaven',       'Bremerhaven',            'DE', 'SEAPORT',       'DEBRV',  53.5500,    8.5667),
    ('wilhelmshaven',     'Wilhelmshaven',          'DE', 'SEAPORT',       'DEWVN',  53.5167,    8.1333),
    ('duisburg',          'Duisburg',               'DE', 'INLAND',        'DEDUI',  51.4333,    6.7500),
    ('frankfurt',         'Frankfurt',              'DE', 'CITY',          'DEFRA',  50.1109,    8.6821),
    ('felixstowe',        'Felixstowe',             'GB', 'SEAPORT',       'GBFXT',  51.9500,    1.3167),
    ('london gateway',    'London Gateway',         'GB', 'SEAPORT',       'GBLGP',  51.5000,    0.4833),
    ('southampton',       'Southampton',            'GB', 'SEAPORT',       'GBSOU',  50.9000,   -1.4000),
    ('liverpool',         'Liverpool',              'GB', 'SEAPORT',       'GBLIV',  53.4333,   -3.0000),
    ('immingham',         'Immingham',              'GB', 'SEAPORT',       'GBIMM',  53.6333,   -0.1833),
    ('london',            'London',                 'GB', 'CITY',          'GBLON',  51.5074,   -0.1278),
    ('dublin',            'Dublin',                 'IE', 'SEAPORT',       'IEDUB',  53.3478,   -6.2019),
    ('gdansk',            'Gdańsk',                 'PL', 'SEAPORT',       'PLGDN',  54.3667,   18.6500),
    ('gdynia',            'Gdynia',                 'PL', 'SEAPORT',       'PLGDY',  54.5333,   18.5333),
    ('klaipeda',          'Klaipėda',               'LT', 'SEAPORT',       'LTKLJ',  55.7000,   21.1333),
    ('riga',              'Riga',                   'LV', 'SEAPORT',       'LVRIX',  56.9500,   24.1000),
    ('tallinn',           'Tallinn',                'EE', 'SEAPORT',       'EETLL',  59.4500,   24.7500),
    ('helsinki',          'Helsinki',               'FI', 'SEAPORT',       'FIHEL',  60.1667,   24.9500),
    ('gothenburg',        'Gothenburg',             'SE', 'SEAPORT',       'SEGOT',  57.7000,   11.9667),
    ('stockholm',         'Stockholm',              'SE', 'CITY',          'SESTO',  59.3293,   18.0686),
    ('copenhagen',        'Copenhagen',             'DK', 'SEAPORT',       'DKCPH',  55.6761,   12.5683),
    ('aarhus',            'Aarhus',                 'DK', 'SEAPORT',       'DKAAR',  56.1500,   10.2167),
    ('oslo',              'Oslo',                   'NO', 'SEAPORT',       'NOOSL',  59.9139,   10.7522),
    ('saint petersburg',  'Saint Petersburg',       'RU', 'SEAPORT',       'RULED',  59.9000,   30.2500),
    ('novorossiysk',      'Novorossiysk',           'RU', 'SEAPORT',       'RUNVS',  44.7167,   37.7833),
    ('luxembourg',        'Luxembourg',             'LU', 'CITY',          'LULUX',  49.6116,    6.1319),

  -- ── France, Iberia, the Mediterranean ───────────────────────────────────
    ('le havre',          'Le Havre',               'FR', 'SEAPORT',       'FRLEH',  49.4871,    0.1076),
    ('marseille',         'Marseille',              'FR', 'SEAPORT',       'FRMRS',  43.3388,    5.3535),
    ('fos sur mer',       'Fos-sur-Mer',            'FR', 'SEAPORT',       'FRFOS',  43.4167,    4.8667),
    ('dunkirk',           'Dunkirk',                'FR', 'SEAPORT',       'FRDKK',  51.0333,    2.3667),
    ('bordeaux',          'Bordeaux',               'FR', 'SEAPORT',       'FRBOD',  44.8378,   -0.5792),
    ('nantes',            'Nantes',                 'FR', 'SEAPORT',       'FRNTE',  47.2184,   -1.5536),
    ('paris',             'Paris',                  'FR', 'CITY',          'FRPAR',  48.8566,    2.3522),
    ('lyon',              'Lyon',                   'FR', 'CITY',          'FRLIO',  45.7640,    4.8357),
    ('valencia',          'Valencia',               'ES', 'SEAPORT',       'ESVLC',  39.4500,   -0.3167),
    ('algeciras',         'Algeciras',              'ES', 'SEAPORT',       'ESALG',  36.1333,   -5.4500),
    ('barcelona',         'Barcelona',              'ES', 'SEAPORT',       'ESBCN',  41.3500,    2.1667),
    ('bilbao',            'Bilbao',                 'ES', 'SEAPORT',       'ESBIO',  43.3500,   -3.0333),
    ('lisbon',            'Lisbon',                 'PT', 'SEAPORT',       'PTLIS',  38.7167,   -9.1333),
    ('leixoes',           'Leixões',                'PT', 'SEAPORT',       'PTLEI',  41.1833,   -8.7000),
    ('sines',             'Sines',                  'PT', 'SEAPORT',       'PTSIE',  37.9500,   -8.8667),
    ('genoa',             'Genoa',                  'IT', 'SEAPORT',       'ITGOA',  44.4056,    8.9463),
    ('gioia tauro',       'Gioia Tauro',            'IT', 'SEAPORT',       'ITGIT',  38.4500,   15.9000),
    ('la spezia',         'La Spezia',              'IT', 'SEAPORT',       'ITSPE',  44.1000,    9.8333),
    ('livorno',           'Livorno',                'IT', 'SEAPORT',       'ITLIV',  43.5500,   10.3000),
    ('naples',            'Naples',                 'IT', 'SEAPORT',       'ITNAP',  40.8333,   14.2500),
    ('trieste',           'Trieste',                'IT', 'SEAPORT',       'ITTRS',  45.6500,   13.7667),
    ('venice',            'Venice',                 'IT', 'SEAPORT',       'ITVCE',  45.4375,   12.3358),
    ('koper',             'Koper',                  'SI', 'SEAPORT',       'SIKOP',  45.5500,   13.7333),
    ('rijeka',            'Rijeka',                 'HR', 'SEAPORT',       'HRRJK',  45.3167,   14.4333),
    ('piraeus',           'Piraeus',                'GR', 'SEAPORT',       'GRPIR',  37.9500,   23.6333),
    ('thessaloniki',      'Thessaloniki',           'GR', 'SEAPORT',       'GRSKG',  40.6333,   22.9333),
    ('marsaxlokk',        'Marsaxlokk',             'MT', 'SEAPORT',       'MTMAR',  35.8333,   14.5500),
    ('limassol',          'Limassol',               'CY', 'SEAPORT',       'CYLMS',  34.6500,   33.0333),
    ('constanta',         'Constanța',              'RO', 'SEAPORT',       'ROCND',  44.1667,   28.6500),
    ('varna',             'Varna',                  'BG', 'SEAPORT',       'BGVAR',  43.2000,   27.9167),
    ('odesa',             'Odesa',                  'UA', 'SEAPORT',       'UAODS',  46.4833,   30.7333),
    ('poti',              'Poti',                   'GE', 'SEAPORT',       'GEPTI',  42.1500,   41.6667),
    ('istanbul',          'Istanbul',               'TR', 'SEAPORT',       'TRIST',  41.0086,   28.9784),
    ('ambarli',           'Ambarli',                'TR', 'SEAPORT',       'TRAMB',  40.9667,   28.6833),
    ('mersin',            'Mersin',                 'TR', 'SEAPORT',       'TRMER',  36.8000,   34.6333),
    ('izmir',             'İzmir',                  'TR', 'SEAPORT',       'TRIZM',  38.4333,   27.1500),

  -- ── The Gulf and the Middle East ────────────────────────────────────────
    ('jebel ali',         'Jebel Ali',              'AE', 'SEAPORT',       'AEJEA',  25.0119,   55.0610),
    ('dubai',             'Dubai',                  'AE', 'SEAPORT',       'AEDXB',  25.2769,   55.2965),
    ('khalifa port',      'Khalifa Port',           'AE', 'SEAPORT',       'AEKHL',  24.8000,   54.6500),
    ('abu dhabi',         'Abu Dhabi',              'AE', 'SEAPORT',       'AEAUH',  24.4667,   54.3667),
    ('sharjah',           'Sharjah',                'AE', 'SEAPORT',       'AESHJ',  25.3667,   55.4000),
    ('jeddah',            'Jeddah',                 'SA', 'SEAPORT',       'SAJED',  21.4833,   39.1833),
    ('dammam',            'Dammam',                 'SA', 'SEAPORT',       'SADMM',  26.5000,   50.2000),
    ('king abdullah port','King Abdullah Port',     'SA', 'SEAPORT',       'SAKAC',  22.4000,   39.1000),
    ('riyadh',            'Riyadh',                 'SA', 'CITY',          'SARUH',  24.7136,   46.6753),
    ('hamad port',        'Hamad Port',             'QA', 'SEAPORT',       'QAHMD',  25.0333,   51.6167),
    ('doha',              'Doha',                   'QA', 'CITY',          'QADOH',  25.2854,   51.5310),
    ('kuwait',            'Kuwait',                 'KW', 'SEAPORT',       'KWKWI',  29.3667,   47.9333),
    ('salalah',           'Salalah',                'OM', 'SEAPORT',       'OMSLL',  16.9333,   54.0000),
    ('sohar',             'Sohar',                  'OM', 'SEAPORT',       'OMSOH',  24.5000,   56.6167),
    ('muscat',            'Muscat',                 'OM', 'CITY',          'OMMCT',  23.6167,   58.5667),
    ('bandar abbas',      'Bandar Abbas',           'IR', 'SEAPORT',       'IRBND',  27.1833,   56.2667),
    ('umm qasr',          'Umm Qasr',               'IQ', 'SEAPORT',       'IQUQR',  30.0333,   47.9333),
    ('aqaba',             'Aqaba',                  'JO', 'SEAPORT',       'JOAQJ',  29.5167,   35.0000),
    ('haifa',             'Haifa',                  'IL', 'SEAPORT',       'ILHFA',  32.8167,   34.9833),
    ('ashdod',            'Ashdod',                 'IL', 'SEAPORT',       'ILASH',  31.8167,   34.6500),
    ('beirut',            'Beirut',                 'LB', 'SEAPORT',       'LBBEY',  33.9000,   35.5167),
    ('lattakia',          'Lattakia',               'SY', 'SEAPORT',       'SYLTK',  35.5167,   35.7833),

  -- ── South, South-East and East Asia ─────────────────────────────────────
    ('karachi',           'Karachi',                'PK', 'SEAPORT',       'PKKHI',  24.8333,   66.9833),
    ('port qasim',        'Port Qasim',             'PK', 'SEAPORT',       'PKBQM',  24.7667,   67.3333),
    ('nhava sheva',       'Nhava Sheva',            'IN', 'SEAPORT',       'INNSA',  18.9500,   72.9500),
    ('mumbai',            'Mumbai',                 'IN', 'SEAPORT',       'INBOM',  18.9417,   72.8356),
    ('mundra',            'Mundra',                 'IN', 'SEAPORT',       'INMUN',  22.8333,   69.7167),
    ('kandla',            'Kandla',                 'IN', 'SEAPORT',       'INIXY',  22.9833,   70.2167),
    ('chennai',           'Chennai',                'IN', 'SEAPORT',       'INMAA',  13.1000,   80.3000),
    ('cochin',            'Cochin',                 'IN', 'SEAPORT',       'INCOK',   9.9667,   76.2667),
    ('tuticorin',         'Tuticorin',              'IN', 'SEAPORT',       'INTUT',   8.7500,   78.2000),
    ('kolkata',           'Kolkata',                'IN', 'SEAPORT',       'INCCU',  22.5500,   88.3333),
    ('delhi',             'Delhi',                  'IN', 'CITY',          'INDEL',  28.6139,   77.2090),
    ('colombo',           'Colombo',                'LK', 'SEAPORT',       'LKCMB',   6.9500,   79.8500),
    ('chittagong',        'Chittagong',             'BD', 'SEAPORT',       'BDCGP',  22.3167,   91.8000),
    ('singapore',         'Singapore',              'SG', 'SEAPORT',       'SGSIN',   1.2644,  103.8220),
    ('port klang',        'Port Klang',             'MY', 'SEAPORT',       'MYPKG',   3.0000,  101.4000),
    ('tanjung pelepas',   'Tanjung Pelepas',        'MY', 'SEAPORT',       'MYTPP',   1.3667,  103.5500),
    ('penang',            'Penang',                 'MY', 'SEAPORT',       'MYPEN',   5.4167,  100.3500),
    ('laem chabang',      'Laem Chabang',           'TH', 'SEAPORT',       'THLCH',  13.0833,  100.8833),
    ('bangkok',           'Bangkok',                'TH', 'SEAPORT',       'THBKK',  13.7000,  100.5667),
    ('ho chi minh city',  'Ho Chi Minh City',       'VN', 'SEAPORT',       'VNSGN',  10.7667,  106.7000),
    ('haiphong',          'Haiphong',               'VN', 'SEAPORT',       'VNHPH',  20.8500,  106.6833),
    ('da nang',           'Da Nang',                'VN', 'SEAPORT',       'VNDAD',  16.1000,  108.2167),
    ('jakarta',           'Jakarta',                'ID', 'SEAPORT',       'IDJKT',  -6.1000,  106.8833),
    ('surabaya',          'Surabaya',               'ID', 'SEAPORT',       'IDSUB',  -7.2000,  112.7333),
    ('manila',            'Manila',                 'PH', 'SEAPORT',       'PHMNL',  14.5833,  120.9667),
    ('cebu',              'Cebu',                   'PH', 'SEAPORT',       'PHCEB',  10.3000,  123.9000),
    ('hong kong',         'Hong Kong',              'HK', 'SEAPORT',       'HKHKG',  22.3000,  114.1667),
    ('shanghai',          'Shanghai',               'CN', 'SEAPORT',       'CNSHA',  31.2292,  121.4744),
    ('ningbo',            'Ningbo',                 'CN', 'SEAPORT',       'CNNGB',  29.8683,  121.5440),
    ('guangzhou',         'Guangzhou',              'CN', 'SEAPORT',       'CNCAN',  23.1292,  113.2644),
    ('shenzhen',          'Shenzhen',               'CN', 'SEAPORT',       'CNSZX',  22.5431,  114.0579),
    ('yantian',           'Yantian',                'CN', 'SEAPORT',       'CNYTN',  22.5833,  114.2667),
    ('shekou',            'Shekou',                 'CN', 'SEAPORT',       'CNSHK',  22.4750,  113.9167),
    ('qingdao',           'Qingdao',                'CN', 'SEAPORT',       'CNTAO',  36.0667,  120.3833),
    ('tianjin',           'Tianjin',                'CN', 'SEAPORT',       'CNTSN',  39.0000,  117.7000),
    ('dalian',            'Dalian',                 'CN', 'SEAPORT',       'CNDLC',  38.9333,  121.6333),
    ('xiamen',            'Xiamen',                 'CN', 'SEAPORT',       'CNXMN',  24.4667,  118.0833),
    ('fuzhou',            'Fuzhou',                 'CN', 'SEAPORT',       'CNFOC',  26.0833,  119.3000),
    ('lianyungang',       'Lianyungang',            'CN', 'SEAPORT',       'CNLYG',  34.7500,  119.4500),
    ('beijing',           'Beijing',                'CN', 'CITY',          'CNBJS',  39.9042,  116.4074),
    ('busan',            'Busan',                   'KR', 'SEAPORT',       'KRPUS',  35.1000,  129.0333),
    ('incheon',           'Incheon',                'KR', 'SEAPORT',       'KRINC',  37.4500,  126.6167),
    ('gwangyang',         'Gwangyang',              'KR', 'SEAPORT',       'KRKAN',  34.9000,  127.7000),
    ('tokyo',             'Tokyo',                  'JP', 'SEAPORT',       'JPTYO',  35.6500,  139.7667),
    ('yokohama',          'Yokohama',               'JP', 'SEAPORT',       'JPYOK',  35.4500,  139.6500),
    ('nagoya',            'Nagoya',                 'JP', 'SEAPORT',       'JPNGO',  35.0833,  136.8833),
    ('kobe',              'Kobe',                   'JP', 'SEAPORT',       'JPUKB',  34.6833,  135.2000),
    ('osaka',             'Osaka',                  'JP', 'SEAPORT',       'JPOSA',  34.6500,  135.4333),
    ('kaohsiung',         'Kaohsiung',              'TW', 'SEAPORT',       'TWKHH',  22.6167,  120.2833),
    ('keelung',           'Keelung',                'TW', 'SEAPORT',       'TWKEL',  25.1333,  121.7333),
    ('taipei',            'Taipei',                 'TW', 'CITY',          'TWTPE',  25.0330,  121.5654),

  -- ── The Americas ────────────────────────────────────────────────────────
    ('new york',          'New York',               'US', 'SEAPORT',       'USNYC',  40.6833,  -74.0333),
    ('newark',            'Newark',                 'US', 'SEAPORT',       'USEWR',  40.6833,  -74.1667),
    ('los angeles',       'Los Angeles',            'US', 'SEAPORT',       'USLAX',  33.7333, -118.2667),
    ('long beach',        'Long Beach',             'US', 'SEAPORT',       'USLGB',  33.7667, -118.2000),
    ('oakland',           'Oakland',                'US', 'SEAPORT',       'USOAK',  37.8000, -122.3167),
    ('seattle',           'Seattle',                'US', 'SEAPORT',       'USSEA',  47.6000, -122.3500),
    ('tacoma',            'Tacoma',                 'US', 'SEAPORT',       'USTIW',  47.2667, -122.4167),
    ('savannah',          'Savannah',               'US', 'SEAPORT',       'USSAV',  32.1333,  -81.1500),
    ('charleston',        'Charleston',             'US', 'SEAPORT',       'USCHS',  32.7833,  -79.9333),
    ('norfolk',           'Norfolk',                'US', 'SEAPORT',       'USORF',  36.8500,  -76.3000),
    ('houston',           'Houston',                'US', 'SEAPORT',       'USHOU',  29.7333,  -95.2667),
    ('miami',             'Miami',                  'US', 'SEAPORT',       'USMIA',  25.7750,  -80.1750),
    ('baltimore',         'Baltimore',              'US', 'SEAPORT',       'USBAL',  39.2667,  -76.5833),
    ('chicago',           'Chicago',                'US', 'CITY',          'USCHI',  41.8781,  -87.6298),
    ('atlanta',           'Atlanta',                'US', 'CITY',          'USATL',  33.7490,  -84.3880),
    ('montreal',          'Montreal',               'CA', 'SEAPORT',       'CAMTR',  45.5333,  -73.5333),
    ('vancouver',         'Vancouver',              'CA', 'SEAPORT',       'CAVAN',  49.2833, -123.1000),
    ('halifax',           'Halifax',                'CA', 'SEAPORT',       'CAHAL',  44.6500,  -63.5833),
    ('toronto',           'Toronto',                'CA', 'CITY',          'CATOR',  43.6532,  -79.3832),
    ('veracruz',          'Veracruz',               'MX', 'SEAPORT',       'MXVER',  19.2000,  -96.1333),
    ('manzanillo',        'Manzanillo',             'MX', 'SEAPORT',       'MXZLO',  19.0500, -104.3167),
    ('altamira',          'Altamira',               'MX', 'SEAPORT',       'MXATM',  22.5000,  -97.9333),
    ('lazaro cardenas',   'Lázaro Cárdenas',        'MX', 'SEAPORT',       'MXLZC',  17.9500, -102.1833),
    ('mexico city',       'Mexico City',            'MX', 'CITY',          'MXMEX',  19.4326,  -99.1332),
    ('balboa',            'Balboa',                 'PA', 'SEAPORT',       'PABLB',   8.9500,  -79.5667),
    ('cristobal',         'Cristóbal',              'PA', 'SEAPORT',       'PACTB',   9.3500,  -79.9167),
    ('cartagena',         'Cartagena',              'CO', 'SEAPORT',       'COCTG',  10.4000,  -75.5167),
    ('buenaventura',      'Buenaventura',           'CO', 'SEAPORT',       'COBUN',   3.8833,  -77.0667),
    ('callao',            'Callao',                 'PE', 'SEAPORT',       'PECLL', -12.0500,  -77.1500),
    ('guayaquil',         'Guayaquil',              'EC', 'SEAPORT',       'ECGYE',  -2.2667,  -79.9000),
    ('valparaiso',        'Valparaíso',             'CL', 'SEAPORT',       'CLVAP', -33.0333,  -71.6167),
    ('san antonio',       'San Antonio',            'CL', 'SEAPORT',       'CLSAI', -33.5833,  -71.6167),
    ('santos',            'Santos',                 'BR', 'SEAPORT',       'BRSSZ', -23.9500,  -46.3333),
    ('rio de janeiro',    'Rio de Janeiro',         'BR', 'SEAPORT',       'BRRIO', -22.9000,  -43.1833),
    ('paranagua',         'Paranaguá',              'BR', 'SEAPORT',       'BRPNG', -25.5000,  -48.5167),
    ('itajai',            'Itajaí',                 'BR', 'SEAPORT',       'BRITJ', -26.9000,  -48.6500),
    ('rio grande',        'Rio Grande',             'BR', 'SEAPORT',       'BRRIG', -32.0333,  -52.1000),
    ('suape',             'Suape',                  'BR', 'SEAPORT',       'BRSUA',  -8.4000,  -34.9500),
    ('sao paulo',         'São Paulo',              'BR', 'CITY',          'BRSAO', -23.5505,  -46.6333),
    ('buenos aires',      'Buenos Aires',           'AR', 'SEAPORT',       'ARBUE', -34.6000,  -58.3667),
    ('montevideo',        'Montevideo',             'UY', 'SEAPORT',       'UYMVD', -34.9000,  -56.2167),
    ('kingston',          'Kingston',               'JM', 'SEAPORT',       'JMKIN',  17.9667,  -76.7833),
    ('caucedo',           'Caucedo',                'DO', 'SEAPORT',       'DOCAU',  18.4167,  -69.6333),
    ('freeport',          'Freeport',               'BS', 'SEAPORT',       'BSFPO',  26.5333,  -78.7667),

  -- ── Oceania ─────────────────────────────────────────────────────────────
    ('sydney',            'Sydney',                 'AU', 'SEAPORT',       'AUSYD', -33.8500,  151.2000),
    ('melbourne',         'Melbourne',              'AU', 'SEAPORT',       'AUMEL', -37.8333,  144.9167),
    ('brisbane',          'Brisbane',               'AU', 'SEAPORT',       'AUBNE', -27.3833,  153.1667),
    ('fremantle',         'Fremantle',              'AU', 'SEAPORT',       'AUFRE', -32.0500,  115.7500),
    ('auckland',          'Auckland',               'NZ', 'SEAPORT',       'NZAKL', -36.8500,  174.7833),
    ('tauranga',          'Tauranga',               'NZ', 'SEAPORT',       'NZTRG', -37.6500,  176.1833)
),
-- New places only. An existing query_key keeps every value it has — including a
-- coordinate somebody corrected by hand, which is the whole reason 0478's upsert
-- is DO NOTHING rather than DO UPDATE.
inserted AS (
  INSERT INTO geo_place (
    query_key, name, country, kind, unlocode, latitude, longitude,
    source, provenance, verified_at, is_active, is_reference_point
  )
  SELECT
    c.query_key, c.name, c.country, c.kind, c.unlocode, c.latitude, c.longitude,
    'CATALOGUE',
    'UN/LOCODE (UNECE, free public use). Coordinates are public port/airport reference points to 4 dp, for route visualisation only',
    now(), true, false
  FROM catalogue c
  ON CONFLICT (query_key) DO NOTHING
  RETURNING geo_place_id
)
-- Gap fill, and ONLY a gap fill: the 24 places 0478 seeded predate the code
-- column, so they are unsearchable by UN/LOCODE until this runs. Coordinates,
-- names and kinds are untouched, and MANUAL/GEOAPIFY rows are excluded outright
-- so no hand correction and no cached provider answer is rewritten here.
UPDATE geo_place g
   SET unlocode    = c.unlocode,
       verified_at = COALESCE(g.verified_at, now()),
       provenance  = COALESCE(g.provenance, 'UN/LOCODE (UNECE, free public use)')
  FROM catalogue c
 WHERE g.query_key = c.query_key
   AND g.unlocode IS NULL
   AND c.unlocode IS NOT NULL
   AND g.source IN ('SEED', 'CATALOGUE');

-- ============================================================================
-- Airports, kept as their own block for one reason: they carry a SECOND code.
--
-- An air file is booked on the IATA code — the MAWB says NBO, not KENBO — so an
-- operator searching "NBO" must find Nairobi's airport. UN/LOCODE cannot carry
-- that: it codes the LOCALITY, so Douala's port and Douala's airport share
-- CMDLA, and an exact-code search on it is ambiguous by construction.
--
-- So the IATA code rides in `formatted`, which the place search already matches
-- on, and `unlocode` is set only where the airport has its own unambiguous
-- locality code. That keeps one column meaning one thing and still lets the
-- three-letter code every air operator actually types find the right row.
--
-- Coordinates are the airport reference point (the published ARP where known),
-- not the terminal building or the freight shed.
-- ============================================================================

INSERT INTO geo_place (
  query_key, name, country, kind, unlocode, formatted, latitude, longitude,
  source, provenance, verified_at, is_active, is_reference_point
)
SELECT
  a.query_key, a.name, a.country, 'AIRPORT', a.unlocode,
  a.iata || ' · ' || a.name || ' airport, ' || a.city,
  a.latitude, a.longitude,
  'CATALOGUE',
  'IATA airport code. Coordinates are the public airport reference point to 4 dp, for route visualisation only',
  now(), true, false
FROM (VALUES
  -- ── Africa ──────────────────────────────────────────────────────────────
    -- unlocode deliberately NULL: CMDLA is the LOCALITY code and the seaport row
    -- already holds it. Two rows sharing one code makes an exact-code search
    -- ambiguous, and an air operator searches DLA anyway.
    ('douala airport',            'Douala Airport',            'Douala',       'CM', 'DLA', NULL,      4.0061,    9.7195),
    ('yaounde nsimalen',          'Yaoundé Nsimalen',          'Yaoundé',      'CM', 'NSI', 'CMNSI',   3.7226,   11.5533),
    ('ndjamena hassan djamous',   'N''Djamena Hassan Djamous', 'N''Djamena',   'TD', 'NDJ', NULL,     12.1337,   15.0340),
    ('bangui mpoko',              'Bangui M''Poko',            'Bangui',       'CF', 'BGF', NULL,      4.3985,   18.5188),
    ('libreville leon mba',       'Libreville Léon-Mba',       'Libreville',   'GA', 'LBV', NULL,      0.4586,    9.4123),
    ('kinshasa ndjili',           'Kinshasa N''djili',         'Kinshasa',     'CD', 'FIH', NULL,     -4.3858,   15.4446),
    ('luanda quatro de fevereiro','Luanda Quatro de Fevereiro','Luanda',       'AO', 'LAD', NULL,     -8.8584,   13.2312),
    ('lagos murtala muhammed',    'Lagos Murtala Muhammed',    'Lagos',        'NG', 'LOS', NULL,      6.5774,    3.3212),
    ('accra kotoka',              'Accra Kotoka',              'Accra',        'GH', 'ACC', NULL,      5.6052,   -0.1668),
    ('abidjan felix houphouet boigny','Abidjan Félix-Houphouët-Boigny','Abidjan','CI','ABJ', NULL,     5.2614,   -3.9263),
    ('dakar blaise diagne',       'Dakar Blaise Diagne',       'Dakar',        'SN', 'DSS', NULL,     14.6700,  -17.0733),
    ('nairobi jomo kenyatta',     'Nairobi Jomo Kenyatta',     'Nairobi',      'KE', 'NBO', NULL,     -1.3192,   36.9278),
    ('addis ababa bole',          'Addis Ababa Bole',          'Addis Ababa',  'ET', 'ADD', NULL,      8.9779,   38.7993),
    ('johannesburg or tambo',     'Johannesburg OR Tambo',     'Johannesburg', 'ZA', 'JNB', NULL,    -26.1367,   28.2411),
    ('cairo airport',             'Cairo Airport',             'Cairo',        'EG', 'CAI', NULL,     30.1219,   31.4056),
    ('casablanca mohammed v',     'Casablanca Mohammed V',     'Casablanca',   'MA', 'CMN', NULL,     33.3675,   -7.5900),

  -- ── Europe ──────────────────────────────────────────────────────────────
    ('paris cdg',                 'Paris CDG',                 'Paris',        'FR', 'CDG', 'FRCDG',  49.0097,    2.5479),
    ('london heathrow',           'London Heathrow',           'London',       'GB', 'LHR', 'GBLHR',  51.4700,   -0.4543),
    ('amsterdam schiphol',        'Amsterdam Schiphol',        'Amsterdam',    'NL', 'AMS', NULL,     52.3105,    4.7683),
    ('frankfurt airport',         'Frankfurt Airport',         'Frankfurt',    'DE', 'FRA', NULL,     50.0379,    8.5622),
    ('leipzig halle',             'Leipzig Halle',             'Leipzig',      'DE', 'LEJ', NULL,     51.4239,   12.2364),
    ('liege airport',             'Liège Airport',             'Liège',        'BE', 'LGG', NULL,     50.6374,    5.4432),
    ('brussels airport',          'Brussels Airport',          'Brussels',     'BE', 'BRU', NULL,     50.9014,    4.4844),
    ('luxembourg findel',         'Luxembourg Findel',         'Luxembourg',   'LU', 'LUX', NULL,     49.6233,    6.2044),
    ('madrid barajas',            'Madrid Barajas',            'Madrid',       'ES', 'MAD', NULL,     40.4719,   -3.5626),
    ('milan malpensa',            'Milan Malpensa',            'Milan',        'IT', 'MXP', NULL,     45.6306,    8.7281),
    ('istanbul airport',          'Istanbul Airport',          'Istanbul',     'TR', 'IST', NULL,     41.2753,   28.7519),

  -- ── The Gulf and Asia ───────────────────────────────────────────────────
    ('dubai airport',             'Dubai Airport',             'Dubai',        'AE', 'DXB', NULL,     25.2532,   55.3657),
    ('dubai world central',       'Dubai World Central',       'Dubai',        'AE', 'DWC', NULL,     24.8964,   55.1614),
    ('doha hamad airport',        'Doha Hamad Airport',        'Doha',         'QA', 'DOH', NULL,     25.2731,   51.6081),
    ('hong kong airport',         'Hong Kong Airport',         'Hong Kong',    'HK', 'HKG', NULL,     22.3080,  113.9185),
    ('shanghai pudong',           'Shanghai Pudong',           'Shanghai',     'CN', 'PVG', 'CNPVG',  31.1443,  121.8083),
    ('guangzhou baiyun',          'Guangzhou Baiyun',          'Guangzhou',    'CN', 'CAN', NULL,     23.3924,  113.2988),
    ('shenzhen baoan',            'Shenzhen Bao''an',          'Shenzhen',     'CN', 'SZX', NULL,     22.6393,  113.8108),
    ('incheon airport',           'Incheon Airport',           'Seoul',        'KR', 'ICN', NULL,     37.4602,  126.4407),
    ('tokyo narita',              'Tokyo Narita',              'Tokyo',        'JP', 'NRT', NULL,     35.7647,  140.3864),
    ('taipei taoyuan',            'Taipei Taoyuan',            'Taipei',       'TW', 'TPE', NULL,     25.0777,  121.2328),
    ('singapore changi',          'Singapore Changi',          'Singapore',    'SG', 'SIN', NULL,      1.3644,  103.9915),
    ('bangkok suvarnabhumi',      'Bangkok Suvarnabhumi',      'Bangkok',      'TH', 'BKK', NULL,     13.6900,  100.7501),
    ('mumbai chhatrapati shivaji','Mumbai Chhatrapati Shivaji','Mumbai',       'IN', 'BOM', NULL,     19.0887,   72.8679),
    ('delhi indira gandhi',       'Delhi Indira Gandhi',       'Delhi',        'IN', 'DEL', NULL,     28.5562,   77.1000),

  -- ── The Americas ────────────────────────────────────────────────────────
    ('new york jfk',              'New York JFK',              'New York',     'US', 'JFK', 'USJFK',  40.6413,  -73.7781),
    ('chicago ohare',             'Chicago O''Hare',           'Chicago',      'US', 'ORD', 'USORD',  41.9742,  -87.9073),
    ('memphis airport',           'Memphis Airport',           'Memphis',      'US', 'MEM', 'USMEM',  35.0424,  -89.9767),
    ('anchorage airport',         'Anchorage Airport',         'Anchorage',    'US', 'ANC', 'USANC',  61.1743, -149.9962),
    ('los angeles airport',       'Los Angeles Airport',       'Los Angeles',  'US', 'LAX', NULL,     33.9416, -118.4085),
    ('miami airport',             'Miami Airport',             'Miami',        'US', 'MIA', NULL,     25.7959,  -80.2870),
    ('atlanta hartsfield jackson','Atlanta Hartsfield-Jackson','Atlanta',      'US', 'ATL', NULL,     33.6407,  -84.4277),
    ('mexico city airport',       'Mexico City Airport',       'Mexico City',  'MX', 'MEX', NULL,     19.4363,  -99.0721),
    ('sao paulo guarulhos',       'São Paulo Guarulhos',       'São Paulo',    'BR', 'GRU', NULL,    -23.4356,  -46.4731)
) AS a(query_key, name, city, country, iata, unlocode, latitude, longitude)
-- GAP FILL, not overwrite — and the WHERE clause is what makes that true.
--
-- 0478 already seeded 'paris cdg' with no code and no formatted address, so a
-- plain DO NOTHING would leave the one airport this product uses most as the
-- only airport nobody can find by typing CDG. DO UPDATE fixes that, but it is
-- constrained three ways: only SEED/CATALOGUE rows (a MANUAL correction or a
-- cached GEOAPIFY answer is never touched), only columns that are still NULL,
-- and never a coordinate, a name or a kind. The WHERE also makes the second run
-- a no-op, which is what keeps this file idempotent.
ON CONFLICT (query_key) DO UPDATE
   SET unlocode  = COALESCE(geo_place.unlocode, EXCLUDED.unlocode),
       formatted = COALESCE(geo_place.formatted, EXCLUDED.formatted)
 WHERE geo_place.source IN ('SEED', 'CATALOGUE')
   AND (geo_place.unlocode IS NULL OR geo_place.formatted IS NULL);

-- DOWN
-- Removes only rows this file inserted and that nothing points at. A catalogue
-- place already referenced by a dossier or an itinerary leg is data now, not
-- reference data, and deleting it would break the file that uses it.
-- DELETE FROM geo_place g WHERE g.source = 'CATALOGUE'
--   AND NOT EXISTS (SELECT 1 FROM dossier d WHERE d.pol_place_id = g.geo_place_id OR d.pod_place_id = g.geo_place_id)
--   AND NOT EXISTS (SELECT 1 FROM dossier_itinerary_leg l WHERE l.origin_place_id = g.geo_place_id OR l.destination_place_id = g.geo_place_id);
