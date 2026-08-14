/* ═══════════════════════════════════════════════════════
   BarangAI — js/classifier.js
   Production browser classifier for the exported final SVM package.

   InfinityFree-safe split model files:
     data/svm_model_core.json  — classes, coefficients, intercepts
     data/svm_word_tfidf.json  — Word TF-IDF branch, n-grams (1,3)
     data/svm_char_tfidf.json  — char_wb TF-IDF branch, n-grams (3,6)
     data/svm_meta.json        — preprocessing and model metadata

   Reconstructed export format in memory:
     model.classes       — 6 KP categories
     model.coef          — LinearSVC coefficients [6 × 73,078]
     model.intercept     — 6 LinearSVC intercepts
     word_tfidf          — 40,000 Word TF-IDF features, n-grams (1,3)
     char_tfidf          — 33,078 char_wb TF-IDF features, n-grams (3,6)
     preprocessing       — Unicode NFKC normalization + lowercase

   IMPORTANT:
   The two TF-IDF branches are L2-normalized independently and then
   concatenated, matching scikit-learn FeatureUnion. Do not reintroduce
   punctuation stripping or stop-word removal here: those are not part
   of the exported final vectorizer used by this model artifact.

   Fuzzy AHP remains loaded independently from:
     data/fuzzy_ahp_config.json
═══════════════════════════════════════════════════════ */

let _model    = null;
let _modelErr = false;
let _ahp      = null;

function _fetchJson(path) {
  return fetch(path).then(r => {
    if (!r.ok) throw new Error(path + ' returned HTTP ' + r.status);
    return r.json();
  });
}

function initClassifier() {
  return Promise.all([
    _fetchJson('data/svm_model_core.json'),
    _fetchJson('data/svm_word_tfidf.json'),
    _fetchJson('data/svm_char_tfidf.json'),
    _fetchJson('data/svm_meta.json'),
  ])
    .then(([model, word_tfidf, char_tfidf, meta]) => {
      const data = { ...meta, model, word_tfidf, char_tfidf };
      if (!data.model || !data.word_tfidf || !data.char_tfidf) {
        throw new Error('Unsupported split model export format');
      }
      _model = data;
      _modelErr = false;
      const wordN = data.word_tfidf.idf.length;
      const charN = data.char_tfidf.idf.length;
      console.log(
        'BarangAI: final SVM loaded from 4 split files —',
        data.model.classes.length, 'categories ·',
        (wordN + charN).toLocaleString(), 'features'
      );
    })
    .catch(err => {
      _modelErr = true;
      _model = null;
      console.warn('BarangAI: Could not load final split SVM export; using keyword fallback.', err);
    });
}

function initFuzzyAHP() {
  return fetch('data/fuzzy_ahp_config.json')
    .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
    .then(data => {
      _ahp = data;
      console.log('BarangAI: Fuzzy AHP config loaded — CR =', data.consistency_ratio.toFixed(4));
    })
    .catch(err => {
      console.warn('BarangAI: Could not load fuzzy_ahp_config.json, using data.js defaults.', err);
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

/* Exact preprocessing declared by the browser export. */
function preprocess(text) {
  let t = String(text == null ? '' : text);
  if (_model?.preprocessing?.unicode_normalization && t.normalize) {
    t = t.normalize(_model.preprocessing.unicode_normalization);
  }
  if (_model?.preprocessing?.lowercase !== false) t = t.toLowerCase();
  return t;
}

/* sklearn's default word token pattern is conceptually \b\w\w+\b.
   This Unicode-aware equivalent keeps letters, numbers, and underscore
   and requires at least two characters. */
function wordTokens(text) {
  return text.match(/[\p{L}\p{N}_]{2,}/gu) || [];
}

function addCount(map, idx) {
  map.set(idx, (map.get(idx) || 0) + 1);
}

function normalizeSparse(tf, idf, weight) {
  const values = new Map();
  let normSq = 0;
  tf.forEach((count, idx) => {
    const scaled = (count > 0 ? 1 + Math.log(count) : 0) * idf[idx] * weight;
    values.set(idx, scaled);
    normSq += scaled * scaled;
  });
  const norm = Math.sqrt(normSq);
  if (norm > 0) values.forEach((v, idx) => values.set(idx, v / norm));
  return values;
}

function wordTfidfSparse(text) {
  const cfg = _model.word_tfidf;
  const vocab = cfg.vocabulary;
  const words = wordTokens(text);
  const tf = new Map();
  const minN = cfg.ngram_range[0], maxN = cfg.ngram_range[1];

  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n).join(' ');
      const idx = vocab[gram];
      if (idx !== undefined) addCount(tf, idx);
    }
  }
  return normalizeSparse(tf, cfg.idf, Number(cfg.weight ?? 1));
}

/* Mirrors sklearn TfidfVectorizer(analyzer='char_wb'). */
function charWbCounts(text, cfg) {
  const vocab = cfg.vocabulary;
  const tf = new Map();
  const normalized = text.replace(/\s+/gu, ' ');
  const minN = cfg.ngram_range[0], maxN = cfg.ngram_range[1];

  for (const rawWord of normalized.split(' ')) {
    if (!rawWord) continue;
    const w = ' ' + rawWord + ' ';
    const wLen = w.length;
    for (let n = minN; n <= maxN; n++) {
      let offset = 0;
      let gram = w.slice(offset, offset + n);
      let idx = vocab[gram];
      if (idx !== undefined) addCount(tf, idx);
      while (offset + n < wLen) {
        offset += 1;
        gram = w.slice(offset, offset + n);
        idx = vocab[gram];
        if (idx !== undefined) addCount(tf, idx);
      }
      if (offset === 0) break;
    }
  }
  return tf;
}

function charTfidfSparse(text) {
  const cfg = _model.char_tfidf;
  return normalizeSparse(charWbCounts(text, cfg), cfg.idf, Number(cfg.weight ?? 1));
}

function tfidfVectorize(text) {
  const word = wordTfidfSparse(text);
  const char = charTfidfSparse(text);
  const wordN = _model.word_tfidf.idf.length;
  const combined = new Map(word);
  char.forEach((v, idx) => combined.set(wordN + idx, v));
  return combined;
}

function svmDecide(vec) {
  const coef = _model.model.coef;
  const intercept = _model.model.intercept;
  const nClasses = _model.model.classes.length;
  const scores = new Float64Array(nClasses);

  for (let k = 0; k < nClasses; k++) {
    let dot = intercept[k];
    const ck = coef[k];
    vec.forEach((v, idx) => { dot += ck[idx] * v; });
    scores[k] = dot;
  }
  return scores;
}

/* LinearSVC does not output calibrated probabilities. Softmax is used only
   to provide a relative score distribution for the UI; the class prediction
   itself is always the argmax of the raw SVM decision function. */
function softmax(scores) {
  const max = Math.max(...scores);
  const exp = Array.from(scores).map(s => Math.exp(s - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map(e => e / sum);
}

function classifyDescription(desc) {
  if (!_model) return classifyKeywords(desc);

  const clean = preprocess(desc);
  const vec = tfidfVectorize(clean);
  const raw = svmDecide(vec);

  let bestIdx = 0;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] > raw[bestIdx]) bestIdx = i;
  }

  const probs = softmax(raw);
  const classes = _model.model.classes;
  const cat = classes[bestIdx];
  const conf = Math.min(Math.round(probs[bestIdx] * 100), 99);
  const scores = {};
  classes.forEach((c, i) => { scores[c] = Math.round(probs[i] * 100); });

  return { cat, conf, scores, decisionScores: Array.from(raw), scoreType: 'relative' };
}

function classifyKeywords(desc) {
  const lower = String(desc || '').toLowerCase();
  let bestCat = CATEGORIES[0];
  let bestConf = 55;
  let bestHits = 0;
  const rawHits = {};

  for (const rule of CLASSIFY_RULES) {
    const hits = rule.words.filter(w => lower.includes(w)).length;
    rawHits[rule.cat] = hits;
    if (hits > bestHits) {
      bestHits = hits;
      bestCat = rule.cat;
      bestConf = Math.min(rule.conf + Math.min(hits * 2, 6), 99);
    }
  }

  const total = Object.values(rawHits).reduce((a, b) => a + b, 0) || 1;
  const scores = {};
  for (const cat of CATEGORIES) {
    scores[cat] = cat === bestCat
      ? bestConf
      : Math.max(Math.round((rawHits[cat] / total) * (bestConf - 10)), 3);
  }
  return { cat: bestCat, conf: bestConf, scores, scoreType: 'fallback' };
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

function hasCriticalHighSignal(words, fullTextLower) {
  /* Use the regex-based root matcher (handles Tagalog infixes/prefixes
     like "susunugin", "sinaksak", "kinidnap") against the full text,
     not just exact tokenized words — this is more robust than a plain
     substring check on individual tokens. */
  return anyRootMatches(fullTextLower, CRITICAL_HIGH_ROOTS);
}

function extractSeverity(text, category) {
  /* ── 3-Layer Severity System ──────────────────────────────────────
     Layer 1  Safety overrides — fire first, regardless of category.
              These catch genuinely dangerous signals even when the
              SVM misclassifies the complaint category. If any Layer 1
              signal is present the function returns 'High' immediately.

     Layer 2  Category-based floor — the SVM's classification is the
              most reliable signal we have about the nature of a
              complaint. Each category maps to a sensible default
              severity that reflects the typical harm level of that
              dispute type under the KP framework (RA 7160).
                Petty Criminal Offenses → High   (criminal by definition)
                Property Disputes       → Medium  (often escalates)
                All others              → Low     (civil/mediation level)

     Layer 3  Amount modifier — an explicit peso amount in any category
              can raise the severity floor, but never lower it. A large
              debt or financial loss elevates urgency regardless of how
              the SVM categorised the complaint.
                >= ₱100,000 → raise to High
                >= ₱15,000  → raise to Medium (if currently Low)
                < ₱15,000   → keep Layer 2 floor
  ─────────────────────────────────────────────────────────────────── */

  const lower = String(text).toLowerCase();
  const words = cleanWords(text);

  /* ── Layer 1: Safety overrides ── */
  if (hasSelfHarmSignal(lower))        return 'High';
  if (hasMedicalEmergencySignal(lower)) return 'High';
  if (hasChildAbuseSignal(lower))      return 'High';
  if (hasCriticalHighSignal(words, lower)) return 'High';

  /* ── Layer 2: Category floor ── */
  const cat = (category || '').trim();
  let severity;
  if (cat === 'Petty Criminal Offenses') {
    severity = 'High';
  } else if (cat === 'Property Disputes') {
    severity = 'Medium';
  } else {
    /* Contract Disputes, Family Matters, Money/Debt Disputes,
       Neighbor Disputes — all start at Low; Layer 3 may raise. */
    severity = 'Low';
  }

  /* ── Layer 3: Amount modifier (raises floor, never lowers) ── */
  const amt = extractAmountBucket(lower);
  if (amt === 'High' && severity !== 'High') {
    severity = 'High';
  } else if (amt === 'Medium' && severity === 'Low') {
    severity = 'Medium';
  }

  return severity;
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
  if (top >= 15000)  return 'Medium';
  if (top >= 1)      return 'Low';   /* Fix: small explicit peso amounts (below 15,000)
                                         return Low instead of null, preventing the
                                         Jaccard fallback from inflating a minor debt
                                         complaint into a higher severity tier. */
  return 'Low';
}

function extractUrgency(text, severity) {
  /* Urgency reflects how quickly action is needed, not how serious the
     harm is. A property dispute or moderate debt is serious (Medium
     severity) but rarely time-critical — it needs mediation, not an
     emergency response. Only complaints that contain explicit immediacy
     language (kagabi, ngayon, kasalukuyan, emergency, etc.) should
     receive Medium urgency when severity is Medium.

     Mapping:
       High severity + immediate word → Immediate
       High severity                  → High
       Medium severity + immediate    → Medium
       Medium severity (no immediate) → Low   ← KEY CHANGE
       Low severity                   → Low
  */
  const d = text.toLowerCase();
  if (hasSelfHarmSignal(d)) return 'Immediate';
  if (hasMedicalEmergencySignal(d)) return 'Immediate';
  const immediate = IMMEDIATE_WORDS.some(w => d.includes(w));
  if (severity === 'High' && immediate) return 'Immediate';
  if (severity === 'High') return 'High';
  if (severity === 'Medium' && immediate) return 'Medium';
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

  const sevLabel  = extractSeverity(desc, category);
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
  /* Fix A: Medical emergencies are life-threatening — force score to 100
     same as self-harm, so they always surface as Critical regardless of
     how the Fuzzy AHP formula scores the other criteria. */
  if (medicalEmergencyFlag) score = 100;

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