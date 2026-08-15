<?php
// ═══════════════════════════════════════════════════════
//  BICTS — api/generate_report.php
//  Generates a PDF report and streams it to the browser.
//
//  GET params:
//    type       = classification | volume | response | outcome
//    date_from  = YYYY-MM-DD  (optional)
//    date_to    = YYYY-MM-DD  (optional)
//    view       = 1           (optional — preview in browser instead of download)
//
//  Uses FPDF (no Composer needed — just drop fpdf.php in api/)
//  Download: http://www.fpdf.org/  → fpdf182.zip → fpdf.php
// ═══════════════════════════════════════════════════════

if (session_status() === PHP_SESSION_NONE) session_start();

require_once __DIR__ . '/config.php';

function report_error($message, $code = 400) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

function is_super_admin_report($user) {
    return (($user['role'] ?? '') === 'super_admin');
}

function is_barangay_admin_report($user) {
    return (($user['role'] ?? '') === 'admin');
}

function is_administrative_report_user($user) {
    return in_array(
        ($user['role'] ?? ''),
        ['admin', 'super_admin'],
        true
    );
}

function require_admin_report_session() {
    $user = $_SESSION['user'] ?? null;

    if (!$user || empty($user['id'])) {
        report_error('Authentication required', 401);
    }

    if (!is_administrative_report_user($user)) {
        report_error('Administrator access required', 403);
    }

    if (is_barangay_admin_report($user)) {
        $barangayId = $user['barangay_id'] === null
            ? null
            : (int)$user['barangay_id'];

        if ($barangayId === null || $barangayId <= 0) {
            report_error(
                'Administrator barangay is not configured',
                403
            );
        }
    }

    return $user;
}

// Require a fully authenticated admin before loading FPDF or querying data.
$admin = require_admin_report_session();

$isSuperAdmin = is_super_admin_report($admin);

$barangay_id = $admin['barangay_id'] === null
    ? null
    : (int)$admin['barangay_id'];

require_once __DIR__ . '/fpdf.php';

$type      = $_GET['type']      ?? 'volume';
$date_from = trim((string)($_GET['date_from'] ?? ''));
$date_to   = trim((string)($_GET['date_to']   ?? ''));
$viewMode  = !empty($_GET['view']);

// Allow only the report types implemented below.
$allowedTypes = ['classification', 'volume', 'response', 'outcome'];
if (!in_array($type, $allowedTypes, true)) {
    report_error('Invalid report type', 422);
}

function valid_report_date($value) {
    if ($value === '') return true;

    $date = DateTime::createFromFormat('!Y-m-d', $value);
    return $date && $date->format('Y-m-d') === $value;
}

if (!valid_report_date($date_from) || !valid_report_date($date_to)) {
    report_error('Dates must use YYYY-MM-DD format', 422);
}

if ($date_from !== '' && $date_to !== '' && $date_from > $date_to) {
    report_error('date_from cannot be after date_to', 422);
}

$db = getDB();

/*
 * Report scope:
 *
 * Barangay Admin:
 *   always restricted to own barangay.
 *
 * Super Admin:
 *   barangay_id > 0  => one selected barangay
 *   scope=all        => all barangays
 *
 * Super Admin must explicitly choose one of those.
 */

$whereParts = [];
$params     = [];
$types      = '';

if (!$isSuperAdmin) {

    // Normal Barangay Admin — always own barangay.
    $whereParts[] = 'barangay_id = ?';
    $params[]     = $barangay_id;
    $types       .= 'i';

} else {

    $requestedBarangayId = isset($_GET['barangay_id'])
        ? (int)$_GET['barangay_id']
        : 0;

    $requestedScope = trim(
        (string)($_GET['scope'] ?? '')
    );

    if ($requestedBarangayId > 0) {

        /*
         * Validate that the selected barangay actually exists.
         */
        $barangayCheck = $db->prepare(
            'SELECT id
               FROM barangays
              WHERE id = ?
              LIMIT 1'
        );

        $barangayCheck->bind_param(
            'i',
            $requestedBarangayId
        );

        $barangayCheck->execute();

        $barangayExists = $barangayCheck
            ->get_result()
            ->fetch_assoc();

        $barangayCheck->close();

        if (!$barangayExists) {
            $db->close();

            report_error(
                'Selected barangay does not exist',
                422
            );
        }

        $whereParts[] = 'barangay_id = ?';
        $params[]     = $requestedBarangayId;
        $types       .= 'i';

    } elseif ($requestedScope === 'all') {

        /*
         * Explicit global Super Admin report.
         * No barangay WHERE condition is added.
         */

    } else {

        $db->close();

        report_error(
            'Super Admin must select a barangay or explicitly request scope=all',
            422
        );
    }
}

if ($date_from !== '') {
    $whereParts[] = 'date_filed >= ?';
    $params[] = $date_from;
    $types .= 's';
}

if ($date_to !== '') {
    $whereParts[] = 'date_filed <= ?';
    $params[] = $date_to;
    $types .= 's';
}

$where = !empty($whereParts)
    ? 'WHERE ' . implode(' AND ', $whereParts)
    : '';

// ── Fetch complaints ──
$sql  = "SELECT * FROM complaints $where ORDER BY date_filed ASC";
$stmt = $db->prepare($sql);

if (!$stmt) {
    $db->close();
    report_error('Could not prepare report query', 500);
}

/*
 * Bind only when the report query actually
 * contains placeholders.
 *
 * Super Admin scope=all with no date filters
 * has no parameters at all.
 */
if (!empty($params)) {
    $stmt->bind_param(
        $types,
        ...$params
    );
}

if (!$stmt->execute()) {
    $stmt->close();
    $db->close();
    report_error('Could not load report data', 500);
}

$result     = $stmt->get_result();
$complaints = [];

while ($row = $result->fetch_assoc()) {
    $complaints[] = $row;
}

$stmt->close();

// ── Date range label ──
$rangeLabel = '';
if ($date_from && $date_to) {
    $rangeLabel = date('F j, Y', strtotime($date_from)) . ' to ' . date('F j, Y', strtotime($date_to));
} elseif ($date_from) {
    $rangeLabel = 'From ' . date('F j, Y', strtotime($date_from));
} elseif ($date_to) {
    $rangeLabel = 'Up to ' . date('F j, Y', strtotime($date_to));
} else {
    $rangeLabel = 'All Records';
}

$generatedAt = date('F j, Y \a\t h:i A');
$totalCount  = count($complaints);

// ════════════════════════════════════════════════════════
//  FPDF HELPER CLASS — adds header/footer to every page
// ════════════════════════════════════════════════════════
class BICTSReport extends FPDF {
    public $reportTitle  = '';
    public $rangeLabel   = '';
    public $generatedAt  = '';

    function Header() {
        // Dark header bar
        $this->SetFillColor(30, 41, 59);
        $this->Rect(0, 0, 210, 22, 'F');

        // Logo text
        $this->SetFont('Arial', 'B', 13);
        $this->SetTextColor(255, 255, 255);
        $this->SetXY(10, 5);
        $this->Cell(0, 7, 'BarangAI  |  BICTS Report', 0, 1, 'L');

        // Subtitle
        $this->SetFont('Arial', '', 8);
        $this->SetTextColor(180, 200, 220);
        $this->SetX(10);
        $this->Cell(0, 5, 'Barangay Intelligent Case Tracking System', 0, 1, 'L');

        // Report title on right
        $this->SetFont('Arial', 'B', 9);
        $this->SetTextColor(100, 180, 255);
        $this->SetXY(10, 5);
        $this->Cell(190, 7, $this->reportTitle, 0, 0, 'R');

        $this->SetTextColor(0, 0, 0);
        $this->SetY(28);
    }

    function Footer() {
        $this->SetY(-14);
        $this->SetFont('Arial', 'I', 7);
        $this->SetTextColor(150, 150, 150);
        $this->Cell(0, 5, 'Generated: ' . $this->generatedAt . '   |   Date Range: ' . $this->rangeLabel, 0, 0, 'L');
        $this->Cell(0, 5, 'Page ' . $this->PageNo(), 0, 0, 'R');
    }

    // Colored section heading
    function SectionTitle($text) {
        $this->SetFont('Arial', 'B', 10);
        $this->SetFillColor(30, 95, 168);
        $this->SetTextColor(255, 255, 255);
        $this->Cell(0, 7, '  ' . $text, 0, 1, 'L', true);
        $this->SetTextColor(0, 0, 0);
        $this->Ln(3);
    }

    // Stat summary box
    function StatBox($label, $value, $color = [30, 95, 168]) {
        $x = $this->GetX();
        $y = $this->GetY();
        $this->SetFillColor($color[0], $color[1], $color[2]);
        $this->Rect($x, $y, 58, 18, 'F');
        $this->SetTextColor(255, 255, 255);
        $this->SetFont('Arial', 'B', 14);
        $this->SetXY($x, $y + 2);
        $this->Cell(58, 8, $value, 0, 0, 'C');
        $this->SetFont('Arial', '', 7);
        $this->SetXY($x, $y + 10);
        $this->Cell(58, 5, $label, 0, 0, 'C');
        $this->SetTextColor(0, 0, 0);
        $this->SetXY($x + 62, $y);
    }

    // Table header row
    function TableHeader($cols) {
        $this->SetFillColor(240, 245, 255);
        $this->SetFont('Arial', 'B', 8);
        $this->SetTextColor(30, 41, 59);
        foreach ($cols as $col) {
            $this->Cell($col['w'], 7, $col['label'], 1, 0, $col['align'] ?? 'L', true);
        }
        $this->Ln();
        $this->SetFont('Arial', '', 8);
        $this->SetTextColor(0, 0, 0);
    }

    // Alternating table row
    function TableRow($cells, $rowIndex) {
        $fill = ($rowIndex % 2 === 0);
        if ($fill) $this->SetFillColor(248, 250, 255);
        foreach ($cells as $cell) {
            $this->Cell($cell['w'], 6, $this->safeText($cell['v']), 1, 0, $cell['a'] ?? 'L', $fill);
        }
        $this->Ln();
    }

    function safeText($str) {
        return iconv('UTF-8', 'windows-1252//TRANSLIT//IGNORE', (string)$str);
    }
}

// ════════════════════════════════════════════════════════
//  REPORT BUILDERS
// ════════════════════════════════════════════════════════

// ── 1. Classification Accuracy Report ──
function buildClassificationReport($pdf, $complaints) {

    $pdf->SectionTitle(
        'Final SVM Model Performance — Locked Test Set'
    );


    /*
     * FINAL CHAPTER 4 RESULTS
     *
     * Final modeling records: 3,669
     * Training records: 2,928
     * Locked test records: 741
     * Exact train-test text overlap: 0
     *
     * Selected model:
     * LinearSVC
     * Word TF-IDF (1,3)
     * char_wb TF-IDF (3,6)
     * C = 0.5
     */
    $pdf->SetX(10);

    $pdf->StatBox(
        'Accuracy',
        '83.81%',
        [27, 122, 74]
    );

    $pdf->StatBox(
        'Weighted F1',
        '83.77%',
        [30, 95, 168]
    );

    $pdf->StatBox(
        'Locked Test Set',
        '741',
        [80, 60, 160]
    );

    $pdf->Ln(24);


    /*
     * Overall metrics.
     */
    $pdf->SectionTitle(
        'Overall Evaluation Metrics'
    );

    $overallCols = [
        [
            'w' => 65,
            'label' => 'Metric'
        ],
        [
            'w' => 45,
            'label' => 'Result',
            'align' => 'C'
        ],
        [
            'w' => 80,
            'label' => 'Evaluation',
            'align' => 'C'
        ],
    ];

    $pdf->TableHeader($overallCols);

    $overall = [
        [
            'Accuracy',
            '83.81%',
            'Locked test set'
        ],
        [
            'Weighted Precision',
            '84.05%',
            'Locked test set'
        ],
        [
            'Weighted Recall',
            '83.81%',
            'Locked test set'
        ],
        [
            'Weighted F1-Score',
            '83.77%',
            'Model-selection metric'
        ],
        [
            'Training Records',
            '2,928',
            '100% training data'
        ],
        [
            'Testing Records',
            '741',
            'Locked test data'
        ],
        [
            'Exact Text Overlap',
            '0',
            'Train vs test'
        ],
    ];

    foreach ($overall as $i => $r) {

        $pdf->TableRow([
            [
                'w' => 65,
                'v' => $r[0]
            ],
            [
                'w' => 45,
                'v' => $r[1],
                'a' => 'C'
            ],
            [
                'w' => 80,
                'v' => $r[2],
                'a' => 'C'
            ],
        ], $i);
    }


    $pdf->Ln(8);


    /*
     * Per-category SVM performance.
     */
    $pdf->SectionTitle(
        'SVM Performance by Complaint Category'
    );

    $cols = [
        [
            'w' => 72,
            'label' => 'Category'
        ],
        [
            'w' => 25,
            'label' => 'Precision',
            'align' => 'C'
        ],
        [
            'w' => 25,
            'label' => 'Recall',
            'align' => 'C'
        ],
        [
            'w' => 25,
            'label' => 'F1-Score',
            'align' => 'C'
        ],
        [
            'w' => 20,
            'label' => 'Support',
            'align' => 'C'
        ],
    ];

    $pdf->TableHeader($cols);


    $perCat = [

        [
            'cat'  => 'Neighbor Disputes',
            'prec' => '83.19%',
            'rec'  => '84.62%',
            'f1'   => '83.90%',
            'sup'  => 117
        ],

        [
            'cat'  => 'Money/Debt Disputes',
            'prec' => '87.14%',
            'rec'  => '87.77%',
            'f1'   => '87.46%',
            'sup'  => 139
        ],

        [
            'cat'  => 'Family Matters',
            'prec' => '86.15%',
            'rec'  => '77.78%',
            'f1'   => '81.75%',
            'sup'  => 144
        ],

        [
            'cat'  => 'Petty Criminal Offenses',
            'prec' => '79.26%',
            'rec'  => '86.29%',
            'f1'   => '82.63%',
            'sup'  => 124
        ],

        [
            'cat'  => 'Property Disputes',
            'prec' => '87.07%',
            'rec'  => '78.29%',
            'f1'   => '82.45%',
            'sup'  => 129
        ],

        [
            'cat'  => 'Contract Disputes',
            'prec' => '79.21%',
            'rec'  => '90.91%',
            'f1'   => '84.66%',
            'sup'  => 88
        ],
    ];


    foreach ($perCat as $i => $r) {

        $pdf->TableRow([
            [
                'w' => 72,
                'v' => $r['cat']
            ],
            [
                'w' => 25,
                'v' => $r['prec'],
                'a' => 'C'
            ],
            [
                'w' => 25,
                'v' => $r['rec'],
                'a' => 'C'
            ],
            [
                'w' => 25,
                'v' => $r['f1'],
                'a' => 'C'
            ],
            [
                'w' => 20,
                'v' => $r['sup'],
                'a' => 'C'
            ],
        ], $i);
    }


    $pdf->Ln(8);


    /*
     * Final three-model comparison.
     */
    $pdf->SectionTitle(
        'Final Model Comparison — 100% Training Data'
    );

    $cols2 = [
        [
            'w' => 50,
            'label' => 'Metric'
        ],
        [
            'w' => 40,
            'label' => 'Naive Bayes',
            'align' => 'C'
        ],
        [
            'w' => 40,
            'label' => 'SVM',
            'align' => 'C'
        ],
        [
            'w' => 40,
            'label' => 'Bi-LSTM',
            'align' => 'C'
        ],
    ];

    $pdf->TableHeader($cols2);


    $comparison = [

        [
            'Accuracy',
            '75.17%',
            '83.81%',
            '70.99%'
        ],

        [
            'Precision',
            '75.33%',
            '84.05%',
            '72.29%'
        ],

        [
            'Recall',
            '75.17%',
            '83.81%',
            '70.99%'
        ],

        [
            'Weighted F1',
            '75.16%',
            '83.77%',
            '71.22%'
        ],

        [
            'Train Time',
            '0.6199s',
            '0.5135s',
            '18.9820s'
        ],

        [
            'Infer Time',
            '0.001004s',
            '0.004017s',
            '0.634181s'
        ],
    ];


    foreach ($comparison as $i => $r) {

        $pdf->TableRow([
            [
                'w' => 50,
                'v' => $r[0]
            ],
            [
                'w' => 40,
                'v' => $r[1],
                'a' => 'C'
            ],
            [
                'w' => 40,
                'v' => $r[2],
                'a' => 'C'
            ],
            [
                'w' => 40,
                'v' => $r[3],
                'a' => 'C'
            ],
        ], $i);
    }


    $pdf->Ln(8);


    /*
     * Selected configuration.
     */
    $pdf->SectionTitle(
        'Selected Production Configuration'
    );

    $pdf->SetFont(
        'Arial',
        '',
        9
    );

    $pdf->MultiCell(
        0,
        6,
        $pdf->safeText(
            'Selected model: Support Vector Machine (LinearSVC)' .
            "\n" .
            'Feature extraction: Word TF-IDF n-grams (1,3) + char_wb TF-IDF n-grams (3,6)' .
            "\n" .
            'LinearSVC C: 0.5' .
            "\n" .
            'Class weighting: balanced' .
            "\n" .
            'Final modeling dataset: 3,669 real complaint records' .
            "\n" .
            'Complaint categories: 6' .
            "\n" .
            'Train-test exact-text overlap: 0 records'
        )
    );
}

// ── 2. Complaint Volume Report ──
function buildVolumeReport($pdf, $complaints) {
    $total = count($complaints);

    $pdf->SectionTitle('Complaint Volume Summary');

    // Summary boxes
    $resolved   = count(array_filter($complaints, fn($c) => $c['status'] === 'Resolved'));
    $unresolved = $total - $resolved;
    $pdf->SetX(10);
    $pdf->StatBox('Total Complaints', $total, [30, 95, 168]);
    $pdf->StatBox('Resolved', $resolved, [27, 122, 74]);
    $pdf->StatBox('Unresolved', $unresolved, [176, 96, 0]);
    $pdf->Ln(24);

    // By category
    $pdf->SectionTitle('Complaints by Category');
    $catCounts = [];
    foreach ($complaints as $c) {
        $cat = $c['category'];
        $catCounts[$cat] = ($catCounts[$cat] ?? 0) + 1;
    }
    arsort($catCounts);

    $cols = [
        ['w' => 90, 'label' => 'Category'],
        ['w' => 30, 'label' => 'Count',   'align' => 'C'],
        ['w' => 30, 'label' => '% Share', 'align' => 'C'],
        ['w' => 40, 'label' => 'Bar',     'align' => 'L'],
    ];
    $pdf->TableHeader($cols);
    $i = 0;
    foreach ($catCounts as $cat => $count) {
        $pct    = $total > 0 ? round(($count / $total) * 100, 1) : 0;
        $bar    = str_repeat('|', (int)round($pct / 3));
        $pdf->TableRow([
            ['w' => 90, 'v' => $cat],
            ['w' => 30, 'v' => $count, 'a' => 'C'],
            ['w' => 30, 'v' => $pct . '%', 'a' => 'C'],
            ['w' => 40, 'v' => $bar],
        ], $i++);
    }

    $pdf->Ln(8);

    // All complaints list
    $pdf->SectionTitle('Complete Complaints List');
    $cols2 = [
        ['w' => 15, 'label' => 'No.'],
        ['w' => 22, 'label' => 'Date Filed'],
        ['w' => 65, 'label' => 'Description'],
        ['w' => 42, 'label' => 'Category'],
        ['w' => 20, 'label' => 'Priority', 'align' => 'C'],
        ['w' => 26, 'label' => 'Status',   'align' => 'C'],
    ];
    $pdf->TableHeader($cols2);
    foreach ($complaints as $i => $c) {
        $desc = mb_strlen($c['description']) > 55
              ? mb_substr($c['description'], 0, 52) . '...'
              : $c['description'];
        $pdf->TableRow([
            ['w' => 15, 'v' => $c['complaint_id']],
            ['w' => 22, 'v' => date('M j, Y', strtotime($c['date_filed']))],
            ['w' => 65, 'v' => $desc],
            ['w' => 42, 'v' => $c['category']],
            ['w' => 20, 'v' => $c['priority'],  'a' => 'C'],
            ['w' => 26, 'v' => $c['status'],     'a' => 'C'],
        ], $i);
    }
}

// ── 3. Response Time Report ──
function buildResponseTimeReport($pdf, $complaints) {
    $total    = count($complaints);
    $resolved = array_filter($complaints, fn($c) => $c['status'] === 'Resolved');
    $rate     = $total > 0 ? round((count($resolved) / $total) * 100, 1) : 0;

    $pdf->SectionTitle('Response & Resolution Summary');
    $pdf->SetX(10);
    $pdf->StatBox('Total Cases', $total, [30, 95, 168]);
    $pdf->StatBox('Resolved', count($resolved), [27, 122, 74]);
    $pdf->StatBox('Resolution Rate', $rate . '%', $rate >= 70 ? [27, 122, 74] : [176, 96, 0]);
    $pdf->Ln(24);

    // By category breakdown
    $pdf->SectionTitle('Resolution Rate by Category');
    $catMap = [];
    foreach ($complaints as $c) {
        $cat = $c['category'];
        if (!isset($catMap[$cat])) $catMap[$cat] = ['total' => 0, 'resolved' => 0];
        $catMap[$cat]['total']++;
        if ($c['status'] === 'Resolved') $catMap[$cat]['resolved']++;
    }

    $cols = [
        ['w' => 70, 'label' => 'Category'],
        ['w' => 25, 'label' => 'Total',      'align' => 'C'],
        ['w' => 25, 'label' => 'Resolved',   'align' => 'C'],
        ['w' => 25, 'label' => 'Unresolved', 'align' => 'C'],
        ['w' => 30, 'label' => 'Rate',       'align' => 'C'],
        ['w' => 15, 'label' => 'Status',     'align' => 'C'],
    ];
    $pdf->TableHeader($cols);
    $i = 0;
    foreach ($catMap as $cat => $d) {
        $r      = $d['total'] > 0 ? round(($d['resolved'] / $d['total']) * 100, 0) : 0;
        $status = $r >= 70 ? 'Good' : ($r >= 40 ? 'Fair' : ($d['total'] === 0 ? 'N/A' : 'Low'));
        $pdf->TableRow([
            ['w' => 70, 'v' => $cat],
            ['w' => 25, 'v' => $d['total'],              'a' => 'C'],
            ['w' => 25, 'v' => $d['resolved'],           'a' => 'C'],
            ['w' => 25, 'v' => $d['total'] - $d['resolved'], 'a' => 'C'],
            ['w' => 30, 'v' => $r . '%',                 'a' => 'C'],
            ['w' => 15, 'v' => $status,                  'a' => 'C'],
        ], $i++);
    }

    $pdf->Ln(8);

    // Per-complaint resolution log
    $pdf->SectionTitle('Individual Case Resolution Log');
    $cols2 = [
        ['w' => 16, 'label' => 'No.'],
        ['w' => 22, 'label' => 'Filed'],
        ['w' => 42, 'label' => 'Category'],
        ['w' => 30, 'label' => 'Officer'],
        ['w' => 22, 'label' => 'Priority', 'align' => 'C'],
        ['w' => 28, 'label' => 'Status',   'align' => 'C'],
        ['w' => 30, 'label' => 'Resolved At'],
    ];
    $pdf->TableHeader($cols2);
    foreach ($complaints as $i => $c) {
        $resolvedAt = $c['resolved_at'] ? date('M j, Y', strtotime($c['resolved_at'])) : '—';
        $pdf->TableRow([
            ['w' => 16, 'v' => $c['complaint_id']],
            ['w' => 22, 'v' => date('M j, Y', strtotime($c['date_filed']))],
            ['w' => 42, 'v' => $c['category']],
            ['w' => 30, 'v' => $c['officer']],
            ['w' => 22, 'v' => $c['priority'],   'a' => 'C'],
            ['w' => 28, 'v' => $c['status'],      'a' => 'C'],
            ['w' => 30, 'v' => $resolvedAt],
        ], $i);
    }
}

// ── 4. Case Outcome Report ──
function buildOutcomeReport($pdf, $complaints) {
    $total    = count($complaints);
    $statuses = ['Open', 'In Progress', 'For Hearing', 'Resolved'];

    $pdf->SectionTitle('Case Outcome Overview');
    $statusCounts = [];
    foreach ($statuses as $s) {
        $statusCounts[$s] = count(array_filter($complaints, fn($c) => $c['status'] === $s));
    }

    // Status summary boxes (2x2)
    $colors = [
        'Open'        => [138, 155, 176],
        'In Progress' => [30,  95,  168],
        'For Hearing' => [176, 96,  0  ],
        'Resolved'    => [27,  122, 74 ],
    ];
    $pdf->SetX(10);
    foreach ($statuses as $s) {
        $pdf->StatBox($s, $statusCounts[$s], $colors[$s]);
    }
    $pdf->Ln(24);

    // Priority breakdown
    $pdf->SectionTitle('Priority Level Breakdown');
    $priorities = ['Critical', 'High', 'Medium', 'Low'];
    $priCounts  = [];
    foreach ($priorities as $p) {
        $priCounts[$p] = count(array_filter($complaints, fn($c) => $c['priority'] === $p));
    }
    $cols = [
        ['w' => 50, 'label' => 'Priority Level'],
        ['w' => 30, 'label' => 'Count',    'align' => 'C'],
        ['w' => 30, 'label' => '% Share',  'align' => 'C'],
        ['w' => 80, 'label' => 'Visual Bar'],
    ];
    $pdf->TableHeader($cols);
    foreach ($priorities as $i => $p) {
        $count = $priCounts[$p];
        $pct   = $total > 0 ? round(($count / $total) * 100, 1) : 0;
        $bar   = str_repeat('|', (int)round($pct / 2));
        $pdf->TableRow([
            ['w' => 50, 'v' => $p],
            ['w' => 30, 'v' => $count, 'a' => 'C'],
            ['w' => 30, 'v' => $pct . '%', 'a' => 'C'],
            ['w' => 80, 'v' => $bar],
        ], $i);
    }

    $pdf->Ln(8);

    // Full complaints by status
    foreach ($statuses as $s) {
        $group = array_filter($complaints, fn($c) => $c['status'] === $s);
        if (empty($group)) continue;

        $pdf->SectionTitle($s . ' Cases (' . count($group) . ')');
        $cols2 = [
            ['w' => 16, 'label' => 'No.'],
            ['w' => 22, 'label' => 'Date Filed'],
            ['w' => 65, 'label' => 'Description'],
            ['w' => 42, 'label' => 'Category'],
            ['w' => 20, 'label' => 'Priority', 'align' => 'C'],
            ['w' => 25, 'label' => 'Officer'],
        ];
        $pdf->TableHeader($cols2);
        foreach (array_values($group) as $i => $c) {
            $desc = mb_strlen($c['description']) > 55
                  ? mb_substr($c['description'], 0, 52) . '...'
                  : $c['description'];
            $pdf->TableRow([
                ['w' => 16, 'v' => $c['complaint_id']],
                ['w' => 22, 'v' => date('M j, Y', strtotime($c['date_filed']))],
                ['w' => 65, 'v' => $desc],
                ['w' => 42, 'v' => $c['category']],
                ['w' => 20, 'v' => $c['priority'], 'a' => 'C'],
                ['w' => 25, 'v' => $c['officer']],
            ], $i);
        }
        $pdf->Ln(4);
    }
}

// ════════════════════════════════════════════════════════
//  BUILD THE PDF
// ════════════════════════════════════════════════════════
$reportTitles = [
    'classification' => 'Classification Accuracy Report',
    'volume'         => 'Complaint Volume Report',
    'response'       => 'Response Time Report',
    'outcome'        => 'Case Outcome Report',
];

$titleText = $reportTitles[$type] ?? 'BICTS Report';

$pdf = new BICTSReport('P', 'mm', 'A4');
$pdf->reportTitle = $titleText;
$pdf->rangeLabel  = $rangeLabel;
$pdf->generatedAt = $generatedAt;
$pdf->SetMargins(10, 30, 10);
$pdf->SetAutoPageBreak(true, 20);
$pdf->AddPage();

// Report title block
$pdf->SetFont('Arial', 'B', 16);
$pdf->SetTextColor(30, 41, 59);
$pdf->Cell(0, 10, $titleText, 0, 1, 'L');
$pdf->SetFont('Arial', '', 9);
$pdf->SetTextColor(100, 120, 140);
$pdf->Cell(0, 5, 'Date Range: ' . $rangeLabel . '   |   Total Records: ' . $totalCount . '   |   Generated: ' . $generatedAt, 0, 1, 'L');
$pdf->SetDrawColor(30, 95, 168);
$pdf->SetLineWidth(0.5);
$pdf->Line(10, $pdf->GetY(), 200, $pdf->GetY());
$pdf->Ln(6);
$pdf->SetTextColor(0, 0, 0);

// Route to the right builder
switch ($type) {
    case 'classification': buildClassificationReport($pdf, $complaints); break;
    case 'volume':         buildVolumeReport($pdf, $complaints);         break;
    case 'response':       buildResponseTimeReport($pdf, $complaints);   break;
    case 'outcome':        buildOutcomeReport($pdf, $complaints);        break;
}

// Stream PDF to browser
// view=1  -> show inline in the browser (preview)
// default -> force download (Export)
$filename = str_replace(' ', '_', $titleText) . '_' . date('Y-m-d') . '.pdf';
if ($viewMode) {
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="' . $filename . '"');
    $pdf->Output('I', $filename);
} else {
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $pdf->Output('D', $filename);
}
$db->close();