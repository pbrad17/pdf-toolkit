// Shape stamp definitions: metadata, SVG rendering helpers, and PDF drawing

export const SHAPES = [
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'star', label: 'Star' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'checkmark', label: 'Check' },
  { id: 'xmark', label: 'X Mark' },
  { id: 'heart', label: 'Heart' },
]

export const FILLABLE_SHAPES = new Set(['rectangle', 'circle', 'triangle', 'star', 'diamond', 'heart'])
export const FLIPPABLE_SHAPES = new Set(['line', 'arrow'])

// Returns SVG children props for a 100x100 viewBox (used by AnnotationBox)
// Each returns an array of { element, props } objects
export function getShapeSvgElements(shape, strokeColor, strokeWidth, fillColor, flipped) {
  const stroke = strokeColor || '#000000'
  const fill = fillColor || 'none'
  const sw = strokeWidth || 2
  const common = { vectorEffect: 'non-scaling-stroke' }

  switch (shape) {
    case 'line': {
      const y1 = flipped ? 0 : 100
      const y2 = flipped ? 100 : 0
      return [{ el: 'line', props: { ...common, x1: 0, y1, x2: 100, y2, stroke, strokeWidth: sw, fill: 'none' } }]
    }
    case 'arrow': {
      const y1 = flipped ? 0 : 100
      const y2 = flipped ? 100 : 0
      // Arrowhead points toward (100, y2)
      const headPoints = flipped
        ? '100,100 78,92 92,78'
        : '100,0 78,8 92,22'
      return [
        { el: 'line', props: { ...common, x1: 0, y1, x2: 100, y2, stroke, strokeWidth: sw, fill: 'none' } },
        { el: 'polygon', props: { points: headPoints, fill: stroke, stroke: 'none' } },
      ]
    }
    case 'rectangle':
      return [{ el: 'rect', props: { ...common, x: 2, y: 2, width: 96, height: 96, stroke, strokeWidth: sw, fill } }]
    case 'circle':
      return [{ el: 'ellipse', props: { ...common, cx: 50, cy: 50, rx: 48, ry: 48, stroke, strokeWidth: sw, fill } }]
    case 'triangle':
      return [{ el: 'polygon', props: { ...common, points: '50,2 98,98 2,98', stroke, strokeWidth: sw, fill } }]
    case 'star': {
      const pts = []
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 2) * -1 + (Math.PI / 5) * i
        const r = i % 2 === 0 ? 48 : 20
        pts.push(`${50 + r * Math.cos(angle)},${50 + r * Math.sin(angle)}`)
      }
      return [{ el: 'polygon', props: { ...common, points: pts.join(' '), stroke, strokeWidth: sw, fill } }]
    }
    case 'diamond':
      return [{ el: 'polygon', props: { ...common, points: '50,2 98,50 50,98 2,50', stroke, strokeWidth: sw, fill } }]
    case 'checkmark':
      return [{ el: 'polyline', props: { ...common, points: '10,55 40,85 90,15', stroke, strokeWidth: sw, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } }]
    case 'xmark':
      return [
        { el: 'line', props: { ...common, x1: 10, y1: 10, x2: 90, y2: 90, stroke, strokeWidth: sw, strokeLinecap: 'round' } },
        { el: 'line', props: { ...common, x1: 90, y1: 10, x2: 10, y2: 90, stroke, strokeWidth: sw, strokeLinecap: 'round' } },
      ]
    case 'heart':
      return [{ el: 'path', props: { ...common, d: 'M50,88 C20,70 2,50 2,30 C2,14 14,2 30,2 C40,2 48,8 50,18 C52,8 60,2 70,2 C86,2 98,14 98,30 C98,50 80,70 50,88Z', stroke, strokeWidth: sw, fill } }]
    default:
      return []
  }
}

// Draw shape into PDF page using pdf-lib
export function drawShapePdf(copiedPage, ann, pageW, pageH, rgbFn, hexToRgb) {
  const color = hexToRgb(ann.strokeColor || '#000000')
  const fillRgb = ann.fillColor ? hexToRgb(ann.fillColor) : null
  const sw = ann.strokeWidth || 2
  const opac = ann.opacity ?? 1
  const x = ann.x * pageW
  const w = (ann.width || 0.1) * pageW
  const h = (ann.height || 0.08) * pageH
  const topY = (1 - ann.y) * pageH
  const bottomY = topY - h
  const borderColor = rgbFn(color.r, color.g, color.b)
  const fillOpts = fillRgb ? { color: rgbFn(fillRgb.r, fillRgb.g, fillRgb.b) } : {}

  switch (ann.shape) {
    case 'line': {
      const startY = ann.flipped ? topY : bottomY
      const endY = ann.flipped ? bottomY : topY
      copiedPage.drawLine({
        start: { x, y: startY },
        end: { x: x + w, y: endY },
        thickness: sw,
        color: borderColor,
        opacity: opac,
      })
      break
    }
    case 'arrow': {
      const startY = ann.flipped ? topY : bottomY
      const endY = ann.flipped ? bottomY : topY
      copiedPage.drawLine({
        start: { x, y: startY },
        end: { x: x + w, y: endY },
        thickness: sw,
        color: borderColor,
        opacity: opac,
      })
      // Arrowhead at the end point (x+w, endY)
      const headSize = Math.min(w, h) * 0.25 || 5
      const angle = Math.atan2(endY - startY, w)
      const tipX = x + w
      const tipY = endY
      const lx = tipX - headSize * Math.cos(angle - Math.PI / 6)
      const ly = tipY - headSize * Math.sin(angle - Math.PI / 6)
      const rx = tipX - headSize * Math.cos(angle + Math.PI / 6)
      const ry = tipY - headSize * Math.sin(angle + Math.PI / 6)
      copiedPage.drawSvgPath(
        `M 0 0 L ${lx - tipX} ${-(ly - tipY)} L ${rx - tipX} ${-(ry - tipY)} Z`,
        { x: tipX, y: tipY, color: borderColor, opacity: opac }
      )
      break
    }
    case 'rectangle':
      copiedPage.drawRectangle({
        x, y: bottomY, width: w, height: h,
        borderColor, borderWidth: sw, borderOpacity: opac,
        ...fillOpts,
        ...(fillRgb ? { opacity: opac } : { opacity: 0 }),
      })
      break
    case 'circle':
      copiedPage.drawEllipse({
        x: x + w / 2, y: bottomY + h / 2,
        xScale: w / 2, yScale: h / 2,
        borderColor, borderWidth: sw, borderOpacity: opac,
        ...fillOpts,
        ...(fillRgb ? { opacity: opac } : { opacity: 0 }),
      })
      break
    case 'triangle': {
      const cx = x + w / 2
      // Top center, bottom-left, bottom-right (relative to top-center)
      const path = `M 0 0 L ${x - cx} ${-(bottomY - topY)} L ${x + w - cx} ${-(bottomY - topY)} Z`
      copiedPage.drawSvgPath(path, {
        x: cx, y: topY,
        borderColor, borderWidth: sw, borderOpacity: opac,
        ...fillOpts,
        ...(fillRgb ? { opacity: opac } : { opacity: 0 }),
      })
      break
    }
    case 'star': {
      const cx = x + w / 2
      const cy = bottomY + h / 2
      const pts = []
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 2) * -1 + (Math.PI / 5) * i
        const rx = i % 2 === 0 ? w / 2 : w / 5
        const ry = i % 2 === 0 ? h / 2 : h / 5
        const px = rx * Math.cos(angle)
        const py = ry * Math.sin(angle)
        pts.push(i === 0 ? `M ${px} ${-py}` : `L ${px} ${-py}`)
      }
      copiedPage.drawSvgPath(pts.join(' ') + ' Z', {
        x: cx, y: cy,
        borderColor, borderWidth: sw, borderOpacity: opac,
        ...fillOpts,
        ...(fillRgb ? { opacity: opac } : { opacity: 0 }),
      })
      break
    }
    case 'diamond': {
      const cx = x + w / 2
      const cy = bottomY + h / 2
      const path = `M 0 ${h / 2} L ${-w / 2} 0 L 0 ${-h / 2} L ${w / 2} 0 Z`
      copiedPage.drawSvgPath(path, {
        x: cx, y: cy,
        borderColor, borderWidth: sw, borderOpacity: opac,
        ...fillOpts,
        ...(fillRgb ? { opacity: opac } : { opacity: 0 }),
      })
      break
    }
    case 'checkmark': {
      // Two line segments: start -> mid -> end
      const p1 = { x: x + w * 0.1, y: bottomY + h * 0.45 }
      const p2 = { x: x + w * 0.4, y: bottomY + h * 0.15 }
      const p3 = { x: x + w * 0.9, y: bottomY + h * 0.85 }
      copiedPage.drawLine({ start: p1, end: p2, thickness: sw, color: borderColor, opacity: opac })
      copiedPage.drawLine({ start: p2, end: p3, thickness: sw, color: borderColor, opacity: opac })
      break
    }
    case 'xmark': {
      copiedPage.drawLine({
        start: { x: x + w * 0.1, y: bottomY + h * 0.1 },
        end: { x: x + w * 0.9, y: bottomY + h * 0.9 },
        thickness: sw, color: borderColor, opacity: opac,
      })
      copiedPage.drawLine({
        start: { x: x + w * 0.9, y: bottomY + h * 0.1 },
        end: { x: x + w * 0.1, y: bottomY + h * 0.9 },
        thickness: sw, color: borderColor, opacity: opac,
      })
      break
    }
    case 'heart': {
      // Approximate heart with bezier curves
      const cx = x + w / 2
      // Start at bottom point, curves up
      const bx = w / 2
      const by = h / 2
      const path = [
        `M 0 ${-by * 0.76}`,
        `C ${-bx * 0.4} ${-by} ${-bx} ${-by * 0.6} ${-bx} ${-by * 0.2}`,
        `C ${-bx} ${by * 0.28} ${-bx * 0.52} ${by * 0.56} 0 ${by}`,
        `C ${bx * 0.52} ${by * 0.56} ${bx} ${by * 0.28} ${bx} ${-by * 0.2}`,
        `C ${bx} ${-by * 0.6} ${bx * 0.4} ${-by} 0 ${-by * 0.76}`,
        'Z',
      ].join(' ')
      copiedPage.drawSvgPath(path, {
        x: cx, y: bottomY + h / 2,
        borderColor, borderWidth: sw, borderOpacity: opac,
        ...fillOpts,
        ...(fillRgb ? { opacity: opac } : { opacity: 0 }),
      })
      break
    }
  }
}
