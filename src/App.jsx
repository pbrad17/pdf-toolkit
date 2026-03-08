import { AppProvider, useAppContext } from './AppContext'
import UploadZone from './components/UploadZone'
import ManagePages from './components/ManagePages'
import FlattenForms from './components/FlattenForms'
import ExtractPages from './components/ExtractPages'
import AnnotateEditor from './components/AnnotateEditor'
import SignaturePad from './components/SignaturePad'
import PreviewModal from './components/PreviewModal'
import PageGrid from './components/PageGrid'
import { buildFinalPdf } from './utils/pdfOperations'

const TOOLS = [
  { id: 'upload', label: 'Upload', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12' },
  { id: 'manage', label: 'Manage', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'extract', label: 'Extract', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z' },
  { id: 'annotate', label: 'Annotate', icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' },
  { id: 'signature', label: 'Signature', icon: 'M20 19.5c-1 .5-2.68.86-4 .86-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6c0 .81-.16 1.59-.44 2.3 M2 21l1.5-4.5L17 3l3 3L6.5 19.5z' },
  { id: 'flatten', label: 'Flatten', icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z' },
]

function ThemeToggle() {
  const { theme, toggleTheme } = useAppContext()
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-dark-bg/50 border border-border hover:border-accent transition-colors"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  )
}

function AppContent() {
  const { activeTool, setActiveTool, pages, documents, annotations, isProcessing, setIsProcessing } = useAppContext()

  const handleDownload = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    try {
      const bytes = await buildFinalPdf(documents, pages, annotations)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = documents.length === 1 ? documents[0].name : 'combined.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="min-h-screen bg-title-bg text-text-primary flex flex-col">
      {/* Header */}
      <div className="bg-section-bg border-b-2 border-accent px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="8" y="4" width="24" height="32" rx="2" stroke="currentColor" strokeWidth="2.5" fill="none"/>
              <path d="M32 4l8 8v28a2 2 0 0 1-2 2H8" stroke="currentColor" strokeWidth="2.5" fill="none"/>
              <rect x="14" y="14" width="12" height="2" rx="1" fill="var(--theme-accent)" opacity="0.85"/>
              <rect x="14" y="20" width="16" height="2" rx="1" fill="var(--theme-steel-blue)" opacity="0.85"/>
              <rect x="14" y="26" width="10" height="2" rx="1" fill="var(--theme-header-bg)" opacity="0.85"/>
            </svg>
            <h1 className="text-2xl font-bold tracking-wide">PDF Toolkit</h1>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://planning-tool-belt.vercel.app"
              className="p-2 rounded-lg bg-dark-bg/50 border border-border hover:border-accent transition-colors"
              title="Back to Tool Belt"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Body: Sidebar + Content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-48 bg-dark-bg border-r border-border flex flex-col shrink-0">
          {TOOLS.map(tool => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors text-left ${
                activeTool === tool.id
                  ? 'bg-header-bg text-accent border-r-2 border-accent'
                  : 'text-text-primary/70 hover:text-text-primary hover:bg-alt-bg'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={tool.icon}/>
              </svg>
              {tool.label}
            </button>
          ))}
          <div className="border-t border-border mt-2 pt-2">
            <button
              onClick={handleDownload}
              disabled={pages.length === 0 || isProcessing}
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-left w-full text-accent hover:bg-alt-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-auto">
          {activeTool === 'upload' && (
            <div>
              <UploadZone />
              {pages.length > 0 && (
                <div className="mt-6">
                  <p className="text-sm text-steel-blue mb-3">{pages.length} page{pages.length !== 1 ? 's' : ''} loaded</p>
                  <PageGrid />
                </div>
              )}
            </div>
          )}
          {activeTool === 'manage' && <ManagePages />}
          {activeTool === 'extract' && <ExtractPages />}
          {activeTool === 'annotate' && <AnnotateEditor />}
          {activeTool === 'signature' && <SignaturePad />}
          {activeTool === 'flatten' && <FlattenForms />}
        </div>
      </div>

      <PreviewModal />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}
