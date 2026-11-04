import { describe, it, expect } from 'vitest';
import { createZip, crc32 } from '../zip';

const enc = new TextEncoder();

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function readU32(data: Uint8Array, at: number): number {
  return (data[at] | (data[at + 1] << 8) | (data[at + 2] << 16) | (data[at + 3] << 24)) >>> 0;
}

function readU16(data: Uint8Array, at: number): number {
  return data[at] | (data[at + 1] << 8);
}

describe('crc32', () => {
  it('matches the well-known checksum for "123456789"', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('createZip', () => {
  it('writes local headers, a central directory, and an EOCD record', async () => {
    const blob = createZip([
      { path: 'ext/manifest.json', data: enc.encode('{"a":1}') },
      { path: 'ext/assets/logo.svg', data: enc.encode('<svg/>') },
    ]);
    const data = await bytes(blob);

    expect(blob.type).toBe('application/zip');
    expect(readU32(data, 0)).toBe(0x04034b50);

    const eocdAt = data.length - 22;
    expect(readU32(data, eocdAt)).toBe(0x06054b50);
    expect(readU16(data, eocdAt + 8)).toBe(2);
    expect(readU16(data, eocdAt + 10)).toBe(2);

    const cdOffset = readU32(data, eocdAt + 16);
    const cdSize = readU32(data, eocdAt + 12);
    expect(readU32(data, cdOffset)).toBe(0x02014b50);
    expect(cdOffset + cdSize).toBe(eocdAt);
  });

  it('stores entry names and uncompressed contents verbatim', async () => {
    const content = 'hello extension';
    const data = await bytes(createZip([{ path: 'ext/readme.txt', data: enc.encode(content) }]));
    const text = new TextDecoder().decode(data);

    expect(text).toContain('ext/readme.txt');
    expect(text).toContain(content);
    // Method 0 == stored.
    expect(readU16(data, 8)).toBe(0);
    // Compressed and uncompressed sizes match for stored entries.
    expect(readU32(data, 18)).toBe(content.length);
    expect(readU32(data, 22)).toBe(content.length);
    expect(readU32(data, 14)).toBe(crc32(enc.encode(content)));
  });

  it('records the UTF-8 name flag so non-ASCII paths survive', async () => {
    const data = await bytes(createZip([{ path: 'ext/café.txt', data: enc.encode('x') }]));
    expect(readU16(data, 6)).toBe(0x0800);
  });

  it('produces a valid empty archive', async () => {
    const data = await bytes(createZip([]));
    expect(data.length).toBe(22);
    expect(readU32(data, 0)).toBe(0x06054b50);
  });

  it('is deterministic across calls', async () => {
    const make = () => createZip([{ path: 'a.txt', data: enc.encode('same') }]);
    expect(await bytes(make())).toEqual(await bytes(make()));
  });
});
