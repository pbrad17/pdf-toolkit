import { useState, useRef } from 'react'
import { useAppContext } from '../AppContext'

export default function UploadZone() {
  const { addDocument, isProcessing } = useAppContext()
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef()

  const handleFiles = async (files) => {
    for (const file of files) {
      if (file.type === 'application/pdf') {
        await addDocument(file)
      }
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const onDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onClick={() => !isProcessing && inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
        dragOver
          ? 'border-accent bg-accent/10'
          : 'border-border hover:border-steel-blue'
      } ${isProcessing ? 'opacity-50 cursor-wait' : ''}`}
    >
      <svg className="mx-auto mb-4" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <p className="text-lg font-medium mb-1">
        {isProcessing ? 'Processing...' : 'Drop PDF files here'}
      </p>
      <p className="text-sm text-steel-blue">or click to browse</p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  )
}
