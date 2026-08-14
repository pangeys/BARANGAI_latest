/* ═══════════════════════════════════════════════════════
   BICTS — js/data.js
   All static configuration & experiment result data.
   Edit this file to update model numbers, categories,
   AHP weights, or NLP pipeline steps.

   ── Current dataset/model ──
   6 KP categories (RA 7160), 3,669 final modeling records
   Final SVM: LinearSVC + Word(1,3) and char_wb(3,6) TF-IDF
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
  Critical: 70,
  High:     42,
  Medium:   21,
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

/* ── Final Chapter 4 experiment results ──
   Evaluation source of truth: locked 741-record test set after the
   group-aware duplicate audit (0 identical texts crossing train/test).
   The browser model export is used for inference; these constants are
   the final evaluation results reported in Chapter 4. ── */
const FINAL_MODEL_INFO = {
  active_model: 'Support Vector Machine (LinearSVC)',
  dataset_size: 3669,
  training_size: 2928,
  testing_size: 741,
  categories: 6,
  accuracy: 83.81,
  precision: 84.05,
  recall: 83.81,
  f1: 83.77,
  feature_configuration: 'W13_C36_1.0_1.0',
  feature_extraction: 'Word TF-IDF (1,3) + char_wb TF-IDF (3,6)',
  best_parameter: 'C = 0.5',
  class_weight: 'balanced',
  split: '80/20 group-aware stratified split',
  duplicate_overlap: 0,
};

/* Bars use weighted F1 so all three models are compared on the
   study's stated model-selection metric. */
const MODEL_ACCURACY_BARS = [
  { label: 'SVM (weighted F1 — selected)', value: 83.77 },
  { label: 'Naive Bayes (weighted F1)',    value: 75.16 },
  { label: 'Bi-LSTM (weighted F1)',        value: 71.22 },
];

const DATASET_VERSIONS = [
  { ver: '25%  (732 train)',  train: 732,  nb: 69.63, svm: 73.16, bi: 46.31, best: false },
  { ver: '50%  (1464 train)', train: 1464, nb: 71.76, svm: 78.54, bi: 64.22, best: false },
  { ver: '75%  (2196 train)', train: 2196, nb: 73.53, svm: 81.06, bi: 63.34, best: false },
  { ver: '100% (2928 train)', train: 2928, nb: 75.16, svm: 83.77, bi: 71.22, best: true  },
];

const MODEL_COMPARISON_V2 = [
  { metric: 'Accuracy',   nb: '75.17%', svm: '83.81%', bi: '70.99%' },
  { metric: 'Precision',  nb: '75.33%', svm: '84.05%', bi: '72.29%' },
  { metric: 'Recall',     nb: '75.17%', svm: '83.81%', bi: '70.99%' },
  { metric: 'F1-Score',   nb: '75.16%', svm: '83.77%', bi: '71.22%' },
  { metric: 'Train Time', nb: '0.6199s', svm: '0.5135s', bi: '18.9820s' },
  { metric: 'Infer Time', nb: '0.001004s', svm: '0.004017s', bi: '0.634181s' },
];

const PER_CATEGORY_REPORT = [
  { cat: 'Neighbor Disputes',       prec: '0.8319', rec: '0.8462', f1: '0.8390', sup: 117 },
  { cat: 'Money/Debt Disputes',     prec: '0.8714', rec: '0.8777', f1: '0.8746', sup: 139 },
  { cat: 'Family Matters',          prec: '0.8615', rec: '0.7778', f1: '0.8175', sup: 144 },
  { cat: 'Petty Criminal Offenses', prec: '0.7926', rec: '0.8629', f1: '0.8263', sup: 124 },
  { cat: 'Property Disputes',       prec: '0.8707', rec: '0.7829', f1: '0.8245', sup: 129 },
  { cat: 'Contract Disputes',       prec: '0.7921', rec: '0.9091', f1: '0.8466', sup: 88  },
];

/* Final modeling distribution after invalid/malformed records and the
   duplicate-aware preparation used for the final experiment. */
const DATASET_CONSOLIDATION = [
  { merged: 'Family Matters',          original: 'Family Matters',          min: 0, total: 680 },
  { merged: 'Petty Criminal Offenses', original: 'Petty Criminal Offenses', min: 0, total: 663 },
  { merged: 'Money/Debt Disputes',     original: 'Money/Debt Disputes',     min: 0, total: 648 },
  { merged: 'Property Disputes',       original: 'Property Disputes',       min: 0, total: 639 },
  { merged: 'Neighbor Disputes',       original: 'Neighbor Disputes',       min: 0, total: 569 },
  { merged: 'Contract Disputes',       original: 'Contract Disputes',       min: 0, total: 470 },
];

const NLP_PIPELINE_STEPS = [
  'Raw complaint text (Filipino / English / Taglish)',
  'Unicode NFKC normalization + lowercase',
  'Word TF-IDF n-grams (1,3)',
  'Character char_wb TF-IDF n-grams (3,6)',
  'FeatureUnion (73,078 exported features)',
  'LinearSVC (C=0.5, class_weight=balanced)',
  'Predicted KP category',
  'Fuzzy AHP scoring → priority tier',
];

/* No synthetic augmentation was used in the final modeling dataset. */
const AUG_TECHNIQUES = [];

/* ── Report types ── */
const REPORT_TYPES = [
  { icon: '📊', title: 'Classification Accuracy Report', desc: 'Model performance metrics per category'  },
  { icon: '📈', title: 'Complaint Volume Report',        desc: 'Complaints filed over time by category'  },
  { icon: '⚡', title: 'Priority Distribution Report',   desc: 'Breakdown of complaint priority tiers'   },
  { icon: '📋', title: 'Resolution Time Report',         desc: 'Average time to resolve per category'    },
];

/* ── Status flow ── */
const STATUS_FLOW = ['Open', 'In Progress', 'For Hearing', 'Resolved'];

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
  { name: 'Automatic classification (final SVM)', desc: 'Classify submissions with the final Word + Character TF-IDF SVM', on: true },
  { name: 'Allow anonymous complaint filing', desc: 'Residents may submit without providing a complainant name', on: true },
];