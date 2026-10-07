// Plain phone numbers like "+234 803 555 0182" cannot call functions, so they are left readable.
const PHONE = /^\+[\d\s().-]+$/

/** Neutralizes spreadsheet formula injection (= + - @ tab CR) with a leading apostrophe. */
export function neutralizeFormula(value) {
  const text = value == null ? '' : String(value)
  return /^[=+\-@\t\r]/.test(text) && !PHONE.test(text) ? `'${text}` : text
}

// Quotes a CSV cell and neutralizes spreadsheet formula injection.
// Real numbers (such as a negative sort order) are not text a spreadsheet will evaluate, so they stay as written.
export function csvCell(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : neutralizeFormula(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Serializes rows (arrays of cell values) as RFC 4180 CSV with CRLF line ends and no trailing newline. */
export function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/** Picks the delimiter (comma, semicolon, tab) used most on the first line, ignoring quoted text. */
export function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  const source = String(text ?? '').replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '\n' || char === '\r')) break
    else if (!quoted && char in counts) counts[char] += 1
  }
  // Comma wins ties so single-column files stay comma separated.
  const best = [',', ';', '\t'].reduce((winner, char) => (counts[char] > counts[winner] ? char : winner), ',')
  return best
}

/**
 * RFC 4180 parser: quoted cells, escaped quotes (""), embedded newlines, CRLF or LF, leading BOM.
 * The delimiter is auto-detected (comma, semicolon, tab) unless passed. Returns string[][].
 * A trailing newline does not add a row. Unterminated quotes are accepted to the end of the text.
 */
export function parseCsv(text, delimiter) {
  const source = String(text ?? '').replace(/^\uFEFF/, '')
  const separator = delimiter || detectDelimiter(source)
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  let started = false
  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
    started = false
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"' && cell === '') {
      quoted = true
      started = true
    } else if (char === separator) {
      endCell()
      started = true
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      endRow()
    } else {
      cell += char
      started = true
    }
  }
  if (started || cell !== '' || row.length) endRow()
  return rows
}
