/** When vendor master row has no TO, or after a reply, show contact email from the response chain. */

export type MsmeEmailDisplayInfo = {
  /** May include comma-separated outbound addresses */
  text: string;
  fromReply: boolean;
};

export function effectiveMsmeContactEmail(record: {
  emailTo?: string | null;
  responseFromEmail?: string | null;
  responsesJson?: string | null;
}): MsmeEmailDisplayInfo {
  const to = record.emailTo?.trim();
  if (to) return { text: to, fromReply: false };

  const fromTop = record.responseFromEmail?.trim();
  if (fromTop) return { text: fromTop, fromReply: true };

  if (record.responsesJson?.trim()) {
    try {
      const arr = JSON.parse(record.responsesJson) as Array<{ fromEmail?: string | null }>;
      for (let i = arr.length - 1; i >= 0; i--) {
        const e = arr[i]?.fromEmail?.trim();
        if (e) return { text: e, fromReply: true };
      }
    } catch {
      /* ignore */
    }
  }
  return { text: '', fromReply: false };
}
