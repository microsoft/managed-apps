/**
 * Minimal ZIP writer (STORE / no compression).
 *
 * The app ships the Chromium extension as loose files under `public/extension`
 * and packs them into an archive in the browser at download time, so there is
 * no build step and no binary blob committed to the repo. Extension payloads
 * are tiny (~150 KB), so skipping DEFLATE keeps this dependency-free.
 */

export interface ZipEntry {
  /** Path inside the archive, using forward slashes. */
  path: string;
  data: Uint8Array<ArrayBuffer>;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Writes little-endian integers into a growing byte array. */
class ByteWriter {
  private parts: Uint8Array<ArrayBuffer>[] = [];
  length = 0;

  u16(value: number) {
    this.raw(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number) {
    this.raw(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  raw(bytes: Uint8Array<ArrayBuffer>) {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  chunks(): Uint8Array<ArrayBuffer>[] {
    return this.parts;
  }
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** DOS timestamp for 1980-01-01 00:00, so archives are byte-for-byte stable. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
/** Bit 11 marks file names as UTF-8. */
const FLAG_UTF8 = 0x0800;

/**
 * Builds a ZIP archive from the given entries. Entries are stored uncompressed.
 */
export function createZip(entries: readonly ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const local = new ByteWriter();
  const central = new ByteWriter();
  const offsets: number[] = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    offsets.push(local.length);

    local.u32(LOCAL_SIG);
    local.u16(20);
    local.u16(FLAG_UTF8);
    local.u16(0);
    local.u16(DOS_TIME);
    local.u16(DOS_DATE);
    local.u32(crc);
    local.u32(entry.data.length);
    local.u32(entry.data.length);
    local.u16(name.length);
    local.u16(0);
    local.raw(name);
    local.raw(entry.data);

    central.u32(CENTRAL_SIG);
    central.u16(20);
    central.u16(20);
    central.u16(FLAG_UTF8);
    central.u16(0);
    central.u16(DOS_TIME);
    central.u16(DOS_DATE);
    central.u32(crc);
    central.u32(entry.data.length);
    central.u32(entry.data.length);
    central.u16(name.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(offsets[offsets.length - 1]);
    central.raw(name);
  }

  const eocd = new ByteWriter();
  eocd.u32(EOCD_SIG);
  eocd.u16(0);
  eocd.u16(0);
  eocd.u16(entries.length);
  eocd.u16(entries.length);
  eocd.u32(central.length);
  eocd.u32(local.length);
  eocd.u16(0);

  return new Blob([...local.chunks(), ...central.chunks(), ...eocd.chunks()], {
    type: 'application/zip',
  });
}
