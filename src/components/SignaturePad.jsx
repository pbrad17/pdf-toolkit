import { useRef, useState, useEffect } from 'react'
import { useAppContext } from '../AppContext'

export default function SignaturePad() {
  const { signatures, addSignature, removeSignature } = useAppContext()
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasContent, setHasContent] = useState(false)
  const [penColor, setPenColor] = useState('#000000')
  const [penWidth, setPenWidth] = useState(2)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const startDraw = (e) => {
    e.preventDefault()
    setIsDrawing(true)
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    ctx.strokeStyle = penColor
    ctx.lineWidth = penWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  const draw = (e) => {
    if (!isDrawing) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasContent(true)
  }

  const endDraw = () => {
    setIsDrawing(false)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasContent(false)
  }

  const saveSignature = () => {
    if (!hasContent) return
    const canvas = canvasRef.current

    // Trim whitespace from the signature
    const ctx = canvas.getContext('2d')
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const { data, width, height } = imageData
    let minX = width, minY = height, maxX = 0, maxY = 0

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        // Check if pixel is not white
        if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }

    if (maxX <= minX || maxY <= minY) return

    // Add padding
    const pad = 10
    minX = Math.max(0, minX - pad)
    minY = Math.max(0, minY - pad)
    maxX = Math.min(width, maxX + pad)
    maxY = Math.min(height, maxY + pad)

    // Create trimmed canvas with transparency
    const trimW = maxX - minX
    const trimH = maxY - minY
    const trimCanvas = document.createElement('canvas')
    trimCanvas.width = trimW
    trimCanvas.height = trimH
    const trimCtx = trimCanvas.getContext('2d')
    trimCtx.drawImage(canvas, minX, minY, trimW, trimH, 0, 0, trimW, trimH)

    // Make white pixels transparent
    const trimData = trimCtx.getImageData(0, 0, trimW, trimH)
    for (let i = 0; i < trimData.data.length; i += 4) {
      if (trimData.data[i] > 240 && trimData.data[i + 1] > 240 && trimData.data[i + 2] > 240) {
        trimData.data[i + 3] = 0 // Make transparent
      }
    }
    trimCtx.putImageData(trimData, 0, 0)

    const dataUrl = trimCanvas.toDataURL('image/png')
    addSignature(dataUrl)
    clearCanvas()
  }

  return (
    <div className="max-w-xl">
      <div className="bg-dark-bg border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-3">Draw Signature</h3>
        <p className="text-sm text-steel-blue mb-4">
          Draw your signature below, then save it. Place saved signatures on any page using the Annotate tool.
        </p>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-steel-blue">Color</label>
            <input
              type="color"
              value={penColor}
              onChange={(e) => setPenColor(e.target.value)}
              className="w-8 h-6 rounded border border-border cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-steel-blue">Width</label>
            <input
              type="range"
              min={1}
              max={6}
              value={penWidth}
              onChange={(e) => setPenWidth(Number(e.target.value))}
              className="w-20 accent-accent"
            />
          </div>
        </div>

        {/* Drawing area */}
        <canvas
          ref={canvasRef}
          width={500}
          height={200}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
          className="w-full border border-border rounded cursor-crosshair bg-white touch-none"
          style={{ maxWidth: 500 }}
        />

        <div className="flex gap-2 mt-3">
          <button
            onClick={clearCanvas}
            className="px-4 py-2 text-sm rounded border border-border hover:border-accent transition-colors"
          >
            Clear
          </button>
          <button
            onClick={saveSignature}
            disabled={!hasContent}
            className="px-4 py-2 text-sm rounded font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            Save Signature
          </button>
        </div>
      </div>

      {/* Saved signatures */}
      {signatures.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold mb-3">Saved Signatures ({signatures.length})</h3>
          <div className="grid grid-cols-2 gap-3">
            {signatures.map((sig, i) => (
              <div key={sig.id} className="bg-dark-bg border border-border rounded-lg p-3 relative group">
                <div className="bg-white rounded p-2">
                  <img src={sig.dataUrl} alt={`Signature ${i + 1}`} className="h-16 mx-auto object-contain" />
                </div>
                <button
                  onClick={() => removeSignature(sig.id)}
                  className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded bg-negative/20 border border-negative/50 text-negative text-xs hover:bg-negative/40 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
                <p className="text-xs text-steel-blue text-center mt-1">Signature {i + 1}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-steel-blue mt-3">
            Use the Annotate tool to place these signatures on your PDF pages.
          </p>
        </div>
      )}
    </div>
  )
}
