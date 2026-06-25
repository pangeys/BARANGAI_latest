/* ═══════════════════════════════════════════════════════
   BICTS — js/data.js
   All static configuration & experiment result data.
   Edit this file to update model numbers, categories,
   AHP weights, or NLP pipeline steps.

   ── Current dataset/model ──
   6 KP categories (RA 7160), 2,152 real complaint records
   SVM trained via Colab, exported as svm_model.json
   Fuzzy AHP weights derived via Colab, exported as fuzzy_ahp_config.json
═══════════════════════════════════════════════════════ */

/* ── 6 KP complaint categories (RA 7160 Katarungang Pambarangay) ──
   Order MUST match `classes` array in data/svm_model.json exactly,
   since the classifier uses array index to map SVM output back
   to a category name. ── */
const CATEGORIES = [
  'Contract Disputes',
  'Family Matters',
  'Money/Debt Disputes',
  'Neighbor Disputes',
  'Petty Criminal Offenses',
  'Property Disputes',
];

/* ── Category colours (donut chart + kanban borders) ── */
const CAT_COLORS = {
  'Contract Disputes':       '#6B3FA0',
  'Family Matters':          '#C2548A',
  'Money/Debt Disputes':     '#B06000',
  'Neighbor Disputes':       '#4CA3DD',
  'Petty Criminal Offenses': '#A02020',
  'Property Disputes':       '#1E5FA8',
};

/* ── Fuzzy AHP configuration ──
   Loaded at runtime from data/fuzzy_ahp_config.json (see
   initFuzzyAHP() in classifier.js). The values below are
   fallback defaults only, used if that file fails to load.
   NOTE: No category-based or keyword-based override floors
   are applied — the priority score comes purely from the
   Fuzzy AHP formula. ── */
const AHP_WEIGHTS = {
  severity:             0.46581939799331107,
  urgency:              0.2771404682274248,
  frequency:            0.09596989966555185,
  affected_individuals: 0.16107023411371235,
};

const SEVERITY_TFN = {
  Low:    [1, 2, 3],
  Medium: [4, 5, 6],
  High:   [7, 8, 9],
};

const URGENCY_TFN = {
  Low:       [1, 2, 3],
  Medium:    [4, 5, 6],
  High:      [7, 8, 9],
  Immediate: [9, 10, 10],
};

const FREQUENCY_TFN = {
  'First-time': [1, 2, 3],
  'Recurring':  [6, 7, 8],
};

const AFFECTED_TFN = {
  '1':    [1, 2, 3],
  '2-5':  [3, 4, 5],
  '6-14': [5, 6, 7],
  '15+':  [7, 9, 10],
};

const PRIORITY_TIER_CUTOFFS = {
  Critical: 75,
  High:     50,
  Medium:   25,
  Low:      0,
};

const HISTORICAL_CROSSREF_BOOST = 5;

/* ── Keyword rules — fallback only if svm_model.json fails to load ── */
const CLASSIFY_RULES = [
  {
    cat: 'Petty Criminal Offenses', conf: 90,
    words: [
      'suntok','sinuntok','gulpi','panggugulpi','binugbog','pambubugbog',
      'sinaktan','pananakit','sinampal','sinakal','pagsakal','kutsilyo',
      'itak','sundang','tinaga','sinaksak','binatok','pinalo','sinipa',
      'sugatan','nasugatan','assault','violence','stabbed','weapon','baril',
      'hinipuan','panggagahasa','rape','nakaw','ninakaw','pagnanakaw',
      'nanakawan','theft','stolen','robbery','snatch','banta','pagbabanta',
      'pananakot','papatayin','babarilin','pinagbantaan','nanakot','threat',
      'droga','shabu','marijuana','lasing','nakainom','estafa','scam',
      'pandaraya','fraud','sinunog','sunog','nagsunog',
    ],
  },
  {
    cat: 'Money/Debt Disputes', conf: 87,
    words: [
      'utang','pagkakautang','pagbabayad','babayaran','pautang','loan',
      'sangla','isinanla','sinangla','hiniram','nanghihiram','debt',
      'payment','sweldo','resibo','hindi nagbabayad','hindi bumabayad',
      'singil','koleksyon','hulog','installment','lending','interest',
      'tubo','refund','kabayaran','ibalik ang pera',
    ],
  },
  {
    cat: 'Property Disputes', conf: 85,
    words: [
      'lupa','lupain','titulo','hangganan','boundary','pasukat',
      'pagmamay-ari','right of way','lot','land','bakod','fence',
      'pader','deed of sale','minana','pamana','inheritance','upa',
      'renta','nangungupahan','nagpapaupa','ejectment','pinalayas',
      'demolisyon','konstruksyon','palayan','taniman',
    ],
  },
  {
    cat: 'Neighbor Disputes', conf: 83,
    words: [
      'kapitbahay','pag-aaway','nag-away','alitan','pagtatalo',
      'iskandalo','kaguluhan','ingay','panggugulo','neighbor','noise',
      'tsismis','maling balita','pagmumura','insulto','pananakot',
      'paninirang puri','social media','chat','mensahe','nagbabanta',
      'tinatakot','ininsulto','nilait',
    ],
  },
  {
    cat: 'Family Matters', conf: 80,
    words: [
      'mag-asawa','asawa','mag-ina','mag-ama','kapatid','paghihiwalay',
      'sustento','domestic','magulang','family','anak','kabit','kerida',
      'diborsyo','hiwalay','alimentasyon','child support','custody',
      'ibang babae','ibang lalaki','abandonment','pag-abandona',
    ],
  },
  {
    cat: 'Contract Disputes', conf: 78,
    words: [
      'kasunduan','kontrata','contract','napagkasunduan','agreement',
      'hindi tumupad','hindi natupad','serbisyo','trabaho','gawain',
      'proyekto','sweldo','sahod','bayad sa trabaho','hindi natapos',
      'hindi nagawa','hindi naghatid','pinirmahan','nilagdaan','kasulatan',
      'vendor','supplier','warranty','garantiya','bayad sa serbisyo',
    ],
  },
];

/* ── Experiment results (from SVM Colab notebook) ── */
const MODEL_ACCURACY_BARS = [
  { label: 'SVM (100% — best)', value: 81.67 },
  { label: 'NB (100%)',         value: 78.65 },
  { label: 'BiLSTM (100%)',     value: 69.84 },
];

const DATASET_VERSIONS = [
  { ver: '25%  (431 train)',  train: 431,  nb: 71.88, svm: 74.24, bi: 58.69, best: false },
  { ver: '50%  (861 train)',  train: 861,  nb: 75.75, svm: 77.37, bi: 56.55, best: false },
  { ver: '75%  (1291 train)', train: 1291, nb: 77.74, svm: 79.64, bi: 65.51, best: false },
  { ver: '100% (1721 train)', train: 1721, nb: 78.46, svm: 81.50, bi: 70.05, best: true  },
];

const MODEL_COMPARISON_V2 = [
  { metric: 'Accuracy',   nb: '78.65%', svm: '81.67%', bi: '69.84%' },
  { metric: 'Precision',  nb: '80.62%', svm: '81.67%', bi: '71.86%' },
  { metric: 'Recall',     nb: '78.65%', svm: '81.67%', bi: '69.84%' },
  { metric: 'F1-Score',   nb: '78.46%', svm: '81.50%', bi: '70.05%' },
  { metric: 'Train Time', nb: '0.15s',  svm: '1.39s',  bi: '160.58s' },
  { metric: 'Infer Time', nb: '0.0006s',svm: '0.0005s',bi: '2.93s'  },
];

const PER_CATEGORY_REPORT = [
  { cat: 'Contract Disputes',       prec: '0.7869', rec: '0.8421', f1: '0.8136', sup: 57 },
  { cat: 'Family Matters',          prec: '0.8103', rec: '0.7833', f1: '0.7966', sup: 60 },
  { cat: 'Money/Debt Disputes',     prec: '0.8229', rec: '0.8681', f1: '0.8449', sup: 91 },
  { cat: 'Neighbor Disputes',       prec: '0.8485', rec: '0.7467', f1: '0.7943', sup: 75 },
  { cat: 'Petty Criminal Offenses', prec: '0.7800', rec: '0.6842', f1: '0.7290', sup: 57 },
  { cat: 'Property Disputes',       prec: '0.8300', rec: '0.9121', f1: '0.8691', sup: 91 },
];

const DATASET_CONSOLIDATION = [
  { merged: 'Contract Disputes',       original: 'Contract/Agreement Disputes',            min: 0, total: 284 },
  { merged: 'Family Matters',          original: 'Family/Domestic Disputes',               min: 0, total: 298 },
  { merged: 'Money/Debt Disputes',     original: 'Money/Debt/Financial Disputes',          min: 0, total: 453 },
  { merged: 'Neighbor Disputes',       original: 'Neighbor/Community Disputes',            min: 0, total: 377 },
  { merged: 'Petty Criminal Offenses', original: 'Petty Criminal Offenses (RA 7160 §408)', min: 0, total: 286 },
  { merged: 'Property Disputes',       original: 'Property/Land Disputes',                 min: 0, total: 454 },
];

/* ── NLP preprocessing pipeline steps ── */
const NLP_PIPELINE_STEPS = [
  'Raw free-text complaint (Filipino/Taglish)',
  'Lowercase + regex clean',
  'Stop-word removal (Filipino + English)',
  'Token filter (length > 1)',
  'TF-IDF (1,2)-gram vectorization',
  'LinearSVC classification → category',
  'Fuzzy AHP scoring → priority tier',
];

/* ── Report types ── */
const REPORT_TYPES = [
  { icon: '📊', title: 'Classification Accuracy Report', desc: 'Model performance metrics per category'  },
  { icon: '📈', title: 'Complaint Volume Report',        desc: 'Complaints filed over time by category'  },
  { icon: '⚡', title: 'Priority Distribution Report',   desc: 'Breakdown of complaint priority tiers'   },
  { icon: '📋', title: 'Resolution Time Report',         desc: 'Average time to resolve per category'    },
];

/* ── Status flow ── */
const STATUS_FLOW = ['Open', 'In Progress', 'For Hearing', 'Resolved'];

/* ── Augmentation techniques (documentation only) ── */
const AUG_TECHNIQUES = [
  'Random word deletion (12% probability on non-protected words)',
  'Random word swap (1 pair per record)',
  'Random word insertion (1 content word per record)',
];

/* ── Report items ── */
const REPORT_ITEMS = [
  { icon: '📊', title: 'Classification Accuracy Report', desc: 'Model performance metrics per category'   },
  { icon: '📈', title: 'Complaint Volume Report',        desc: 'Complaints filed over time by category'  },
  { icon: '⏱️', title: 'Response Time Report',           desc: 'Avg handling and resolution times'       },
  { icon: '📋', title: 'Case Outcome Report',            desc: 'Breakdown of resolutions and escalations'},
];

/* ── Settings fields ── */
const SETTINGS_FIELDS = [
  { label: 'System Name',   value: 'BarangAI - Barangay Intelligent Case Tracking System' },
  { label: 'Barangay Name', value: '' },
  { label: 'Municipality',  value: '' },
  { label: 'Admin Email',   value: '' },
];

/* ── Settings toggles ── */
const SETTINGS_TOGGLES = [
  { name: 'Auto-classify on submission (SVM)',  desc: 'Use SVM (TF-IDF bigrams) to auto-classify when submitted',   on: true  },
  { name: 'Allow anonymous complaint filing',   desc: 'Residents can submit without personal information',           on: true  },
  { name: 'Confidence threshold flag (<70%)',   desc: 'Flag complaints below 70% confidence for manual review',      on: true  },
  { name: 'Human-in-the-loop validation',       desc: 'Officers must validate AI classification before finalizing',  on: false },
  { name: 'BiLSTM fallback classification',     desc: 'Use BiLSTM if SVM confidence is below threshold',            on: false },
];
