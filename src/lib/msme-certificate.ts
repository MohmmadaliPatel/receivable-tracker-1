/** Shared MSME certificate attachment detection (UI + reply processing). */

export function isMsmeCertificateAttachment(name: string, contentType?: string): boolean {
  const lower = (name || '').toLowerCase();
  const ct = (contentType || '').toLowerCase();
  if (lower.endsWith('.pdf') || ct.includes('pdf')) return true;
  if (lower.match(/\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff)$/) || ct.startsWith('image/')) return true;
  if (lower.match(/\.(doc|docx|xls|xlsx)$/) || ct.includes('word') || ct.includes('spreadsheet')) return true;
  if (lower.includes('msme') || lower.includes('certificate') || lower.includes('udyam')) return true;
  return false;
}

type AttachmentLike = { name?: string; contentType?: string };

export function parseAttachmentList(json: string | null | undefined): AttachmentLike[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? (arr as AttachmentLike[]) : [];
  } catch {
    return [];
  }
}

export function attachmentsIncludeMsmeCertificate(json: string | null | undefined): boolean {
  return parseAttachmentList(json).some((a) => isMsmeCertificateAttachment(a.name || '', a.contentType));
}
