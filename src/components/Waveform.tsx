import { useEffect, useRef } from 'react'

export default function Waveform({ buffer, progress = 0, color = '#b98cff', onSeek, start = 0, end = 1 }: { buffer: AudioBuffer; progress?: number; color?: string; onSeek?: (fraction: number) => void; start?: number; end?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const draw = () => {
      const width = el.clientWidth, height = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.width = width * dpr; el.height = height * dpr
      const ctx = el.getContext('2d')!
      ctx.scale(dpr, dpr)
      const data = buffer.getChannelData(0), count = Math.floor(width / 4), step = Math.max(1, Math.floor(data.length / count))
      for (let i = 0; i < count; i++) {
        let max = 0
        for (let j = 0; j < step; j += Math.max(1, Math.floor(step / 24))) max = Math.max(max, Math.abs(data[i * step + j] || 0))
        const x = i * 4, bar = Math.max(2, max * height * .92)
        const fraction = i / count
        ctx.globalAlpha = fraction < start || fraction > end ? .15 : fraction < progress ? 1 : .42
        ctx.fillStyle = color
        ctx.beginPath(); ctx.roundRect(x, (height - bar) / 2, 2, bar, 1); ctx.fill()
      }
      if (progress > 0) { ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff'; ctx.fillRect(progress * width, 0, 1, height) }
    }
    draw()
    const observer = new ResizeObserver(draw); observer.observe(el)
    return () => observer.disconnect()
  }, [buffer, progress, color, start, end])
  return <canvas ref={canvas} className={`waveform ${onSeek ? 'seekable' : ''}`} aria-label="Audio waveform" onClick={onSeek ? e => { const rect = e.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))) } : undefined} />
}
