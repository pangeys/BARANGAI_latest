/* ═══════════════════════════════════════════════════════
   BICTS — js/classifier.js
   Real SVM classifier using exported TF-IDF + LinearSVC
   weights from the Python notebook (6-category SVM, RA 7160 KP).

   Model file: data/svm_model.json
   Contains:
     classes    — 6 KP category names in label-encoder order
     vocabulary — word/bigram → feature index (10,000 features)
     idf        — IDF weights per feature
     coef       — SVM decision weights [13 × 10000]
     intercept  — SVM intercepts [13]

   Pipeline mirrors the Python preprocessing exactly:
     lowercase → strip punctuation → remove stop words
     → min length >1 → TF-IDF (1,2)-gram → LinearSVC

   Fuzzy AHP config file: data/fuzzy_ahp_config.json
   Contains: criteria_weights, severity_tfn, urgency_tfn,
     frequency_tfn, affected_tfn, priority_tier_cutoffs,
     historical_crossref_boost, consistency_ratio.
   Falls back to the matching constants in data.js if this
   file fails to load.
═══════════════════════════════════════════════════════ */

/* ── Model state ── */
let _model    = null;   /* loaded from svm_model.json */
let _modelErr = false;  /* true if load failed */
let _ahp      = null;   /* loaded from fuzzy_ahp_config.json */

/* ── Load model on boot ── */
function initClassifier() {
  return fetch('data/svm_model.json')
    .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
    .then(data => {
      _model = data;
      console.log('BARANGAI: SVM model loaded —', data.classes.length, 'KP categories (RA 7160)');
    })
    .catch(err => {
      _modelErr = true;
      console.warn('BICTS: Could not load svm_model.json, using keyword fallback.', err);
    });
}

/* ── Load Fuzzy AHP config on boot ── */
function initFuzzyAHP() {
  return fetch('data/fuzzy_ahp_config.json')
    .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
    .then(data => {
      _ahp = data;
      console.log('BICTS: Fuzzy AHP config loaded — CR =', data.consistency_ratio.toFixed(4));
    })
    .catch(err => {
      console.warn('BICTS: Could not load fuzzy_ahp_config.json, using data.js defaults.', err);
      _ahp = {
        criteria_weights: AHP_WEIGHTS,
        severity_tfn: SEVERITY_TFN,
        urgency_tfn: URGENCY_TFN,
        frequency_tfn: FREQUENCY_TFN,
        affected_tfn: AFFECTED_TFN,
        priority_tier_cutoffs: PRIORITY_TIER_CUTOFFS,
        historical_crossref_boost: HISTORICAL_CROSSREF_BOOST,
      };
    });
}

/* ══════════════════════════════════════════════════════
   PREPROCESSING — must exactly match Python notebook:
   lowercase → remove non-alphanum → collapse spaces
   → remove stop words → remove tokens len ≤ 1
══════════════════════════════════════════════════════ */
const STOP_WORDS = new Set([
  'ang','ng','sa','na','at','ay','si','ni','mga','ito',
  'ko','mo','niya','kami','kayo','sila','ako','ikaw','siya',
  'namin','natin','nila','aming','inyong','kanilang',
  'the','a','an','is','was','are','were','in','on',
  'to','of','and','for','with','by','from','that','this',
  'it','he','she','they','we','you','i','be','been','have',
  'has','had','do','did','will','would','could','should',
  'may','might','can','not','no','so','but','or','if',
]);

function preprocess(text) {
  let t = String(text).toLowerCase();
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.split(' ')
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
    .join(' ');
}

/* ══════════════════════════════════════════════════════
   TF-IDF (1,2)-gram vectoriser
   Produces a sparse vector matching the trained vocab.
══════════════════════════════════════════════════════ */
function tfidfVectorize(text) {
  const vocab = _model.vocabulary;
  const idf   = _model.idf;
  const n     = idf.length;

  /* Count term frequencies for unigrams and bigrams */
  const tf = new Float64Array(n);
  const words = text.split(' ').filter(w => w.length > 0);

  for (let i = 0; i < words.length; i++) {
    /* unigram */
    const w1 = words[i];
    if (vocab[w1] !== undefined) tf[vocab[w1]]++;

    /* bigram */
    if (i + 1 < words.length) {
      const bg = w1 + ' ' + words[i + 1];
      if (vocab[bg] !== undefined) tf[vocab[bg]]++;
    }
  }

  /* Apply sublinear TF scaling: tf = 1 + log(tf) if tf > 0 */
  for (let i = 0; i < n; i++) {
    if (tf[i] > 0) tf[i] = 1 + Math.log(tf[i]);
  }

  /* Multiply by IDF */
  for (let i = 0; i < n; i++) {
    tf[i] *= idf[i];
  }

  /* L2 normalise */
  let norm = 0;
  for (let i = 0; i < n; i++) norm += tf[i] * tf[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < n; i++) tf[i] /= norm;

  return tf;
}

/* ══════════════════════════════════════════════════════
   LINEAR SVC DECISION
   decision[k] = coef[k] · vec + intercept[k]
   Predicted class = argmax(decision)
══════════════════════════════════════════════════════ */
function svmDecide(vec) {
  const coef      = _model.coef;
  const intercept = _model.intercept;
  const nClasses  = _model.classes.length;
  const nFeatures = vec.length;

  const scores = new Float64Array(nClasses);
  for (let k = 0; k < nClasses; k++) {
    let dot = intercept[k];
    const ck = coef[k];
    for (let i = 0; i < nFeatures; i++) {
      if (vec[i] !== 0) dot += ck[i] * vec[i];
    }
    scores[k] = dot;
  }
  return scores;
}

/* Convert raw SVM scores to pseudo-probabilities via softmax */
function softmax(scores) {
  const max = Math.max(...scores);
  const exp = Array.from(scores).map(s => Math.exp(s - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map(e => e / sum);
}

/* ══════════════════════════════════════════════════════
   PUBLIC: classifyDescription(text)
   Returns { cat, conf, scores }
     cat    — predicted category string
     conf   — confidence % (0–99)
     scores — { category: pct } for all 6 KP classes
══════════════════════════════════════════════════════ */
function classifyDescription(desc) {
  /* Fall back to keyword rules if model not loaded */
  if (!_model) return classifyKeywords(desc);

  const clean  = preprocess(desc);
  const vec    = tfidfVectorize(clean);
  const raw    = svmDecide(vec);
  const probs  = softmax(raw);

  /* Find best class */
  let bestIdx = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[bestIdx]) bestIdx = i;
  }

  const cat  = _model.classes[bestIdx];
  const conf = Math.min(Math.round(probs[bestIdx] * 100), 99);

  /* Build scores map for confidence bars */
  const scores = {};
  _model.classes.forEach((c, i) => {
    scores[c] = Math.round(probs[i] * 100);
  });

  return { cat, conf, scores };
}

/* ══════════════════════════════════════════════════════
   KEYWORD FALLBACK (used only if model fails to load)
   Rules kept in data.js as CLASSIFY_RULES
══════════════════════════════════════════════════════ */
function classifyKeywords(desc) {
  const lower    = desc.toLowerCase();
  let bestCat    = CATEGORIES[0];
  let bestConf   = 55;
  let bestHits   = 0;
  const rawHits  = {};

  for (const rule of CLASSIFY_RULES) {
    const hits = rule.words.filter(w => lower.includes(w)).length;
    rawHits[rule.cat] = hits;
    if (hits > bestHits) {
      bestHits = hits;
      bestCat  = rule.cat;
      bestConf = Math.min(rule.conf + Math.min(hits * 2, 6), 99);
    }
  }

  const total  = Object.values(rawHits).reduce((a, b) => a + b, 0) || 1;
  const scores = {};
  for (const cat of CATEGORIES) {
    scores[cat] = cat === bestCat
      ? bestConf
      : Math.max(Math.round((rawHits[cat] / total) * (bestConf - 10)), 3);
  }
  return { cat: bestCat, conf: bestConf, scores };
}

/* ══════════════════════════════════════════════════════
   KEYWORD EXTRACTION FOR FUZZY AHP CRITERIA
   Mirrors the Python regex rules used to build the
   training/labeling dataset and the Colab Fuzzy AHP
   notebook (Step 2: keyword extraction from raw text).
   Produces Severity / Urgency / Frequency / Affected
   directly from the complaint description — no
   category-based override floors are applied.
══════════════════════════════════════════════════════ */
/* ── Fuzzy Tagalog root matching ──
   Tagalog verbs inflect with prefixes (nag-, pag-, na-, susu-) AND
   infixes inserted INSIDE the root (e.g. sunog -> s-IN-unog), which
   plain substring matching ("text.includes('sunog')") cannot catch.
   This builds a regex per root that tolerates an optional -in-/-um-
   infix after the first consonant cluster, plus loose vowel matching
   for common o/u alternation (sunog vs sunug-in). ── */
const _rootRegexCache = {};
function rootMatches(text, root) {
  let entry = _rootRegexCache[root];
  if (!entry) {
    // Strategy 1: root with o/u vowel flexibility, matched anywhere in the
    // word — handles prefixes attached before the root with no internal
    // change (pa-, pang-, pana-, na-, ma-, etc.), e.g. "pananakot" contains
    // "akot" as a plain substring.
    const flexRoot = root.replace(/[ou]/gi, '[ou]');
    const flexRe = new RegExp(flexRoot, 'i');

    // Strategy 2: an -in-/-um- infix inserted after the leading consonant
    // cluster — handles cases where the infix splits the root's own first
    // syllable, e.g. "sunog" -> "si-N-unog", "taga" -> "t-IN-aga".
    const m = root.match(/^([^aeiou]*)(.*)$/i);
    let infixRe = null;
    if (m[1]) {
      const flexRest = m[2].replace(/[ou]/gi, '[ou]');
      infixRe = new RegExp(m[1] + '(?:in|um)' + flexRest, 'i');
    }
    entry = { flexRe, infixRe };
    _rootRegexCache[root] = entry;
  }
  return entry.flexRe.test(text) || (entry.infixRe && entry.infixRe.test(text));
}
function anyRootMatches(text, roots) {
  return roots.some(r => rootMatches(text, r));
}

/* ══════════════════════════════════════════════════════
   SEVERITY SCORING — hybrid exemplar-similarity approach
   (replaces simple substring/root keyword matching).

   Why: a pure keyword list either matches or doesn't — it can't
   weigh a complaint as a whole, and one severe word easily gets
   "diluted" inside a long sentence full of unrelated words. This
   approach mirrors the same idea behind the SVM classifier
   (text → weighted word-overlap → decision), scaled down to a
   lightweight, dependency-free technique suitable for running
   entirely in the browser:

     1. Each severity tier (Low/Medium/High) has a small set of
        REFERENCE EXEMPLAR phrases — short bags of words that
        typify that tier (e.g. High: "saksak sugat dumudugo").
     2. The complaint text is compared against every exemplar
        using Jaccard set-overlap (intersection / union of the
        two word sets) — same family of similarity metric as
        cosine similarity used in standard NLP/TF-IDF pipelines,
        simplified here to avoid needing a full TF-IDF engine in
        JS for what is fundamentally a short-text matching task.
     3. The tier whose best-matching exemplar has the highest
        overlap score wins.
     4. CRITICAL OVERRIDE: certain root words (weapons, fatality,
        sexual violence, kidnapping, poisoning, torture) are
        severe enough on their own that their mere presence
        forces High severity even if the rest of the sentence
        dilutes the overlap score with unrelated words (e.g. a
        long land-dispute complaint that ends in "babanta siyang
        susunugin ang bahay" should not score Low just because
        most of the sentence is about land).
══════════════════════════════════════════════════════ */
function cleanWords(text) {
  const STOP_LOCAL = new Set([
    'ang','ng','sa','na','at','ay','si','ni','mga','ito','ko','mo','niya',
    'kami','kayo','sila','ako','ikaw','siya','namin','natin','nila','aming',
    'inyong','kanilang','dahil','kapag','upang','para','noong',
  ]);
  const t = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return new Set(t.split(/\s+/).filter(w => w.length > 1 && !STOP_LOCAL.has(w)));
}

function jaccardOverlap(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

const SEVERITY_EXEMPLARS = {
  High: [
    "saksak sinaksak kutsilyo sugat dumudugo",
    "baril binaril namatay nasawi patay",
    "sunog sinunog susunog nasusunog apoy susunugin",
    "gahasa panggagahasa rape hinipuan",
    "bugbog binugbog walang malay naospital",
    "nilason lason biktima",
    "tortyur tinortyur pinahirapan",
    "dukot dinukot kidnap kinidnap",
    "kutsilyo baril sasaksakin babarilin tutok",
    "abuso sekswal lapastangan",
    /* PATCH v2: property encroachment — sinakop/naagaw ng lote warrants High
       severity even without a weapon, because it constitutes unlawful
       dispossession of real property which can escalate rapidly and cause
       irreversible harm to the complainant. */
    "sinakop naagaw agaw lote lupain pilit pumasok",
    /* PATCH v2: large financial loss — a complaint explicitly mentioning a
       very large sum (handled separately by extractAmountBucket, but
       adding an exemplar here improves Jaccard scoring for debt complaints
       that do NOT contain a peso sign but describe the amount in words). */
    "malaking utang libu-libo daan-libo hindi nagbabayad",
  ],
  Medium: [
    "suntok sinuntok sampal sinampal sakal sinakal",
    "nakaw ninakaw nagnakaw",
    "banta nagbanta takot pananakot babantaan",
    "sira sinira putol pinutulan",
    "aksidente bangga nabangga sagasa",
    "kagat kinagat aso",
    "sipa sinipa palo pinalo",
    "itak gulok dala",
    "pitsirol ambang sambang",
  ],
  Low: [
    "utang bayad pagkakautang nagbabayad",
    "alitan pagkakaunawaan tsismis",
    "ingay gabi kaguluhan",
    "nawala gamit cellphone wallet",
    "lupa hangganan pagkakasundo",
    "panirang puri social media",
    "dumating pulong",
    "basura amoy ihi tapon kalat",
    "residente komunidad reklamo",
  ],
};

/* Pre-tokenize exemplars once at load time (not per-call) for speed */
const _severityExemplarSets = {};
for (const label of Object.keys(SEVERITY_EXEMPLARS)) {
  _severityExemplarSets[label] = SEVERITY_EXEMPLARS[label].map(cleanWords);
}

/* If ANY of these root strings appear inside ANY word of the complaint,
   force High severity — these signal danger severe enough that no
   amount of surrounding "diluting" text should lower the score.

   PATCH v2 CHANGES:
   - Added threat/intimidation roots: 'banta', 'akot', 'takot', 'pananakot',
     'pagbabanta', 'intimidasyon' — a direct threat of harm is legally
     considered a grave offense under barangay jurisdiction and warrants
     the same priority escalation as actual physical violence.
   - Added physical contact roots that were previously only in CRITICAL_MEDIUM:
     'sampal', 'suntok', 'sinuntok', 'sinampal' — any physical assault,
     even without a weapon, should be treated as High severity so that
     the weighted AHP score can reach the High tier threshold.
   - Added property violence roots: 'sinakop', 'naagaw' — forcible
     dispossession of land/property.
*/
const CRITICAL_HIGH_ROOTS = [
  'saksak','baril','sunog','gahasa','rape','hipo','bugbog','lason',
  'tortyur','dukot','kidnap','kutsilyo','itak','sundang','gulok',
  'tutok','patay','namatay','sugat','dugo','patalim','balisong',
  'lubid','tinali','asido','sumabog','pagsabog','gumuho','pagguho',
  'nilapa','inabuso','lapastangan',
  /* PATCH v2 — threat / intimidation roots (High, not just Medium) */
  'banta','akot','takot','pananakot','pagbabanta','intimidasyon',
  /* PATCH v2 — physical contact without weapon (escalated from Medium) */
  'sampal','suntok','sinuntok','sinampal',
  /* PATCH v2 — forcible property dispossession */
  'sinakop','naagaw',
];

/* Self-harm / suicide language requires its own dedicated, highest-
   priority check (see hasSelfHarmSignal below) — these cases must
   never be silently absorbed into the generic "High severity" bucket,
   since the system response to a safety crisis like this should be
   treated as the most urgent class of complaint the platform can
   receive, not lumped in alongside property-crime severity. */
const SELF_HARM_ROOTS = [
  'pagpapakamatay','nagpakamatay','magpapakamatay','papatay sa sarili',
  'sasaktan ang sarili','sinaktan ang sarili','nasaktan ang sarili',
  'kamatayan sa sarili','pumatay sa sarili','wakasan ang buhay',
  'suicide','self-harm','cutting',
];
function hasSelfHarmSignal(text) {
  const lower = String(text).toLowerCase();
  return SELF_HARM_ROOTS.some(w => lower.includes(w));
}

/* ── MEDICAL / HEALTH EMERGENCY SIGNAL ──
   None of the violence-tier word lists above will ever fire for a
   medical crisis (no weapon, no assault, no fire) — so a complaint
   like "hindi gumagalaw ang anak ko, hirap huminga, kailangan ng
   ambulansya" was previously falling through to Low severity and
   often misclassified by the SVM into an unrelated category, since
   no training category exists for "medical emergency." This list
   independently forces at least High severity + Immediate urgency
   whenever clear medical-crisis language is present, regardless of
   what category the SVM ends up predicting for it. */
const MEDICAL_EMERGENCY_ROOTS = [
  'ambulansya','hindi humihinga','hirap huminga','lagnat','hindi gumagalaw',
  'walang malay','nawalan ng malay','nagdurugo','duguan','sumpong',
  'atake sa puso','stroke','nalunod','nalulunod','nahimatay','sumusuka ng dugo',
  'overdose','nilason','namamaga','hindi makahinga','hindi kumikibo',
];
function hasMedicalEmergencySignal(text) {
  const lower = String(text).toLowerCase();
  return MEDICAL_EMERGENCY_ROOTS.some(w => lower.includes(w));
}

/* ── CHILD / VULNERABLE-PERSON ABUSE ESCALATION ──
   Any physical-harm word (even a Medium-tier one like "pinalo") that
   co-occurs with a child/minor reference should escalate to High —
   violence against a child is inherently more severe than the same
   act against an adult, and barangay protocol treats child welfare
   cases as priority regardless of the specific act described. */
const CHILD_CONTEXT_WORDS = [
  'bata','anak','menor de edad','minor','batang','mga bata',
];
const PHYSICAL_HARM_ROOTS_ANY_TIER = [
  'palo','suntok','sampal','sakal','bugbog','gulpi','sipa','saksak',
  'kagat','abuso','lapastangan',
];
function hasChildAbuseSignal(text) {
  const lower = String(text).toLowerCase();
  const hasChildContext = CHILD_CONTEXT_WORDS.some(w => lower.includes(w));
  if (!hasChildContext) return false;
  return anyRootMatches(lower, PHYSICAL_HARM_ROOTS_ANY_TIER);
}

/* Same idea, one tier down: presence of these forces AT LEAST Medium,
   so a long sentence (lots of names, locations, procedural wording)
   doesn't dilute a real Medium-severity signal down to Low via the
   Jaccard exemplar scoring below. Only upgrades Low → Medium; never
   downgrades an exemplar match that already scored High or Medium. */
const CRITICAL_MEDIUM_ROOTS = [
  'suntok','nakaw','banta','sira','aksidente','kagat','sipa',
  'sampal','sakal','sakit','gulpi','palo','pitsirol','akot','basag',
  'batuta','binato','pagbato','lubog',
  /* "baha" (flood) needs a word-boundary-safe explicit form instead of
     the bare root, since the loose root matcher's substring search
     also matches it inside unrelated words like "kapitBAHAyan" or
     "kapitBAHAy" */
  'bumaha','bumabaha','pagbaha','baha ng',
  /* explicit literal forms — the "sakit" root regex above doesn't
     reliably catch these because the -IN- infix lands after a
     reduplicated/lengthened syllable ("sa-SA-ktan"), which the
     single-infix-position root matcher isn't built to handle */
  'sinasaktan','sasaktan','nasaktan','saktan',
];

function hasCriticalHighSignal(words, fullTextLower) {
  /* Use the regex-based root matcher (handles Tagalog infixes/prefixes
     like "susunugin", "sinaksak", "kinidnap") against the full text,
     not just exact tokenized words — this is more robust than a plain
     substring check on individual tokens. */
  return anyRootMatches(fullTextLower, CRITICAL_HIGH_ROOTS);
}

function extractSeverity(text) {
  const lower = String(text).toLowerCase();
  const words = cleanWords(text);
  if (words.size === 0) return 'Low';

  if (hasSelfHarmSignal(lower)) return 'High';
  if (hasMedicalEmergencySignal(lower)) return 'High';
  if (hasChildAbuseSignal(lower)) return 'High';
  if (hasCriticalHighSignal(words, lower)) return 'High';

  let bestLabel = 'Low';
  let bestScore = 0;
  for (const label of Object.keys(_severityExemplarSets)) {
    for (const exemplarSet of _severityExemplarSets[label]) {
      const score = jaccardOverlap(words, exemplarSet);
      if (score > bestScore) {
        bestScore = score;
        bestLabel = label;
      }
    }
  }

  /* If nothing matched any exemplar at all (bestScore still 0), fall
     back to a peso-amount check before defaulting to Low — a complaint
     about a very large sum of money still warrants elevated severity
     even with no violence-related vocabulary. */
  if (bestScore === 0) {
    const amt = extractAmountBucket(text.toLowerCase());
    if (amt) return amt;
    bestLabel = 'Low';
  }

  /* Medium-tier critical override: a long sentence can dilute the
     Jaccard overlap score for a genuine Medium-severity signal (e.g.
     "nagbanta", "ninakaw") below any exemplar's overlap. If the best
     exemplar match still landed on Low, but a Medium-signal root word
     is literally present, upgrade to Medium rather than under-scoring. */
  if (bestLabel === 'Low' && anyRootMatches(lower, CRITICAL_MEDIUM_ROOTS)) {
    return 'Medium';
  }
  return bestLabel;
}

/* ══════════════════════════════════════════════════════
   URGENCY SCORING
   Severity still drives the base tier (High severity → at least
   High urgency), but immediacy language can push a High-severity
   complaint up to "Immediate" — or flag urgency for non-violent
   but time-critical situations (e.g. an ongoing hazard).
══════════════════════════════════════════════════════ */
const IMMEDIATE_WORDS = [
  'kasalukuyan','kagabi','ngayong araw','kanina','emergency','agad',
  'patuloy','tumatakbo','ngayon','habang',
];
const RECURRING_WORDS = [
  'paulit-ulit','madalas','palagi','lagi','ilang beses','maraming beses',
  'nauulit','muli','ikalawang','pangalawang','ikatlong','pangatlong',
  'ikatlo','second time','na naman','muling',
];
const CROSSREF_PATTERN = /kaugnay sa (entry|case|kaso)/i;

function extractAmountBucket(text) {
  const matches = [
    ...text.matchAll(/(?:₱|p)\s?([\d,]{3,})(?:\.\d+)?/gi),
    ...text.matchAll(/([\d,]{4,})\s*(?:pesos?|piso)/gi),
  ];
  let top = 0;
  for (const m of matches) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (!isNaN(n) && n >= 10 && n <= 5000000 && n > top) top = n;
  }
  if (top === 0) return null;
  if (top >= 100000) return 'High';
  if (top >= 15000) return 'Medium';
  return 'Low';
}

function extractUrgency(text, severity) {
  const d = text.toLowerCase();
  if (hasSelfHarmSignal(d)) return 'Immediate';
  if (hasMedicalEmergencySignal(d)) return 'Immediate';
  const immediate = IMMEDIATE_WORDS.some(w => d.includes(w));
  if (severity === 'High' && immediate) return 'Immediate';
  if (severity === 'High') return 'High';
  if (severity === 'Medium') return 'Medium';
  return 'Low';
}

function extractFrequency(text) {
  const d = text.toLowerCase();
  return RECURRING_WORDS.some(w => d.includes(w)) ? 'Recurring' : 'First-time';
}

/* Keyword-based signals for scope of impact, used when the complaint
   text implies more people are affected than the manually-entered
   number (e.g. resident leaves the field at its default "1" but
   writes "maraming residente" / "buong komunidad" in the description). */
const COMMUNITY_WIDE_WORDS = [
  'maraming residente','mga residente','buong komunidad','buong barangay',
  'buong purok','kapitbahayan','mga kapitbahay','mga estudyante',
  'buong pamilya','mga magulang','mga bata sa',
];
const SMALL_GROUP_WORDS = [
  'mag-asawa','magkapatid','mag-ina','mag-ama','kasama niya','kasamang',
];

function extractAffectedFromText(text) {
  const d = (text || '').toLowerCase();
  if (COMMUNITY_WIDE_WORDS.some(w => d.includes(w))) return 15;
  /* explicit numeric mention, e.g. "5 katao", "10 residente" */
  const m = d.match(/(\d+)\s*(na\s*)?(tao|bata|residente|pamilya|estudyante|magkapatid|katao)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 0 && n < 1000) return n;
  }
  if (SMALL_GROUP_WORDS.some(w => d.includes(w))) return 2;
  return 1;
}

function extractAffectedBucket(manualCount, description) {
  const manual    = Math.max(parseInt(manualCount, 10) || 1, 1);
  const fromText  = extractAffectedFromText(description);
  /* Use whichever signal indicates a larger scope of impact — the
     resident's manual entry is trusted, but the description can
     reveal a wider impact the form field didn't capture. */
  const n = Math.max(manual, fromText);
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 14) return '6-14';
  return '15+';
}

/* Defuzzify a triangular fuzzy number (a,b,c) via centroid method */
function defuzzify(tfn) {
  return (tfn[0] + tfn[1] + tfn[2]) / 3;
}

/* ══════════════════════════════════════════════════════
   FUZZY AHP PRIORITY SCORING — pure formula, no overrides.
   Mirrors the Colab Fuzzy AHP notebook exactly:
     1. Extract Severity/Urgency/Frequency/Affected from text
     2. Convert each to a triangular fuzzy number (TFN)
     3. Defuzzify to a crisp 0-10 score (centroid method)
     4. Weighted sum using AHP criteria weights
     5. Normalize to 0-100, apply historical cross-ref boost
     6. Map to tier using priority_tier_cutoffs
══════════════════════════════════════════════════════ */
function computeAHPScore(category, affected, description) {
  const cfg = _ahp || {
    criteria_weights: AHP_WEIGHTS,
    severity_tfn: SEVERITY_TFN,
    urgency_tfn: URGENCY_TFN,
    frequency_tfn: FREQUENCY_TFN,
    affected_tfn: AFFECTED_TFN,
    priority_tier_cutoffs: PRIORITY_TIER_CUTOFFS,
    historical_crossref_boost: HISTORICAL_CROSSREF_BOOST,
  };

  const desc = description || '';

  const sevLabel  = extractSeverity(desc);
  const urgLabel  = extractUrgency(desc, sevLabel);
  const freqLabel = extractFrequency(desc);
  const affBucket = extractAffectedBucket(affected, desc);

  const sevCrisp  = defuzzify(cfg.severity_tfn[sevLabel]);
  const urgCrisp  = defuzzify(cfg.urgency_tfn[urgLabel]);
  const freqCrisp = defuzzify(cfg.frequency_tfn[freqLabel]);
  const affCrisp  = defuzzify(cfg.affected_tfn[affBucket]);

  const w = cfg.criteria_weights;
  const raw = (sevCrisp  * w.severity)
            + (urgCrisp  * w.urgency)
            + (freqCrisp * w.frequency)
            + (affCrisp  * w.affected_individuals);

  /* Theoretical max crisp value per criterion is 10 (Immediate TFN
     midpoint/ceiling), so normalize against the max possible
     weighted sum to land in a 0-100 range. */
  const maxPossible = 10 * (w.severity + w.urgency + w.frequency + w.affected_individuals);
  let score = Math.round((raw / maxPossible) * 100);

  /* Historical cross-reference boost */
  const boosted = CROSSREF_PATTERN.test(desc);
  if (boosted) score = Math.min(score + cfg.historical_crossref_boost, 100);

  /* Self-harm / suicide risk is treated as an absolute ceiling case —
     this is a safety-critical signal that should never be capped by
     the regular weighted formula or out-ranked by an unrelated
     high-affected-count complaint. Forced to the maximum score so it
     always sorts to the very top of the Priority Queue. */
  const selfHarmFlag = hasSelfHarmSignal(desc);
  if (selfHarmFlag) score = 100;

  const medicalEmergencyFlag = !selfHarmFlag && hasMedicalEmergencySignal(desc);

  const tier = priorityTierFromScore(score, cfg.priority_tier_cutoffs);

  return {
    score, tier,
    severity: sevLabel, urgency: urgLabel, frequency: freqLabel,
    affectedBucket: affBucket, boosted,
    selfHarmFlag, medicalEmergencyFlag,
  };
}

function priorityTierFromScore(score, cutoffs) {
  const c = cutoffs || PRIORITY_TIER_CUTOFFS;
  if (score >= c.Critical) return 'Critical';
  if (score >= c.High)     return 'High';
  if (score >= c.Medium)   return 'Medium';
  return 'Low';
}

const TIER_BADGES = {
  Critical: 'b-red',
  High:     'b-amber',
  Medium:   'b-blue',
  Low:      'b-green',
};

function priorityLabel(score) {
  const tier = priorityTierFromScore(score, _ahp ? _ahp.priority_tier_cutoffs : PRIORITY_TIER_CUTOFFS);
  return { label: tier, badge: TIER_BADGES[tier] };
}

function statusBadge(status) {
  if (status === 'Resolved')    return 'b-green';
  if (status === 'In Progress') return 'b-blue';
  if (status === 'For Hearing') return 'b-amber';
  return 'b-gray';
}