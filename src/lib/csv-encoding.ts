/** RFC 4180-style: commas inside double-quoted fields do not split columns. */
export function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let i = 0;
  let inQuotes = false;

  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += c;
      i += 1;
    } else {
      if (c === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (c === ',') {
        fields.push(current.trim());
        current = '';
        i += 1;
        continue;
      }
      current += c;
      i += 1;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = parseCSVRow(headerLine).map((h) => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map((line) => {
    const values = parseCSVRow(line).map((v) => v.replace(/^"|"$/g, '').trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

export function escapeCsvCell(cell: unknown): string {
  const s = String(cell ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}
