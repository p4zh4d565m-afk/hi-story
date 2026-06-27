/**
 * Minimal ZIP reader for EPUB parsing.
 * Supports only: store (0) and deflate (8) compression methods.
 */
import fs from 'fs';
import zlib from 'zlib';

export interface ZipEntry {
  name: string;
  isFile: boolean;
  getData(): Buffer;
}

/**
 * Read all entries from a ZIP file into a map keyed by path.
 * Parses the End of Central Directory → Central Directory → Local File Headers.
 */
export function readZip(filePath: string): Map<string, ZipEntry> {
  const buf = fs.readFileSync(filePath);
  const entries = new Map<string, ZipEntry>();

  // Find EOCD signature (0x06054b50) - search from end backwards
  const eocdOffset = findSignature(buf, 0x06054b50, true);
  if (eocdOffset === -1) throw new Error('Not a valid ZIP file');

  // EOCD offsets:
  // +8: total entries in central dir (2 bytes)
  // +12: offset of central dir (4 bytes)
  // +16: comment length (2 bytes)
  const totalEntries = buf.readUInt16LE(eocdOffset + 8);
  const CD_OFFSET = buf.readUInt32LE(eocdOffset + 12);

  let offset = CD_OFFSET;
  for (let i = 0; i < totalEntries; i++) {
    // Central directory file header signature: 0x02014b50
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x02014b50) throw new Error(`Unexpected CD signature at ${offset}: ${sig.toString(16)}`);

    // Offsets in CD header:
    // +10: compression method (2)
    // +24: compressed size (4)
    // +28: filename length (2)
    // +30: extra field length (2)
    // +32: comment length (2)
    // +42: local header offset (4)
    const compMethod = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const filenameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);

    const filename = buf.toString('utf8', offset + 46, offset + 46 + filenameLen);

    // Read local file header to get actual data offset
    // Local header: signature (4) + skip 26 + filename (n) + extra (m) → then data
    const localSig = buf.readUInt32LE(localOffset);
    if (localSig !== 0x04034b50) throw new Error(`Bad local header: ${localOffset}`);

    const localFilenameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localFilenameLen + localExtraLen;

    const isDir = filename.endsWith('/');
    const rawData = buf.slice(dataStart, dataStart + compSize);

    entries.set(filename, {
      name: filename,
      isFile: !isDir,
      getData(): Buffer {
        if (compMethod === 0) return rawData;
        if (compMethod === 8) return zlib.inflateRawSync(rawData);
        throw new Error(`Unsupported compression method: ${compMethod}`);
      },
    });

    offset += 46 + filenameLen + extraLen + commentLen;
  }

  return entries;
}

function findSignature(buf: Buffer, sig: number, fromEnd: boolean): number {
  const sigBuf = Buffer.alloc(4);
  sigBuf.writeUInt32LE(sig, 0);

  if (fromEnd) {
    for (let i = buf.length - 4; i >= 0; i--) {
      if (buf[i] === sigBuf[0] && buf.readUInt32LE(i) === sig) return i;
    }
  } else {
    for (let i = 0; i <= buf.length - 4; i++) {
      if (buf.readUInt32LE(i) === sig) return i;
    }
  }
  return -1;
}

/** Strip HTML tags and decode entities, returning plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
