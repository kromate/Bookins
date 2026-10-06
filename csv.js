// Plain phone numbers like "+234 803 555 0182" cannot call functions, so they are left readable.
const PHONE = /^\+[\d\s().-]+$/

// Quotes a CSV cell and neutralizes spreadsheet formula injection (= + - @ tab CR).
export function csvCell(value) {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text) && !PHONE.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
