/**
 * Handing finished bytes to the browser.
 *
 * This is only the delivery step — it takes bytes that buildPdf already
 * produced. Nothing here builds a PDF, and nothing that builds a PDF should
 * live anywhere but the export pass.
 */

/** Strip characters that Windows and macOS reject in a filename. */
export function safeFileName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'document'
}

/** Trigger a download of PDF bytes under the given filename. */
export function downloadPdf(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked well after the click so the download has taken its own reference;
  // revoking immediately loses the file in Safari and in Firefox under load.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
