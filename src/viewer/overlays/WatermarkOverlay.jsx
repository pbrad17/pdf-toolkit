import {
  ASCENDER_EM, createWatermark, estimateTextWidth, watermarkImageBox, watermarkPlacements,
} from '../../export/watermark'

/**
 * Presentational preview of the document watermark.
 *
 * Purely visual: it reads nothing, commits nothing, and is safe to mount over
 * any page-shaped box. The layout maths comes from the export module so the
 * preview cannot drift away from what gets written into the file.
 *
 * Geometry is done in points and handed to the SVG viewBox, which then scales
 * to whatever pixel size the caller renders at. `scale` is CSS pixels per PDF
 * point — the viewer's zoom factor. Left at 1, `width` and `height` are taken
 * to be points, which is what a preview that sizes itself from the page wants.
 *
 * Two conventions are worth stating because they are easy to get backwards:
 * `rotation` is counter-clockwise as seen on screen, and SVG's rotate() is
 * clockwise, hence the negation. The dy shift puts the cap-height midline on
 * the placement point, matching the ascender-based centring the export does
 * with real font metrics rather than trusting `dominant-baseline: central`,
 * which lands somewhere different in every font.
 */
export default function WatermarkOverlay({ config, width, height, scale = 1 }) {
  if (!config || !(width > 0) || !(height > 0) || !(scale > 0)) return null

  const settings = { ...createWatermark(), ...config }
  const opacity = Math.min(1, Math.max(0, Number(settings.opacity ?? 1)))
  if (opacity <= 0) return null

  const boxWidth = width / scale
  const boxHeight = height / scale
  const rotation = Number(settings.rotation) || 0
  const isImage = settings.kind === 'image'

  const text = String(settings.text ?? '')
  const fontSize = Number(settings.fontSize) || 72

  const item = isImage
    ? watermarkImageBox(
      boxWidth, boxHeight,
      Math.min(1, Math.max(0.02, Number(settings.imageScale) || 0.4)),
      Number(settings.imageAspect) || 0,
    )
    : { width: estimateTextWidth(text, fontSize), height: fontSize * ASCENDER_EM }

  if (isImage && !settings.dataUrl) return null
  if (!isImage && !text.trim()) return null

  const centres = watermarkPlacements({
    boxWidth,
    boxHeight,
    itemWidth: item.width,
    itemHeight: item.height,
    position: settings.position,
    rotation,
  })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${boxWidth} ${boxHeight}`}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {centres.map((centre, i) => (isImage ? (
        <image
          key={i}
          href={settings.dataUrl}
          x={centre.x - item.width / 2}
          y={centre.y - item.height / 2}
          width={item.width}
          height={item.height}
          opacity={opacity}
          preserveAspectRatio="xMidYMid meet"
          transform={`rotate(${-rotation} ${centre.x} ${centre.y})`}
        />
      ) : (
        <text
          key={i}
          x={centre.x}
          y={centre.y}
          dy={`${ASCENDER_EM / 2}em`}
          textAnchor="middle"
          fontFamily="Helvetica, Arial, sans-serif"
          fontSize={fontSize}
          fill={settings.color || '#000000'}
          opacity={opacity}
          transform={`rotate(${-rotation} ${centre.x} ${centre.y})`}
        >
          {text}
        </text>
      )))}
    </svg>
  )
}
