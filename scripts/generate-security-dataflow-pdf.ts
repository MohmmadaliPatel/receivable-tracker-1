#!/usr/bin/env tsx
/**
 * Renders Mermaid data-flow diagrams from CLIENT-SECURITY-BRIEF.md to a print-ready PDF.
 *
 * Run: npm run docs:security-dataflow-pdf
 * Output: docs/client-confirmation/pdfs/CLIENT-SECURITY-DATA-FLOW.pdf
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const BRIEF_MD = path.join(ROOT, 'docs', 'client-confirmation', 'CLIENT-SECURITY-BRIEF.md');
const PDF_DIR = path.join(ROOT, 'docs', 'client-confirmation', 'pdfs');
const OUT_PDF = path.join(PDF_DIR, 'CLIENT-SECURITY-DATA-FLOW.pdf');
const DATE = new Date().toISOString().slice(0, 10);
const CONFIDENTIAL = 'CONFIDENTIAL — For client submission only — Taxteck Email Auto';

function extractMermaidBlocks(md: string): string[] {
  const blocks: string[] = [];
  const re = /```mermaid\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    blocks.push(m[1].trim());
  }
  return blocks;
}

function buildHtml(flowchart: string, sequence: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 1.2cm 1cm; }
    @page landscape { size: A4 landscape; margin: 0.8cm 0.8cm; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111;
      margin: 0;
      padding: 0;
    }
    .cover {
      text-align: center;
      padding: 2.5cm 1cm 1cm;
      page-break-after: always;
    }
    .cover h1 { font-size: 20pt; margin: 0 0 8pt; }
    .cover .sub { font-size: 11pt; color: #444; margin-bottom: 16pt; }
    .cover .meta { font-size: 9pt; color: #666; margin-top: 24pt; }
    .confidential { color: #b00; font-weight: 600; font-size: 10pt; margin-top: 20pt; }
    .diagram-page {
      page-break-before: always;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 0.4cm 0;
    }
    .diagram-page.landscape { page: landscape; }
    .diagram-page h2 {
      font-size: 13pt;
      margin: 0 0 12pt;
      text-align: center;
      width: 100%;
    }
    .mermaid-wrap {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .mermaid-wrap svg {
      max-width: 100%;
      height: auto;
    }
    .caption {
      font-size: 8.5pt;
      color: #555;
      text-align: center;
      margin-top: 10pt;
      max-width: 90%;
    }
  </style>
</head>
<body>
  <div class="cover">
    <h1>Taxteck Email Auto</h1>
    <div class="sub">Security Data Flow Diagrams</div>
    <p style="font-size:10pt;color:#444;max-width:14cm;margin:0 auto;">
      Visual overview of confirmation email links, public recipient responses,
      secure file upload, internal staff access, and audit logging.
    </p>
    <div class="meta">Generated ${DATE}</div>
    <div class="confidential">${CONFIDENTIAL}</div>
  </div>

  <div class="diagram-page landscape">
    <h2>Data Flow — Overview</h2>
    <div class="mermaid-wrap">
      <pre class="mermaid">${esc(flowchart)}</pre>
    </div>
    <p class="caption">
      Internal staff send signed links via email. Recipients verify and respond once.
      Uploads require a valid link; downloads require staff login. All actions are audited.
    </p>
  </div>

  <div class="diagram-page">
    <h2>Data Flow — Sequence View</h2>
    <div class="mermaid-wrap">
      <pre class="mermaid">${esc(sequence)}</pre>
    </div>
    <p class="caption">
      End-to-end sequence: send confirmation, recipient response (12-hour link expiry),
      and internal user session lifecycle including logout.
    </p>
  </div>

  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({
      startOnLoad: true,
      theme: 'neutral',
      securityLevel: 'loose',
      flowchart: { useMaxWidth: true, htmlLabels: true },
      sequence: { useMaxWidth: true },
    });
  </script>
</body>
</html>`;
}

async function main() {
  if (!fs.existsSync(BRIEF_MD)) {
    throw new Error(`Missing source file: ${BRIEF_MD}`);
  }

  const md = fs.readFileSync(BRIEF_MD, 'utf8');
  const blocks = extractMermaidBlocks(md);
  if (blocks.length < 2) {
    throw new Error(`Expected at least 2 mermaid blocks in ${BRIEF_MD}, found ${blocks.length}`);
  }

  const [flowchart, sequence] = blocks;
  const html = buildHtml(flowchart, sequence);

  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('.mermaid svg').length >= 2,
      { timeout: 120_000 }
    );
    await page.emulateMediaType('print');

    await page.pdf({
      path: OUT_PDF,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="font-size:8pt;width:100%;text-align:center;color:#666;">' +
        CONFIDENTIAL +
        ' — Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: { top: '1cm', bottom: '1.4cm', left: '0.8cm', right: '0.8cm' },
    });

    console.log('Generated', OUT_PDF);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('PDF generation failed:', err);
  process.exit(1);
});
