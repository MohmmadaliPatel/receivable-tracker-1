/** Shared columns for CSV export/import round-trip (Trade Payables & Trade Receivables). */
export const ROUND_TRIP_HEADERS = [
  'id',
  'Entity Name',
  'Email TO',
  'Email CC',
  'Bank Name',
  'Account Number',
  'Cust ID',
  'Remarks',
] as const;

export type RoundTripRow = {
  id?: string;
  entityName: string;
  emailTo: string;
  emailCc: string;
  bankName: string;
  accountNumber: string;
  custId: string;
  remarks: string;
};

function getCol(row: Record<string, string>, exact: string[]): string {
  for (const e of exact) {
    if (row[e] != null && String(row[e]).trim() !== '') return String(row[e]).trim();
  }
  const keys = Object.keys(row);
  for (const want of exact) {
    const w = want.toLowerCase();
    const k = keys.find((x) => x.toLowerCase().trim() === w);
    if (k && row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  for (const want of exact) {
    const w = want.toLowerCase();
    for (const [k, v] of Object.entries(row)) {
      if (k.toLowerCase().includes(w) && v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

export function mapRoundTripCsvRow(row: Record<string, string>): RoundTripRow | null {
  const entityName = getCol(row, ['Entity Name', 'entity name', 'Customer Name']);
  const emailTo = getCol(row, ['Email TO', 'email to']);
  const id = getCol(row, ['id', 'Id']);
  if (!entityName && !id) return null;
  return {
    id: id || undefined,
    entityName: entityName || '',
    emailTo,
    emailCc: getCol(row, ['Email CC', 'email cc']),
    bankName: getCol(row, ['Bank Name', 'bank name']),
    accountNumber: getCol(row, ['Account Number', 'account no', 'Account No']),
    custId: getCol(row, ['Cust ID', 'customer id', 'cust id']),
    remarks: getCol(row, ['Remarks', 'remarks', 'Query/Remarks']),
  };
}
