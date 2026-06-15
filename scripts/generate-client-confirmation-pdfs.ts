#!/usr/bin/env tsx
/**
 * scripts/generate-client-confirmation-pdfs.ts
 *
 * Generates professional, print-ready A4 PDFs for the client's security questionnaire responses.
 * Uses the existing puppeteer dependency (no new packages).
 *
 * Outputs:
 *   docs/client-confirmation/pdfs/CLIENT-SECURITY-CONFIRMATION-SECTIONS-1-2-3-5-7.pdf (primary consolidated for requested scope)
 *   docs/client-confirmation/pdfs/MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.pdf (Entra setup for EmailConfig)
 *   + the historical per-section PDFs (01-08, dependency, patch, changes)
 *   + combined package PDF with cover + TOC + all sections (including the two new primary mds).
 *
 * Run: npm run docs:client-pdfs
 *
 * The content is primarily sourced from the .md files in docs/client-confirmation/.
 * A lightweight Markdown → HTML converter is included (sufficient for our controlled docs).
 */

import puppeteer, { type Browser } from 'puppeteer';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs', 'client-confirmation');
const PDF_DIR = path.join(DOCS_DIR, 'pdfs');
const EVIDENCE_DIR = path.join(DOCS_DIR, 'evidence');
const DATE = '2026-06-09';
const CONFIDENTIAL = 'CONFIDENTIAL — For client submission only — Taxteck Email Auto';

interface SectionDef {
  id: string;
  title: string;
  mdPath: string; // relative to DOCS_DIR or absolute
  subtitle?: string;
}

const SECTIONS: SectionDef[] = [
  { id: 'client', title: 'Client Security Confirmation — Sections 1, 2, 3, 5, 7 + Security Controls Matrix', mdPath: 'CLIENT-SECURITY-CONFIRMATION-SECTIONS-1-2-3-5-7.md' },
  { id: 'entra', title: 'Microsoft Entra Admin Center Steps (EmailConfig credentials)', mdPath: 'MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md' },
  { id: '04', title: '4. Vulnerability & Secure Coding Validation', mdPath: '04-vulnerability-and-secure-coding-validation.md' },
  { id: 'dependency', title: 'Dependency Vulnerability Scan Instructions', mdPath: 'dependency-scan-instructions.md' },
  { id: 'patch', title: 'Patch Management Process', mdPath: 'PATCH-MANAGEMENT.md' },
];

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readTextSafe(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return `# ${path.basename(p)}\n\n*(Source file not found at generation time — see the .md in docs/client-confirmation/ or regenerate after creating the document.)*`;
  }
}

// Very small, sufficient Markdown to HTML for our docs (headings, lists, tables, code, bold, links as text).
function mdToHtml(md: string): string {
  let html = md;

  // Escape basic HTML
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks ```
  html = html.replace(/```([\s\S]*?)```/g, (_m, code) => {
    return `<pre class="code"><code>${code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}</code></pre>`;
  });

  // Headings
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Links [text](url) → text (url) for print safety
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Unordered lists (simple, contiguous)
  html = html.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  // Basic tables (pipe | ... |). Convert rows.
  html = html.replace(/^\|(.+)\|$/gm, (_m, row) => {
    const cells = row.split('|').map((c: string) => c.trim()).filter((c: string) => c.length);
    const isHeader = cells.some((c: string) => /^[-:\s]+$/.test(c)) === false; // rough
    if (cells.length === 0) return '';
    const tag = isHeader ? 'th' : 'td';
    return `<tr>${cells.map((c: string) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
  });
  html = html.replace(/(<tr>.*<\/tr>\n?)+/g, (m) => `<table class="data">${m}</table>`);

  // Paragraphs (double newlines)
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Cleanup empty p around blocks
  html = html.replace(/<p>\s*<(h[1-3]|ul|table|pre)/g, '<$1');
  html = html.replace(/<\/(h[1-3]|ul|table|pre)>\s*<\/p>/g, '</$1>');

  return html;
}

function buildPageHtml(title: string, subtitle: string | undefined, bodyHtml: string, isCover = false): string {
  const header = `
    <div class="print-header">
      <div class="brand">Taxteck Email Auto — Client Security Confirmation Responses</div>
      <div class="date">Generated ${DATE}</div>
    </div>
  `;
  const footer = `
    <div class="print-footer">
      ${CONFIDENTIAL} — Page <span class="pageNumber"></span>
    </div>
  `;

  const css = `
    @page { size: A4; margin: 1.6cm 1.4cm; }
    @page { @bottom-center { content: element(footer); } }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; }
    .print-header { position: running(header); font-size: 8.5pt; color: #444; border-bottom: 1px solid #ccc; padding-bottom: 4pt; margin-bottom: 8pt; display: flex; justify-content: space-between; }
    .print-footer { position: running(footer); font-size: 8pt; color: #666; border-top: 1px solid #ccc; padding-top: 4pt; margin-top: 8pt; }
    h1 { font-size: 16pt; margin: 0 0 6pt; color: #111; }
    h2 { font-size: 13pt; margin: 14pt 0 6pt; color: #222; border-bottom: 1px solid #eee; padding-bottom: 2pt; }
    h3 { font-size: 11pt; margin: 10pt 0 4pt; color: #333; }
    table.data { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9pt; }
    table.data th, table.data td { border: 1px solid #ccc; padding: 3pt 5pt; text-align: left; vertical-align: top; }
    table.data th { background: #f6f6f6; font-weight: 600; }
    ul { margin: 4pt 0 8pt 16pt; }
    li { margin: 1pt 0; }
    pre.code { background: #f8f8f8; border: 1px solid #e5e5e5; padding: 6pt 8pt; overflow: auto; font-size: 8.5pt; line-height: 1.3; }
    p { margin: 4pt 0 6pt; }
    .cover { text-align: center; padding-top: 2cm; }
    .cover h1 { font-size: 20pt; margin-bottom: 12pt; }
    .cover .sub { font-size: 11pt; color: #444; }
    .confidential { color: #b00; font-weight: 600; letter-spacing: 0.5px; }
    .section { page-break-inside: avoid; }
    .evidence { font-size: 8.5pt; background: #fafafa; border-left: 3px solid #666; padding: 4pt 6pt; margin: 6pt 0; }
  `;

  if (isCover) {
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style></head>
<body>
  <div class="cover">
    <h1>Taxteck Email Auto</h1>
    <div class="sub">Client Security Questionnaire — Confirmation Responses</div>
    <div style="margin: 18pt 0; font-size: 10pt;">Verification &amp; Evidence Package — ${DATE}</div>
    <div class="confidential" style="margin-top: 24pt;">${CONFIDENTIAL}</div>
    <div style="margin-top: 36pt; font-size: 9pt; color:#555;">
      This package contains the pointwise answers, code evidence, and supporting documentation for every item in the client's "Confirmation application" questionnaire (screenshots dated 2026-06-03).<br/>
      See CHANGES_AND_CLARIFICATIONS.pdf for the exhaustive verification log with file:line citations.
    </div>
  </div>
</body></html>`;
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style></head>
<body>
  ${header}
  <h1>${title}</h1>
  ${subtitle ? `<div class="sub" style="color:#555;margin-bottom:8pt;">${subtitle}</div>` : ''}
  <div class="content">${bodyHtml}</div>
  <div style="margin-top:12pt;font-size:8pt;color:#666;">Source of truth: the .md files in docs/client-confirmation/ + code citations in CHANGES_AND_CLARIFICATIONS.md. Generated ${DATE}.</div>
  ${footer}
</body></html>`;
}

async function generateOne(browser: Browser, def: SectionDef, outName: string) {
  const fullMdPath = path.isAbsolute(def.mdPath) ? def.mdPath : path.join(DOCS_DIR, def.mdPath);
  const md = readTextSafe(fullMdPath);
  const body = mdToHtml(md);
  const html = buildPageHtml(def.title, def.subtitle, body, false);

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.emulateMediaType('print');

  ensureDir(PDF_DIR);
  const outPath = path.join(PDF_DIR, outName);
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:8pt;width:100%;text-align:center;color:#666;">' + CONFIDENTIAL + ' — <span class="pageNumber"></span></div>',
    margin: { top: '1.8cm', bottom: '1.6cm', left: '1.4cm', right: '1.4cm' },
  });
  await page.close();
  console.log('  ✓ Generated', outName);
  return outPath;
}

async function generateCover(browser: Browser, outName: string) {
  const html = buildPageHtml('', '', '', true);
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.emulateMediaType('print');
  const outPath = path.join(PDF_DIR, outName);
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: false,
    margin: { top: '1.2cm', bottom: '1.2cm', left: '1.2cm', right: '1.2cm' },
  });
  await page.close();
  console.log('  ✓ Generated cover', outName);
  return outPath;
}

async function generateCombined(browser: Browser, individualPaths: string[], coverPath: string, outName: string) {
  // For combined we simply concatenate by printing a wrapper that includes all content sequentially.
  // To keep it simple and robust we re-render a single long document containing all sections.
  const parts: string[] = [];
  for (const def of SECTIONS) {
    const fullMdPath = path.isAbsolute(def.mdPath) ? def.mdPath : path.join(DOCS_DIR, def.mdPath);
    const md = readTextSafe(fullMdPath);
    const body = mdToHtml(md);
    parts.push(`<div class="section"><h1>${def.title}</h1>${body}</div><div style="page-break-after: always;"></div>`);
  }
  const combinedBody = parts.join('\n');
  const html = buildPageHtml('Client Security Confirmation — Full Package', `Combined document — ${DATE}`, combinedBody, false);

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.emulateMediaType('print');

  const outPath = path.join(PDF_DIR, outName);
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:8pt;width:100%;text-align:center;color:#666;">' + CONFIDENTIAL + ' — <span class="pageNumber"></span></div>',
    margin: { top: '1.8cm', bottom: '1.6cm', left: '1.4cm', right: '1.4cm' },
  });
  await page.close();
  console.log('  ✓ Generated combined package', outName);
  return outPath;
}

async function main() {
  console.log('Generating client confirmation PDFs...');
  ensureDir(PDF_DIR);
  ensureDir(EVIDENCE_DIR);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    // Individuals
    const generated: string[] = [];
    for (const def of SECTIONS) {
      const safeId = def.id.replace(/[^a-z0-9-]/gi, '');
      const name = `${safeId}-${def.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
      const p = await generateOne(browser, def, name);
      generated.push(p);
    }

    // Cover
    const cover = await generateCover(browser, `00-cover-client-security-confirmation-${DATE}.pdf`);

    // Combined
    await generateCombined(browser, generated, cover, `Taxteck_Email_Auto_Client_Security_Confirmation_Package_${DATE}.pdf`);

    console.log('\nAll PDFs generated in', PDF_DIR);
    console.log('Include the raw audit report from evidence/ with the package.');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('PDF generation failed:', e);
  process.exit(1);
});