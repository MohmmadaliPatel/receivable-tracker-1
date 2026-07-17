import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { fetchConfirmationOrForbidden } from '@/lib/confirmation-record-auth';
import { getOrCreateSettings } from '@/lib/confirmation-service';
import { EmailConfigService } from '@/lib/email-config-service';
import { GraphMailService } from '@/lib/graph-mail-service';

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

type ResponseEntry = {
  messageId?: string;
  attachmentsJson?: string | null;
};

type AttItem = {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  savedPath?: string;
};

function parseAttachmentList(json: string | null | undefined): AttItem[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? (arr as AttItem[]) : [];
  } catch {
    return [];
  }
}

function contentDispositionHeader(disposition: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '') || 'file';
  const encoded = encodeURIComponent(filename);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function binaryFileResponse(
  buf: Buffer,
  contentType: string,
  disposition: 'inline' | 'attachment',
  filename: string
): NextResponse {
  const body = new Uint8Array(buf);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': contentDispositionHeader(disposition, filename),
      'Content-Length': String(body.byteLength),
    },
  });
}

// GET /api/confirmations/[id]/response-attachment?attachmentId=…&responseIndex=…&inline=1
// Serves inbox reply attachments from disk when saved during reply check, else from Graph.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const attachmentId = request.nextUrl.searchParams.get('attachmentId');
    if (!attachmentId) return NextResponse.json({ error: 'attachmentId required' }, { status: 400 });

    const responseIndexParam = request.nextUrl.searchParams.get('responseIndex');
    const inline = request.nextUrl.searchParams.get('inline') === '1';

    const gate = await fetchConfirmationOrForbidden(user, id);
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.status === 404 ? 'Not found' : 'Forbidden' },
        { status: gate.status }
      );
    }
    const record = gate.record;

    let responses: ResponseEntry[] = [];
    if (record.responsesJson?.trim()) {
      try {
        responses = JSON.parse(record.responsesJson) as ResponseEntry[];
        if (!Array.isArray(responses)) responses = [];
      } catch {
        responses = [];
      }
    }

    let idx: number;
    if (responses.length > 0) {
      if (responseIndexParam !== null && responseIndexParam !== '') {
        idx = parseInt(responseIndexParam, 10);
        if (Number.isNaN(idx) || idx < 0 || idx >= responses.length) {
          return NextResponse.json({ error: 'Invalid responseIndex' }, { status: 400 });
        }
      } else {
        idx = responses.length - 1;
      }
    } else {
      idx = -1;
    }

    let messageId: string | null = null;
    if (idx >= 0 && responses[idx]) {
      messageId = responses[idx].messageId?.trim() || null;
    }
    messageId = messageId || record.responseMessageId || null;

    let attachmentMeta: AttItem | null = null;
    if (idx >= 0 && responses[idx]?.attachmentsJson) {
      attachmentMeta =
        parseAttachmentList(responses[idx].attachmentsJson).find((a) => a.id === attachmentId) ?? null;
    }
    if (!attachmentMeta && record.responseAttachmentsJson) {
      attachmentMeta =
        parseAttachmentList(record.responseAttachmentsJson).find((a) => a.id === attachmentId) ?? null;
    }

    if (attachmentMeta?.savedPath) {
      if (!fs.existsSync(attachmentMeta.savedPath)) {
        // Fall through to Graph if we still have a messageId; otherwise clear 404.
        if (!messageId) {
          return NextResponse.json(
            { error: 'Certificate file not found on server' },
            { status: 404 }
          );
        }
      } else {
        const settings = await getOrCreateSettings(user.userId);
        const emailsRoot = path.resolve(process.cwd(), settings.emailSaveBasePath || 'emails');
        const resolved = path.resolve(attachmentMeta.savedPath);
        const rootWithSep = path.normalize(emailsRoot + path.sep);
        const normalizedFile = path.normalize(resolved);
        if (!normalizedFile.startsWith(rootWithSep)) {
          return NextResponse.json({ error: 'Invalid attachment path' }, { status: 400 });
        }
        const buf = fs.readFileSync(resolved);
        const name = attachmentMeta.name || path.basename(resolved);
        const isPdf =
          name.toLowerCase().endsWith('.pdf') ||
          (attachmentMeta.contentType || '').toLowerCase().includes('pdf');
        const disposition = inline && isPdf ? 'inline' : 'attachment';
        const ct =
          attachmentMeta.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream');
        return binaryFileResponse(buf, ct, disposition, name);
      }
    }

    if (!messageId) {
      return NextResponse.json({ error: 'No response message for this attachment' }, { status: 404 });
    }

    const config = record.emailConfigId
      ? await EmailConfigService.getConfigById(record.emailConfigId)
      : await EmailConfigService.getActiveConfig();
    if (!config) return NextResponse.json({ error: 'No email config' }, { status: 404 });

    const accessToken = await GraphMailService.getAccessToken(config);
    const attRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.fromEmail)}/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!attRes.ok) {
      const errBody = await attRes.text();
      return NextResponse.json({ error: `Graph error: ${errBody}` }, { status: attRes.status });
    }

    const attData = (await attRes.json()) as {
      contentBytes?: string;
      contentType?: string;
      name?: string;
    };
    const contentBytes = attData.contentBytes;
    if (!contentBytes) {
      return NextResponse.json({ error: 'No attachment bytes from Graph' }, { status: 502 });
    }
    const contentType = attData.contentType || 'application/octet-stream';
    const name = attData.name || 'attachment';
    const buffer = Buffer.from(contentBytes, 'base64');
    const isPdf = name.toLowerCase().endsWith('.pdf') || contentType.toLowerCase().includes('pdf');
    const disposition = inline && isPdf ? 'inline' : 'attachment';
    return binaryFileResponse(buffer, contentType, disposition, name);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch attachment';
    console.error('[response-attachment]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
