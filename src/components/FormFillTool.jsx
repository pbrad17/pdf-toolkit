import { useState, useEffect } from 'react'
import { useAppContext } from '../AppContext'
import { PDFDocument, StandardFonts } from 'pdf-lib'

export default function FormFillTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()

  const [fields, setFields] = useState([]) // [{ name, type, value, options }]
  const [fieldValues, setFieldValues] = useState({}) // { name: value }
  const [status, setStatus] = useState('')
  const [scanning, setScanning] = useState(false)

  // Scan for form fields when documents change
  useEffect(() => {
    if (documents.length === 0) {
      setFields([])
      setFieldValues({})
      setStatus('')
      return
    }
    let cancelled = false
    setScanning(true)
    ;(async () => {
      const allFields = []
      for (const doc of documents) {
        try {
          const pdfDoc = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
          const form = pdfDoc.getForm()
          for (const field of form.getFields()) {
            const name = field.getName()
            const constructor = field.constructor.name
            let type = 'unknown'
            let value = ''
            let options = []

            if (constructor === 'PDFTextField') {
              type = 'text'
              value = field.getText() || ''
            } else if (constructor === 'PDFCheckBox') {
              type = 'checkbox'
              value = field.isChecked()
            } else if (constructor === 'PDFDropdown') {
              type = 'dropdown'
              options = field.getOptions()
              const selected = field.getSelected()
              value = selected.length > 0 ? selected[0] : ''
            } else if (constructor === 'PDFRadioGroup') {
              type = 'radio'
              options = field.getOptions()
              value = field.getSelected() || ''
            } else {
              continue // skip buttons, signatures, etc.
            }

            allFields.push({ name, type, value, options, docId: doc.id })
          }
        } catch { /* no form */ }
      }
      if (!cancelled) {
        setFields(allFields)
        const vals = {}
        for (const f of allFields) vals[f.name] = f.value
        setFieldValues(vals)
        setScanning(false)
      }
    })()
    return () => { cancelled = true }
  }, [documents])

  const updateField = (name, value) => {
    setFieldValues(prev => ({ ...prev, [name]: value }))
  }

  const handleFillAndDownload = async () => {
    if (documents.length === 0) return
    setIsProcessing(true)
    setStatus('Filling form fields...')
    try {
      // Load the first document (form filling works on original bytes)
      // For multi-doc, we fill each doc and then would need to merge
      // Simplification: fill the first document that has form fields
      const docWithFields = documents.find(d =>
        fields.some(f => f.docId === d.id)
      )
      if (!docWithFields) {
        setStatus('No fillable fields found.')
        return
      }

      const pdfDoc = await PDFDocument.load(docWithFields.bytes)
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      const form = pdfDoc.getForm()

      for (const fieldDef of fields) {
        if (fieldDef.docId !== docWithFields.id) continue
        const val = fieldValues[fieldDef.name]
        try {
          if (fieldDef.type === 'text') {
            const f = form.getTextField(fieldDef.name)
            f.setText(val || '')
          } else if (fieldDef.type === 'checkbox') {
            const f = form.getCheckBox(fieldDef.name)
            if (val) f.check(); else f.uncheck()
          } else if (fieldDef.type === 'dropdown') {
            const f = form.getDropdown(fieldDef.name)
            if (val) f.select(val); else f.clear()
          } else if (fieldDef.type === 'radio') {
            const f = form.getRadioGroup(fieldDef.name)
            if (val) f.select(val); else f.clear()
          }
        } catch { /* skip fields that can't be filled */ }
      }

      form.updateFieldAppearances(font)
      const filledBytes = await pdfDoc.save()

      const blob = new Blob([filledBytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'filled.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! Filled PDF downloaded.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  if (documents.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  const fillableFields = fields.filter(f => f.type !== 'unknown')

  return (
    <div className="max-w-lg">
      <div className="bg-dark-bg border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-3">Fill Form Fields</h3>
        <p className="text-sm text-steel-blue mb-4">
          Edit form field values below, then download the filled PDF.
        </p>

        {scanning && (
          <p className="text-sm text-steel-blue mb-4">Scanning for form fields...</p>
        )}

        {!scanning && fillableFields.length === 0 && (
          <p className="text-sm text-steel-blue mb-4">No fillable form fields found in the loaded PDFs.</p>
        )}

        {fillableFields.length > 0 && (
          <div className="space-y-3 max-h-96 overflow-auto mb-4 pr-1">
            {fillableFields.map((f) => (
              <div key={f.name} className="p-3 rounded bg-alt-bg border border-border-light">
                <label className="text-xs font-medium text-steel-blue block mb-1 truncate" title={f.name}>
                  {f.name}
                  <span className="ml-1 text-[10px] opacity-60">({f.type})</span>
                </label>

                {f.type === 'text' && (
                  <input
                    type="text"
                    value={fieldValues[f.name] || ''}
                    onChange={(e) => updateField(f.name, e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                  />
                )}

                {f.type === 'checkbox' && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!fieldValues[f.name]}
                      onChange={(e) => updateField(f.name, e.target.checked)}
                      className="accent-accent"
                    />
                    <span className="text-sm">{fieldValues[f.name] ? 'Checked' : 'Unchecked'}</span>
                  </label>
                )}

                {f.type === 'dropdown' && (
                  <select
                    value={fieldValues[f.name] || ''}
                    onChange={(e) => updateField(f.name, e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                  >
                    <option value="">— Select —</option>
                    {f.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}

                {f.type === 'radio' && (
                  <div className="space-y-1">
                    {f.options.map(opt => (
                      <label key={opt} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={f.name}
                          checked={fieldValues[f.name] === opt}
                          onChange={() => updateField(f.name, opt)}
                          className="accent-accent"
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleFillAndDownload}
          disabled={isProcessing || fillableFields.length === 0}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Fill & Download'}
        </button>
        {status && <p className="text-sm text-steel-blue mt-3">{status}</p>}
      </div>
    </div>
  )
}
