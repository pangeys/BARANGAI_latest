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

require_once 'config.php';
require_once 'fpdf.php';   // ← place fpdf.php in the same api/ folder

$db        = getDB();
$type      = $_GET['type']      ?? 'volume';
$date_from = $_GET['date_from'] ?? '';
$date_to   = $_GET['date_to']   ?? '';
$viewMode  = !empty($_GET['view']);   // ?view=1 -> preview inline, otherwise download

// ── Build date filter SQL ──
$where  = '';
$params = [];
$types  = '';

if ($date_from && $date_to) {
    $where    = 'WHERE date_filed BETWEEN ? AND ?';
    $params[] = $date_from;
    $params[] = $date_to;
    $types    = 'ss';
} elseif ($date_from) {
    $where    = 'WHERE date_filed >= ?';
    $params[] = $date_from;
    $types    = 's';
} elseif ($date_to) {
    $where    = 'WHERE date_filed <= ?';
    $params[] = $date_to;
    $types    = 's';
}

// ── Fetch complaints ──
$sql  = "SELECT * FROM complaints $where ORDER BY date_filed ASC";
$stmt = $db->prepare($sql);
if ($params) {
    $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$result     = $stmt->get_result();
$complaints = [];
while ($row = $result->fetch_assoc()) $complaints[] = $row;
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
    $pdf->SectionTitle('SVM Model Performance — Per Category (v2, 200/cat)');

    // Stat boxes
    $pdf->SetX(10);
    $pdf->StatBox('Overall Accuracy', '95.45%', [27, 122, 74]);
    $pdf->StatBox('F1-Score (Weighted)', '95.30%', [30, 95, 168]);
    $pdf->StatBox('Test Set Size', '22 samples', [80, 60, 160]);
    $pdf->Ln(24);

    // Per-category table
    $cols = [
        ['w' => 72, 'label' => 'Category'],
        ['w' => 25, 'label' => 'Precision', 'align' => 'C'],
        ['w' => 25, 'label' => 'Recall',    'align' => 'C'],
        ['w' => 25, 'label' => 'F1-Score',  'align' => 'C'],
        ['w' => 20, 'label' => 'Support',   'align' => 'C'],
        ['w' => 23, 'label' => 'Grade',     'align' => 'C'],
    ];
    $pdf->TableHeader($cols);

    $perCat = [
        ['cat' => 'Accident & Traffic',             'prec' => '1.0000', 'rec' => '1.0000', 'f1' => '1.0000', 'sup' => 2],
        ['cat' => 'Defamation & Cyberbullying',     'prec' => '1.0000', 'rec' => '1.0000', 'f1' => '1.0000', 'sup' => 2],
        ['cat' => 'Environmental & Infrastructure', 'prec' => '1.0000', 'rec' => '1.0000', 'f1' => '1.0000', 'sup' => 2],
        ['cat' => 'Financial & Fraud',              'prec' => '1.0000', 'rec' => '1.0000', 'f1' => '1.0000', 'sup' => 4],
        ['cat' => 'Lost Items & Missing Person',    'prec' => '1.0000', 'rec' => '1.0000', 'f1' => '1.0000', 'sup' => 2],
        ['cat' => 'Theft & Property',               'prec' => '1.0000', 'rec' => '0.7500', 'f1' => '0.8571', 'sup' => 4],
        ['cat' => 'Threat & Violence',              'prec' => '0.8571', 'rec' => '1.0000', 'f1' => '0.9231', 'sup' => 6],
    ];

    foreach ($perCat as $i => $r) {
        $f1    = (float)$r['f1'];
        $grade = $f1 >= 0.95 ? 'Excellent' : ($f1 >= 0.85 ? 'Good' : 'Fair');
        $pdf->TableRow([
            ['w' => 72, 'v' => $r['cat']],
            ['w' => 25, 'v' => $r['prec'], 'a' => 'C'],
            ['w' => 25, 'v' => $r['rec'],  'a' => 'C'],
            ['w' => 25, 'v' => $r['f1'],   'a' => 'C'],
            ['w' => 20, 'v' => $r['sup'],  'a' => 'C'],
            ['w' => 23, 'v' => $grade,     'a' => 'C'],
        ], $i);
    }

    $pdf->Ln(8);
    $pdf->SectionTitle('Model Comparison — v2 Best Configuration');

    $cols2 = [
        ['w' => 50, 'label' => 'Metric'],
        ['w' => 40, 'label' => 'Naive Bayes', 'align' => 'C'],
        ['w' => 40, 'label' => 'SVM (Best)', 'align' => 'C'],
        ['w' => 40, 'label' => 'BiLSTM',     'align' => 'C'],
    ];
    $pdf->TableHeader($cols2);

    $comparison = [
        ['Accuracy',   '77.27%', '95.45%', '81.82%'],
        ['Precision',  '78.03%', '96.10%', '86.36%'],
        ['Recall',     '77.27%', '95.45%', '81.82%'],
        ['F1-Score',   '76.36%', '95.30%', '80.91%'],
        ['Train Time', '0.003s', '0.013s', '197.28s'],
        ['Infer Time', '~0s',    '0.0002s','~0.01s'],
    ];
    foreach ($comparison as $i => $r) {
        $pdf->TableRow([
            ['w' => 50, 'v' => $r[0]],
            ['w' => 40, 'v' => $r[1], 'a' => 'C'],
            ['w' => 40, 'v' => $r[2], 'a' => 'C'],
            ['w' => 40, 'v' => $r[3], 'a' => 'C'],
        ], $i);
    }
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