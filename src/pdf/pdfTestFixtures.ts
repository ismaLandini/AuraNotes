/**
 * Deterministic generator of spec-compliant PDF fixtures for unit and E2E testing:
 * 1. Vector & mathematical formulas PDF (multi-slide)
 * 2. Raster scan PDF (with embedded RGB Image XObject)
 * 3. Rotated pages PDF (0°, 90°, 180°, 270°)
 * 4. Mixed page dimensions & CropBox/UserUnit PDF
 * 5. Huge A0 poster PDF (2384 x 3370 pt)
 * 6. 100+ pages PDF (configurable, default 105 pages)
 * 7. Password-protected PDF (PDF 1.4 Standard Security Handler R2 40-bit RC4, password: "glassnote")
 * 8. Corrupt PDF
 */

export interface PdfPageSpec {
  width: number;
  height: number;
  cropBox?: [number, number, number, number];
  rotate?: 0 | 90 | 180 | 270;
  userUnit?: number;
  title?: string;
  formula?: string;
  accentColor?: [number, number, number];
  includeRasterImage?: boolean;
}

const PDF_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/** Pure JS MD5 implementation for PDF 1.4 Standard Security Handler key derivation. */
function md5(data: Uint8Array): Uint8Array {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const origLenBits = data.length * 8;
  const padLen = ((56 - ((data.length + 1) % 64)) + 64) % 64;
  const buf = new Uint8Array(data.length + 1 + padLen + 8);
  buf.set(data, 0);
  buf[data.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, origLenBits >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor(origLenBits / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < buf.length; offset += 64) {
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const word = dv.getUint32(offset + g * 4, true);
      F = (F + A + K[i] + word) >>> 0;
      A = D;
      D = C;
      C = B;
      const rot = ((F << S[i]) | (F >>> (32 - S[i]))) >>> 0;
      B = (B + rot) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, a0, true);
  outDv.setUint32(4, b0, true);
  outDv.setUint32(8, c0, true);
  outDv.setUint32(12, d0, true);
  return out;
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    const t = S[i];
    S[i] = S[j];
    S[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i];
    S[i] = S[j];
    S[j] = t;
    out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

function padPdfPassword(pwd: string): Uint8Array {
  const out = new Uint8Array(32);
  const len = Math.min(32, pwd.length);
  for (let i = 0; i < len; i++) out[i] = pwd.charCodeAt(i) & 0xff;
  if (len < 32) out.set(PDF_PADDING.subarray(0, 32 - len), len);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function escapePdfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Builds a complete, valid binary PDF document from page specifications.
 */
export function buildTestPdfBytes(
  pages: PdfPageSpec[],
  options?: { title?: string; password?: string },
): Uint8Array {
  const objects: Array<{ id: number; body: Uint8Array }> = [];
  const enc = new TextEncoder();

  // Object IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font (Helvetica)
  // 4: Font (Courier / Math)
  // 5..: Per-page objects
  const pageObjIds: number[] = [];
  let nextObjId = 5;

  const fileIdBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) fileIdBytes[i] = (0x41 + i * 7) & 0xff;

  let encryptionKey: Uint8Array | null = null;
  let encryptO: Uint8Array | null = null;
  let encryptU: Uint8Array | null = null;
  const P_VALUE = -4; // Revision 2 permissions

  if (options?.password) {
    const padded = padPdfPassword(options.password);
    const ownerKey = md5(padded).subarray(0, 5);
    encryptO = rc4(ownerKey, padded);

    const hashInput = new Uint8Array(32 + 32 + 4 + 16);
    hashInput.set(padded, 0);
    hashInput.set(encryptO, 32);
    const pDv = new DataView(hashInput.buffer);
    pDv.setInt32(64, P_VALUE, true);
    hashInput.set(fileIdBytes, 68);
    encryptionKey = md5(hashInput).subarray(0, 5);
    encryptU = rc4(encryptionKey, PDF_PADDING);
  }

  const encryptStreamForObj = (objId: number, plain: Uint8Array): Uint8Array => {
    if (!encryptionKey) return plain;
    const keyInput = new Uint8Array(encryptionKey.length + 5);
    keyInput.set(encryptionKey, 0);
    keyInput[encryptionKey.length] = objId & 0xff;
    keyInput[encryptionKey.length + 1] = (objId >>> 8) & 0xff;
    keyInput[encryptionKey.length + 2] = (objId >>> 16) & 0xff;
    keyInput[encryptionKey.length + 3] = 0;
    keyInput[encryptionKey.length + 4] = 0;
    const objKey = md5(keyInput).subarray(0, Math.min(16, encryptionKey.length + 5));
    return rc4(objKey, plain);
  };

  for (let idx = 0; idx < pages.length; idx++) {
    const spec = pages[idx];
    const pageObjId = nextObjId++;
    const contentObjId = nextObjId++;
    const xObjId = spec.includeRasterImage ? nextObjId++ : null;
    pageObjIds.push(pageObjId);

    const [r, g, b] = spec.accentColor ?? [0.15, 0.38, 0.85];
    const titleText = spec.title ?? `Slide ${idx + 1} di ${pages.length}`;
    const formulaText = spec.formula ?? `f(x) = sum_{n=1..inf} a_n cos(n*pi*x / L)   [Pag. ${idx + 1}]`;

    const ops: string[] = [
      'q',
      // White opaque page background
      '1 1 1 rg',
      `0 0 ${spec.width} ${spec.height} re f`,
      // Decorative vector header bar
      `${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)} rg`,
      `36 ${Math.max(40, spec.height - 84)} ${Math.max(60, spec.width - 72)} 38 re f`,
      // Vector coordinate axes & geometric diagram
      '0.2 0.25 0.35 RG',
      '2 w',
      '48 80 m',
      `${Math.max(100, spec.width - 48)} 80 l`,
      'S',
      '60 65 m',
      `60 ${Math.max(120, Math.min(spec.height - 100, 260))} l`,
      'S',
      // Vector curve (parabola / wave)
      `${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)} RG`,
      '2.5 w',
      '60 90 m',
      '140 210 220 210 300 95 c',
      'S',
      // Title text in header
      'BT',
      '/F1 16 Tf',
      '1 1 1 rg',
      `48 ${Math.max(52, spec.height - 70)} Td`,
      `(${escapePdfText(titleText)}) Tj`,
      'ET',
      // Mathematical formula block
      'BT',
      '/F2 13 Tf',
      '0.1 0.1 0.12 rg',
      `48 ${Math.max(30, spec.height - 125)} Td`,
      `(${escapePdfText(formulaText)}) Tj`,
      'ET',
      'Q',
    ];

    if (xObjId !== null) {
      ops.push('q', '120 0 0 90 340 100 cm', '/Im1 Do', 'Q');
      // Create a 4x3 RGB raster image stream (36 bytes)
      const pixels = new Uint8Array([
        255, 60, 60,   60, 180, 75,   60, 120, 255,  255, 200, 40,
        60, 180, 75,   255, 255, 255, 240, 240, 250, 60, 120, 255,
        60, 120, 255,  255, 200, 40,  255, 60, 60,   60, 180, 75,
      ]);
      const encryptedPixels = encryptStreamForObj(xObjId, pixels);
      const xHead = enc.encode(
        `<< /Type /XObject /Subtype /Image /Width 4 /Height 3 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${encryptedPixels.length} >>\nstream\n`,
      );
      const xTail = enc.encode('\nendstream');
      const xBody = new Uint8Array(xHead.length + encryptedPixels.length + xTail.length);
      xBody.set(xHead, 0);
      xBody.set(encryptedPixels, xHead.length);
      xBody.set(xTail, xHead.length + encryptedPixels.length);
      objects.push({ id: xObjId, body: xBody });
    }

    const streamPlain = enc.encode(ops.join('\n'));
    const streamData = encryptStreamForObj(contentObjId, streamPlain);
    const sHead = enc.encode(`<< /Length ${streamData.length} >>\nstream\n`);
    const sTail = enc.encode('\nendstream');
    const sBody = new Uint8Array(sHead.length + streamData.length + sTail.length);
    sBody.set(sHead, 0);
    sBody.set(streamData, sHead.length);
    sBody.set(sTail, sHead.length + streamData.length);
    objects.push({ id: contentObjId, body: sBody });

    const cropBoxStr = spec.cropBox
      ? ` /CropBox [${spec.cropBox.join(' ')}]`
      : '';
    const rotateStr = spec.rotate ? ` /Rotate ${spec.rotate}` : '';
    const userUnitStr = spec.userUnit ? ` /UserUnit ${spec.userUnit}` : '';
    const xObjRes = xObjId !== null ? ` /XObject << /Im1 ${xObjId} 0 R >>` : '';

    const pageDict = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${spec.width} ${spec.height}]${cropBoxStr}${rotateStr}${userUnitStr} /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xObjRes} >> /Contents ${contentObjId} 0 R >>`;
    objects.push({ id: pageObjId, body: enc.encode(pageDict) });
  }

  let infoObjId: number | null = null;
  if (options?.title && !encryptionKey) {
    infoObjId = nextObjId++;
    objects.push({
      id: infoObjId,
      body: enc.encode(`<< /Title (${escapePdfText(options.title)}) >>`),
    });
  }

  let encryptObjId: number | null = null;
  if (encryptionKey && encryptO && encryptU) {
    encryptObjId = nextObjId++;
    objects.push({
      id: encryptObjId,
      body: enc.encode(
        `<< /Filter /Standard /V 1 /R 2 /Length 40 /P ${P_VALUE} /O <${toHex(encryptO)}> /U <${toHex(encryptU)}> >>`,
      ),
    });
  }

  // Standard objects 1..4
  objects.push({ id: 1, body: enc.encode('<< /Type /Catalog /Pages 2 0 R >>') });
  objects.push({
    id: 2,
    body: enc.encode(
      `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`,
    ),
  });
  objects.push({
    id: 3,
    body: enc.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  });
  objects.push({
    id: 4,
    body: enc.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'),
  });

  objects.sort((a, b) => a.id - b.id);

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    offset += b.length;
  };
  const pushStr = (s: string) => pushBytes(enc.encode(s));

  pushStr('%PDF-1.6\n%\x80\x81\x82\x83\n');

  const offsets = new Map<number, number>();
  for (const obj of objects) {
    offsets.set(obj.id, offset);
    pushStr(`${obj.id} 0 obj\n`);
    pushBytes(obj.body);
    pushStr('\nendobj\n');
  }

  const xrefOffset = offset;
  const maxObjId = objects[objects.length - 1].id;
  pushStr(`xref\n0 ${maxObjId + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id <= maxObjId; id++) {
    const off = offsets.get(id) ?? 0;
    pushStr(`${String(off).padStart(10, '0')} 00000 n \n`);
  }

  const fileIdHex = toHex(fileIdBytes);
  const infoRef = infoObjId ? ` /Info ${infoObjId} 0 R` : '';
  const encryptRef = encryptObjId ? ` /Encrypt ${encryptObjId} 0 R` : '';
  pushStr(
    `trailer\n<< /Size ${maxObjId + 1} /Root 1 0 R${infoRef}${encryptRef} /ID [<${fileIdHex}> <${fileIdHex}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  const total = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) {
    total.set(c, pos);
    pos += c.length;
  }
  return total;
}

export function createVectorFormulasPdf(pageCount = 4): Uint8Array {
  const formulas = [
    'E = m * c^2   |   nabla x B = mu_0 * J + mu_0 * eps_0 * dE/dt',
    'int_{-inf}^{+inf} exp(-x^2) dx = sqrt(pi)',
    'det(A - lambda * I) = 0   |   e^{i * pi} + 1 = 0',
    'H(p, q) = sum_i (p_i * dq_i) - L(q, dq/dt, t)',
  ];
  return buildTestPdfBytes(
    Array.from({ length: pageCount }, (_, i) => ({
      width: 720, // 16:9 widescreen slide (10 x 5.625 in)
      height: 405,
      title: `Lezione di Fisica Matematica - Slide ${i + 1}`,
      formula: formulas[i % formulas.length],
      accentColor: [0.12 + (i % 3) * 0.2, 0.35, 0.78 - (i % 2) * 0.2],
    })),
    { title: 'Lezione Fisica Matematica' },
  );
}

export function createRasterScanPdf(): Uint8Array {
  return buildTestPdfBytes(
    [
      {
        width: 595,
        height: 842,
        title: 'Dispensa Scansionata - Pagina 1',
        includeRasterImage: true,
      },
      {
        width: 595,
        height: 842,
        title: 'Dispensa Scansionata - Pagina 2',
        includeRasterImage: true,
      },
    ],
    { title: 'Dispensa Scansionata' },
  );
}

export function createRotatedPagesPdf(): Uint8Array {
  const rotations: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  return buildTestPdfBytes(
    rotations.map((rot, idx) => ({
      width: 595,
      height: 842,
      rotate: rot,
      title: `Pagina ${idx + 1} ruotata di ${rot} gradi`,
    })),
    { title: 'Pagine Ruotate' },
  );
}

export function createMixedSizesPdf(): Uint8Array {
  return buildTestPdfBytes(
    [
      { width: 595, height: 842, title: 'Formato A4 Verticale (595x842 pt)' },
      { width: 842, height: 595, title: 'Formato A4 Orizzontale (842x595 pt)' },
      { width: 960, height: 540, title: 'Slide 16:9 (960x540 pt)' },
      { width: 600, height: 800, cropBox: [50, 50, 550, 750], title: 'Pagina con CropBox (500x700 pt effettivi)' },
    ],
    { title: 'Formati Misti' },
  );
}

export function createHugeA0PosterPdf(): Uint8Array {
  // Standard ISO A0: 841 x 1189 mm = 2384 x 3370 pt
  return buildTestPdfBytes(
    [
      {
        width: 2384,
        height: 3370,
        title: 'Poster Scientifico Formato A0 (841 x 1189 mm)',
        formula: 'R_{mu nu} - (1/2) R g_{mu nu} + Lambda g_{mu nu} = (8 pi G / c^4) T_{mu nu}',
      },
    ],
    { title: 'Poster A0' },
  );
}

export function createManyPagesPdf(count = 105): Uint8Array {
  return buildTestPdfBytes(
    Array.from({ length: count }, (_, i) => ({
      width: 595,
      height: 842,
      title: `Dispensa Completa - Capitolo ${Math.floor(i / 10) + 1} - Pagina ${i + 1} di ${count}`,
      formula: `Teorema ${i + 1}.1: lim_{n->inf} (1 + x/n)^n = exp(x)`,
    })),
    { title: `Dispensa ${count} Pagine` },
  );
}

export function createPasswordProtectedPdf(password = 'glassnote'): Uint8Array {
  return buildTestPdfBytes(
    [
      {
        width: 595,
        height: 842,
        title: 'Esame Riservato - Pagina 1',
        formula: 'Soluzione esercizio 1: x(t) = A cos(omega * t + phi)',
      },
      {
        width: 595,
        height: 842,
        title: 'Esame Riservato - Pagina 2',
        formula: 'Soluzione esercizio 2: E_n = -13.6 eV / n^2',
      },
    ],
    { title: 'Esame Protetto', password },
  );
}

export function createCorruptPdf(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Broken /Corrupt >>>>\nstartxref\n999999\n%%EOF');
}

export function pdfBytesToFile(bytes: Uint8Array, fileName = 'test.pdf'): File {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (typeof File !== 'undefined') {
    return new File([ab], fileName, { type: 'application/pdf' });
  }
  const blob = new Blob([ab], { type: 'application/pdf' }) as File;
  Object.defineProperty(blob, 'name', { value: fileName });
  return blob;
}

