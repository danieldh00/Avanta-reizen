// @ts-check
/**
 * Eenvoudige Excel-export (.xlsx, Office Open XML) zonder extra pakket: een werkmap met één of meer bladen, tekst als
 * inline strings en getallen als getal, de eerste rij vet als kop. Het zip-bestand wordt hier zelf opgebouwd (deflate en
 * CRC-32 uit `node:zlib`). Elke cel gaat door XML-escaping; tekst die met `=`, `+`, `-` of `@` begint krijgt een
 * apostrof ervoor, zodat Excel er nooit een formule van maakt (CSV/formule-injectie).
 */
const zlib = require('node:zlib');

/** Tekens die in XML 1.0 niet mogen (stuurtekens behalve tab en regeleinden). */
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/**
 * Escapet tekst voor XML.
 * @param {*} value Waarde.
 * @returns {string} Veilige tekst.
 */
function escapeXml(value) {
  return String(value ?? '').replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Maakt van tekst die Excel als formule zou lezen gewone tekst.
 * @param {string} text Tekst.
 * @returns {string} Tekst, met een apostrof ervoor als die met `=`, `+`, `-`, `@`, tab of regeleinde begint.
 */
function defuseFormula(text) {
  return /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
}

/**
 * Kolomletter(s) bij een kolomnummer (0 = A).
 * @param {number} index Kolomnummer.
 * @returns {string} Letters.
 */
function columnName(index) {
  let name = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  return name;
}

/**
 * XML van één werkblad.
 * @param {Array<Array<(string|number|null|undefined)>>} rows Rijen; de eerste rij is de kop (vet).
 * @returns {string} XML.
 */
function sheetXml(rows) {
  const widths = [];
  rows.forEach((row) => row.forEach((value, column) => { widths[column] = Math.min(Math.max(widths[column] || 8, String(value ?? '').length + 2), 60); }));
  const cols = widths.length ? `<cols>${widths.map((width, column) => `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, column) => {
      const ref = `${columnName(column)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? ' s="1"' : '';
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
      if (value === null || value === undefined || value === '') return '';
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(defuseFormula(String(value)))}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Bouwt een zip-bestand (deflate) van de gegeven bestanden.
 * @param {Array<{name: string, data: string}>} files Bestanden met naam en inhoud (UTF-8).
 * @returns {Buffer} Het zip-bestand.
 */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.data, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8-namen
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // tijd en datum (niet nodig)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * Maakt een .xlsx-bestand.
 * @param {Array<{name: string, rows: Array<Array<(string|number|null|undefined)>>}>} sheets Bladen met naam (hoogstens
 *   31 tekens, zonder `[]:*?/\`) en rijen.
 * @returns {Buffer} Het bestand.
 */
function createXlsx(sheets) {
  const names = sheets.map((sheet, index) => String(sheet.name || `Blad${index + 1}`).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31));
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet.rows) })),
  ];
  return zip(files);
}

module.exports = { createXlsx, escapeXml, defuseFormula, columnName, XLSX_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
