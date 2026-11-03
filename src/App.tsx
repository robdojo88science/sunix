import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactNode } from 'react'
import { Mixer, decodeFile, downloadBlob, encodeWavAsync, encodeMp3, renderMix, renderOriginal, separateAudio } from './audio'
import type { MixTrack, Stem } from './audio'
import Icon from './components/Icon'
import type { IconName } from './components/Icon'
import Waveform from './components/Waveform'
import { clearProjects, loadProject, saveProject } from './storage'

const LyricsStudio = lazy(() => import('./components/LyricsStudio'))
type View = 'home' | 'dismantle' | 'reassemble' | 'original' | 'lyrics'
type Quality = 'fast' | 'balanced' | 'high'
type Preferences = { appearance: 'system' | 'dark' | 'extra'; motion: 'system' | 'full' | 'reduced'; quality: Quality; format: 'wav' | 'mp3' }
type Operation = { title: string; stage: string; percent: number }
const NAV: { id: View; label: string; icon: IconName; color: string; caption: string }[] = [
  { id: 'home', label: 'Home', icon: 'home', color: '#b992ff', caption: '' },
  { id: 'dismantle', label: 'Dismantle', icon: 'split', color: '#c39bff', caption: 'Find every layer.' },
  { id: 'reassemble', label: 'Reassemble', icon: 'mix', color: '#6de4e0', caption: 'Make it your own.' },
  { id: 'original', label: 'Original', icon: 'wave', color: '#a3b7ff', caption: 'Shape the sound.' },
  { id: 'lyrics', label: 'Lyrics', icon: 'lyrics', color: '#f0a7cf', caption: 'Let the words flow.' },
]
const uid = () => crypto.randomUUID()
const time = (n: number) => `${Math.floor(Math.max(0, n) / 60)}:${Math.floor(Math.max(0, n) % 60).toString().padStart(2, '0')}`
const readableError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
function readPreferences(): Preferences {
  const fallback: Preferences = { appearance: 'system', motion: 'system', quality: 'balanced', format: 'wav' }
  try { return { ...fallback, ...JSON.parse(localStorage.getItem('sunix:preferences') || '{}') } } catch { return fallback }
}
function currentView(): View { const key = location.hash.slice(1); return NAV.some(n => n.id === key) ? key as View : 'home' }

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} aria-label={title} className="dialog panel" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}><Icon name="close" /></button></div>
    {children}
  </dialog>
}

export default function App() {
  const [view, setView] = useState<View>(currentView)
  const [prefs, setPrefs] = useState(readPreferences)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [lyricsKey, setLyricsKey] = useState(0)
  const [toast, setToast] = useState('')
  const [source, setSource] = useState<{ name: string; buffer: AudioBuffer; size: number } | null>(null)
  const [preview, setPreview] = useState<AudioBuffer | null>(null)
  const [originalName, setOriginalName] = useState('')
  const [edit, setEdit] = useState({ start: 0, end: 0, fadeIn: 0, fadeOut: 0, volume: 1, normalize: false })
  const [previewDirty, setPreviewDirty] = useState(false)
  const [tracks, setTracks] = useState<MixTrack[]>([])
  const [projectName, setProjectName] = useState('Untitled mix')
  const [master, setMaster] = useState(1)
  const [stems, setStems] = useState<Stem[]>([])
  const [focusedStem, setFocusedStem] = useState<Stem | null>(null)
  const [mode, setMode] = useState<2 | 4>(2)
  const [quality, setQuality] = useState<Quality>(prefs.quality)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState(prefs.format)
  const [transport, setTransport] = useState({ time: 0, duration: 0, playing: false })
  const [playerSource, setPlayerSource] = useState({ kind: 'original', name: '' })
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mixer = useRef<Mixer | null>(null)
  const controller = useRef<AbortController | null>(null)
  const importDestination = useRef<View>('original')
  const busy = !!operation

  function notice(message: string) { setToast(message) }
  function navigate(next: View) { location.hash = next; setView(next); setFocusedStem(null) }
  useEffect(() => { const handle = () => { setView(currentView()); setFocusedStem(null) }; window.addEventListener('hashchange', handle); return () => window.removeEventListener('hashchange', handle) }, [])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 5000); return () => clearTimeout(id) }, [toast])
  useEffect(() => { try { localStorage.setItem('sunix:preferences', JSON.stringify(prefs)) } catch { /* Session preferences still work. */ } }, [prefs])
  useEffect(() => { document.documentElement.dataset.appearance = prefs.appearance; document.documentElement.dataset.motion = prefs.motion }, [prefs.appearance, prefs.motion])
  useEffect(() => {
    const handle = () => { document.documentElement.dataset.background = String(document.hidden) }
    document.addEventListener('visibilitychange', handle); return () => document.removeEventListener('visibilitychange', handle)
  }, [])
  useEffect(() => { const engine = new Mixer(setTransport); mixer.current = engine; return () => { engine.destroy(); mixer.current = null } }, [])
  useEffect(() => {
    if (view === 'home' || view === 'lyrics') return
    let active: MixTrack[] = []
    if (view === 'reassemble') { active = tracks; setPlayerSource({ kind: 'mix', name: projectName }) }
    else if (focusedStem) { active = [{ id: focusedStem.name, name: focusedStem.name, buffer: focusedStem.buffer, volume: 1, pan: 0, muted: false, solo: false }]; setPlayerSource({ kind: 'stem', name: focusedStem.name }) }
    else {
      const buffer = view === 'dismantle' ? source?.buffer : preview
      if (buffer) active = [{ id: 'original', name: originalName, buffer, volume: 1, pan: 0, muted: false, solo: false }]
      setPlayerSource({ kind: view === 'dismantle' ? 'source' : 'original', name: originalName })
    }
    mixer.current?.configure(active, view === 'reassemble' ? master : 1)
  }, [tracks, preview, source, view, focusedStem, master, originalName, projectName])

  function chooseAudio(destination: View = view) { if (busy) return; importDestination.current = destination === 'home' ? 'original' : destination; inputRef.current?.click() }
  async function importFiles(files: File[], destination = importDestination.current) {
    if (!files.length || busy) return
    mixer.current?.stop()
    setOperation({ title: 'Opening audio', stage: files[0].name, percent: 0 })
    try {
      const decoded: MixTrack[] = []
      const selected = destination === 'reassemble' ? files : files.slice(0, 1)
      for (let i = 0; i < selected.length; i++) {
        const file = selected[i]
        setOperation({ title: 'Opening audio', stage: file.name, percent: i / selected.length * 100 })
        const buffer = await decodeFile(file)
        decoded.push({ id: uid(), name: file.name.replace(/\.[^.]+$/, ''), buffer, volume: 1, pan: 0, muted: false, solo: false })
      }
      if (destination === 'reassemble') { setTracks(prev => [...prev, ...decoded]); navigate('reassemble') }
      else {
        const file = files[0], buffer = decoded[0].buffer
        setSource({ name: file.name, buffer, size: file.size }); setPreview(buffer); setStems([]); setFocusedStem(null)
        setOriginalName(decoded[0].name); setEdit({ start: 0, end: buffer.duration, fadeIn: 0, fadeOut: 0, volume: 1, normalize: false }); setPreviewDirty(false)
        navigate(destination === 'dismantle' ? 'dismantle' : 'original')
      }
    } catch (error) { notice(readableError(error)) } finally { setOperation(null) }
  }
  function onFiles(event: ChangeEvent<HTMLInputElement>) { const files = Array.from(event.target.files || []); event.target.value = ''; void importFiles(files) }
  async function applyEdits() {
    if (!source) return null
    setOperation({ title: 'Preparing preview', stage: 'Rendering your edits', percent: 20 })
    try {
      mixer.current?.stop()
      const buffer = await renderOriginal(source.buffer, edit)
      setPreview(buffer); setPreviewDirty(false); return buffer
    } catch (error) { notice(readableError(error)); return null } finally { setOperation(null) }
  }
  async function togglePlay() {
    if (busy) return
    try {
      if (mixer.current?.isPlaying) mixer.current.pause()
      else {
        await mixer.current?.unlock()
        if (playerSource.kind === 'original' && previewDirty) { const rendered = await applyEdits(); if (!rendered) return; mixer.current?.configure([{ id: 'original', name: originalName, buffer: rendered, volume: 1, pan: 0, muted: false, solo: false }]); }
        await mixer.current?.play()
      }
    } catch (error) { notice(readableError(error)) }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.code === 'Space' && !target.closest('input,textarea,select,button,summary,[contenteditable]') && transport.duration > 0 && !settingsOpen && !exportOpen && !clearOpen) { e.preventDefault(); void togglePlay() }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  })

  async function separate() {
    if (!source || busy) return
    const abort = new AbortController(); controller.current = abort
    mixer.current?.pause(); setOperation({ title: 'Separating', stage: 'Preparing audio', percent: 0 })
    try {
      const results = await separateAudio(source.buffer, { mode, quality, signal: abort.signal, onProgress: (percent, stage) => setOperation({ title: 'Separating', stage, percent }) })
      setStems(results); notice(`${results.length} stems ready`)
    } catch (error) { if (!abort.signal.aborted) notice(readableError(error)); else notice('Separation canceled') } finally { controller.current = null; setOperation(null) }
  }
  function openStems() {
    setTracks(stems.map(stem => ({ id: uid(), name: stem.name, buffer: stem.buffer, volume: 1, pan: 0, muted: false, solo: false })))
    setMaster(1); setProjectName(originalName || 'Untitled mix'); navigate('reassemble')
  }
  function updateTrack(id: string, patch: Partial<MixTrack>) { setTracks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t)) }
  function moveTrack(index: number, delta: number) { setTracks(prev => { const copy = [...prev]; const next = index + delta; if (next < 0 || next >= copy.length) return prev; [copy[index], copy[next]] = [copy[next], copy[index]]; return copy }) }
  async function saveMix() { if (!tracks.length) return; try { await saveProject(projectName, tracks, master); notice('Project saved on this device') } catch (error) { notice(readableError(error)) } }
  async function reopenMix() {
    if (busy) return
    setOperation({ title: 'Opening project', stage: 'Reading local tracks', percent: 30 })
    try { const project = await loadProject(); if (!project) { notice('No saved project on this device'); return } setTracks(project.tracks); setProjectName(project.name); setMaster(project.master); navigate('reassemble'); notice('Local project opened') } catch (error) { notice(readableError(error)) } finally { setOperation(null) }
  }
  async function exportAudio(stem?: Stem, format: 'wav' | 'mp3' = exportFormat) {
    if (busy) return
    const abort = new AbortController(); controller.current = abort
    const name = (stem ? `${originalName}-${stem.name}` : view === 'reassemble' ? projectName : originalName) || 'SUNIX'
    setExportOpen(false); setOperation({ title: 'Exporting', stage: 'Rendering audio', percent: 10 })
    try {
      const rendered = stem?.buffer || (view === 'reassemble' ? await renderMix(tracks, master) : source ? await renderOriginal(source.buffer, edit) : null)
      if (!rendered) throw new Error('Choose audio first.')
      if (abort.signal.aborted) return
      const blob = format === 'mp3' ? await encodeMp3(rendered, percent => setOperation({ title: 'Exporting', stage: 'Encoding MP3', percent: 20 + percent * .8 }), abort.signal) : await encodeWavAsync(rendered, percent => setOperation({ title: 'Exporting', stage: 'Encoding WAV', percent: 20 + percent * .8 }), abort.signal)
      if (abort.signal.aborted) return
      downloadBlob(blob, `${name.replace(/[<>:"/\\|?*]/g, '_')}.${format}`)
      notice(`${format.toUpperCase()} ready — check your downloads`)
    } catch (error) { if (!abort.signal.aborted) notice(readableError(error)) } finally { controller.current = null; setOperation(null) }
  }
  async function clearData() {
    try {
      window.dispatchEvent(new Event('sunix:clear'))
      Object.keys(localStorage).filter(key => key.startsWith('sunix')).forEach(key => localStorage.removeItem(key))
      await clearProjects()
      if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.filter(key => key.startsWith('sunix')).map(key => caches.delete(key))) }
      setClearOpen(false); notice('Local drafts, projects, and cached models cleared')
    } catch (error) { notice(readableError(error)) } finally { setLyricsKey(v => v + 1) }
  }
  function editValue(patch: Partial<typeof edit>) { setEdit(prev => ({...prev,...patch})); setPreviewDirty(true); mixer.current?.pause() }
  const selectedTool = NAV.find(n => n.id === view)!
  const playerName = playerSource.name
  const hasPlayer = transport.duration > 0
  const originalLoaded = !!source
  const emptyState = (destination: View) => <div className="empty-state panel"><div className="empty-orb"><Icon name={destination === 'reassemble' ? 'mix' : 'wave'} size={38}/></div><h2>Your sound starts here.</h2><button className="button button-primary" onClick={() => chooseAudio(destination)} disabled={busy}><Icon name="plus"/>Choose Audio</button><span className="muted format-hint">MP3, WAV, M4A + more</span>{destination === 'reassemble' && <button className="button button-ghost" onClick={reopenMix}><Icon name="save" size={18}/>Open local project</button>}</div>

  return <div className={`app ${hasPlayer ? 'has-player' : ''} ${transport.playing ? 'is-playing' : ''} ${busy ? 'is-processing' : ''}`} onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDragging(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }} onDrop={e => { e.preventDefault(); setDragging(false); void importFiles(Array.from(e.dataTransfer.files), view === 'reassemble' ? 'reassemble' : view === 'dismantle' ? 'dismantle' : 'original') }}>
    <div className="ambient ambient-violet"/><div className="ambient ambient-cyan"/>
    <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.aiff" multiple={view === 'reassemble'} onChange={onFiles} className="sr-only" tabIndex={-1} aria-label="Choose audio files"/>
    <header className="app-header" inert={busy}>
      <button className="brand" onClick={() => navigate('home')} aria-label="SUNIX home"><span className="brand-symbol"><Icon name="wave" size={20}/></span>SUNIX<span className="brand-dot"/></button>
      <div className="header-right"><span className="local-badge"><span/>ON YOUR DEVICE</span><button className="icon-button settings-button" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Icon name="settings" size={20}/></button></div>
    </header>

    <main id="main-content" className={`main view-${view}`} aria-busy={busy} inert={busy}>
      {view === 'home' ? <section className="home-screen">
        <div className="hero-orbit" aria-hidden="true"><div className="orbit-ring orbit-ring-1"/><div className="orbit-ring orbit-ring-2"/><div className="orbit-core"><div className="sound-mark">{Array.from({length: 9},(_,i)=><i key={i} style={{'--i':i, '--bar-height': `${[19,33,51,72,90,66,45,31,16][i]}px`} as CSSProperties}/>)}</div></div><span className="orbit-spark spark-1"/><span className="orbit-spark spark-2"/></div>
        <div className="home-title"><span className="eyebrow">YOUR SOUND. REIMAGINED.</span><h1>SUNIX</h1><p>Split. Mix. Create.</p></div>
        <button className="button choose-audio" onClick={() => chooseAudio('original')} disabled={busy}><Icon name="plus" size={23}/>Choose Audio<Icon name="arrow" size={20}/></button>
        <span className="home-formats">MP3, WAV, M4A + more</span>
        <div className="tool-grid">{NAV.slice(1).map((tool,index)=><button key={tool.id} className={`tool-card tool-${tool.id}`} onClick={()=>navigate(tool.id)} style={{'--tool-color':tool.color} as CSSProperties}><span className="tool-card-top"><span className="tool-icon"><Icon name={tool.icon} size={25}/></span><span className="tool-number">0{index+1}</span></span><span className="tool-name">{tool.label}<Icon name="arrow" size={18}/></span></button>)}</div>
        <div className="home-footnote"><span className="tiny-wave"><i/><i/><i/><i/><i/></span>Made for the way you create.</div>
      </section> : view === 'lyrics' ? <Suspense fallback={<div className="empty-state">Opening Lyrics…</div>}><LyricsStudio key={lyricsKey} onNotice={notice}/></Suspense> : <>
        <div className="workspace-heading"><div><div className="eyebrow">SUNIX STUDIO <span className="heading-divider">/</span> 0{NAV.findIndex(n=>n.id===view)}</div><h1>{selectedTool.label}<span className="title-dot" style={{background:selectedTool.color}}/></h1><p className="muted">{selectedTool.caption}</p></div>{(view === 'reassemble' ? tracks.length > 0 : originalLoaded) && <button className="button button-secondary compact" disabled={busy} onClick={()=>chooseAudio()}><Icon name="plus" size={18}/><span>{view === 'reassemble' ? 'Add tracks' : 'Choose Audio'}</span></button>}</div>

        {view === 'dismantle' && (!source ? emptyState('dismantle') : <div className="dismantle-layout">
          <section className="panel source-panel"><div className="file-heading"><div className="file-icon"><Icon name="wave" size={24}/></div><div className="file-meta"><h2>{source.name}</h2><span className="muted">{time(source.buffer.duration)} <span>·</span> {(source.size / 1024 / 1024).toFixed(1)} MB</span></div><span className="status-pill"><span/>Ready</span></div><Waveform buffer={source.buffer} progress={transport.duration ? transport.time/transport.duration : 0} onSeek={fraction=>mixer.current?.seek(fraction*transport.duration)}/><div className="source-caption"><span>ORIGINAL AUDIO</span><Icon name="headphones" size={15}/></div></section>
          <section className="panel separation-controls"><div className="section-label"><span className="eyebrow">SEPARATION</span><span className="small-muted">Local processing</span></div><div className="segmented stem-selector" role="group" aria-label="Stem count"><button className={mode===2?'active':''} onClick={()=>setMode(2)} disabled={busy}>2 Stem<span>Vocals + Instrumental</span></button><button className={mode===4?'active':''} onClick={()=>{setMode(4);if(quality==='fast')setQuality('balanced')}} disabled={busy}>4 Stem<span>Vocals, Drums, Bass, Other</span></button></div><label className="field-label quality-field">Processing<select className="field" value={quality} disabled={busy} onChange={e=>{ const q=e.target.value as Quality;setQuality(q);if(q==='fast')setMode(2)}}><option value="balanced">Balanced · AI</option><option value="high">High · AI + overlap</option><option value="fast">Fast · center/side</option></select></label><p className="processing-note">{quality==='fast' ? 'Quick stereo center/side extraction. Results depend on the mix; this is not AI separation.' : 'First use downloads a 166 MB model. Audio stays on your device. Long songs can take several minutes.'}</p><button className="button button-primary separate-button" onClick={separate} disabled={busy}><Icon name="split" size={20}/>{stems.length?'Separate again':'Separate audio'}<Icon name="arrow" size={18}/></button></section>
          {stems.length>0 && <section className="stem-results"><div className="section-label"><div><span className="eyebrow">YOUR STEMS</span><h2>Every layer, unlocked.</h2></div><span className="status-pill"><Icon name="check" size={14}/>Complete</span></div><div className="stem-grid">{stems.map(stem=><article className={`panel stem-strip ${focusedStem===stem?'selected':''}`} key={stem.name} style={{'--stem-color':stem.color} as CSSProperties}><div className="stem-heading"><span className="stem-dot"/><h3>{stem.name}</h3><span className="muted">{time(stem.buffer.duration)}</span></div><Waveform buffer={stem.buffer} color={stem.color}/><div className="stem-actions"><button className="button button-ghost" onClick={async()=>{if(focusedStem===stem&&transport.playing){mixer.current?.pause();return}setFocusedStem(stem);mixer.current?.configure([{id:stem.name,name:stem.name,buffer:stem.buffer,volume:1,pan:0,muted:false,solo:false}]);try{await mixer.current?.play()}catch(e){notice(readableError(e))}}} disabled={busy}><Icon name={focusedStem===stem&&transport.playing?'pause':'play'} size={17}/>{focusedStem===stem&&transport.playing?'Pause':'Preview'}</button><button className="icon-button" aria-label={`Download ${stem.name}`} disabled={busy} onClick={()=>void exportAudio(stem,'wav')}><Icon name="download" size={19}/></button></div></article>)}</div><button className="button button-primary open-mix" onClick={openStems} disabled={busy}><Icon name="mix" size={19}/>Open in Reassemble<Icon name="arrow" size={19}/></button></section>}
        </div>)}

        {view === 'reassemble' && (tracks.length===0 ? emptyState('reassemble') : <div className="mixer-layout"><section className="mixer-tracks"><div className="mix-heading"><input className="project-title" aria-label="Project name" value={projectName} maxLength={100} onChange={e=>setProjectName(e.target.value)}/><span className="small-muted">{tracks.length} TRACK{tracks.length===1?'':'S'}</span></div>{tracks.map((track,index)=><article className={`panel mixer-strip ${track.muted?'is-muted':''} ${track.solo?'is-solo':''}`} key={track.id} style={{'--track-color':NAV[(index%4)+1].color} as CSSProperties}><div className="track-top"><span className="track-index">{String(index+1).padStart(2,'0')}</span><input className="track-name" aria-label={`Track ${index+1} name`} value={track.name} maxLength={100} onChange={e=>updateTrack(track.id,{name:e.target.value})}/><div className="track-toggles"><button className={`toggle ${track.muted?'muted-active':''}`} aria-label={`Mute ${track.name}`} aria-pressed={track.muted} onClick={()=>updateTrack(track.id,{muted:!track.muted})}>M</button><button className={`toggle ${track.solo?'solo-active':''}`} aria-label={`Solo ${track.name}`} aria-pressed={track.solo} onClick={()=>updateTrack(track.id,{solo:!track.solo})}>S</button></div></div><div className="track-body"><Waveform buffer={track.buffer} color={NAV[(index%4)+1].color} progress={transport.time/track.buffer.duration} onSeek={f=>mixer.current?.seek(f*track.buffer.duration)}/><label className="track-volume"><Icon name="volume" size={17}/><input type="range" min="0" max="1.5" step="0.01" value={track.volume} onChange={e=>updateTrack(track.id,{volume:+e.target.value})} aria-label={`${track.name} volume`}/><output>{Math.round(track.volume*100)}<small>%</small></output></label></div><details className="track-details"><summary>Track controls<Icon name="chevron" size={14}/></summary><div className="track-detail-grid"><label className="field-label">Pan <output>{track.pan===0?'Center':`${Math.round(Math.abs(track.pan)*100)} ${track.pan<0?'L':'R'}`}</output><input type="range" min="-1" max="1" step="0.01" value={track.pan} onChange={e=>updateTrack(track.id,{pan:+e.target.value})}/></label><div className="track-detail-actions"><button className="icon-button" disabled={index===0} onClick={()=>moveTrack(index,-1)} aria-label={`Move ${track.name} up`}>↑</button><button className="icon-button" disabled={index===tracks.length-1} onClick={()=>moveTrack(index,1)} aria-label={`Move ${track.name} down`}>↓</button><button className="icon-button danger" onClick={()=>setTracks(prev=>prev.filter(t=>t.id!==track.id))} aria-label={`Remove ${track.name}`}><Icon name="trash" size={18}/></button></div></div></details></article>)}<button className="add-track-button" onClick={()=>chooseAudio('reassemble')} disabled={busy}><Icon name="plus" size={20}/>Add a track</button></section><aside className="panel master-panel"><div className="section-label"><span className="eyebrow">MASTER</span><Icon name="mix" size={19}/></div><div className="master-visual" aria-hidden="true">{Array.from({length:16},(_,i)=><span key={i} style={{height:`${15+Math.sin(i*.8)**2*55}%`,'--i':i} as CSSProperties}/>)}</div><label className="field-label">Master volume<output>{Math.round(master*100)}%</output><input type="range" min="0" max="1.5" step="0.01" value={master} onChange={e=>setMaster(+e.target.value)} /></label><button className="button button-primary" disabled={busy} onClick={()=>{setExportFormat(prefs.format);setExportOpen(true)}}><Icon name="download" size={19}/>Export mix</button><div className="master-utilities"><button className="button button-ghost" onClick={saveMix} disabled={busy}><Icon name="save" size={17}/>Save locally</button><button className="button button-ghost" onClick={reopenMix} disabled={busy}>Open project</button><button className="button button-ghost" onClick={()=>{setTracks(prev=>prev.map(t=>({...t,volume:1,pan:0,muted:false,solo:false})));setMaster(1);notice('Mix reset')}}><Icon name="reset" size={17}/>Reset mix</button></div><p className="small-muted">Local save includes your audio. One project is kept on this device.</p></aside></div>)}

        {view === 'original' && (!source ? emptyState('original') : <div className="original-layout"><section className="panel original-wave-panel"><div className="section-label"><span className="eyebrow">ORIGINAL AUDIO</span><span className="small-muted">{time(source.buffer.duration)}</span></div><input className="project-title original-title" aria-label="Audio project name" value={originalName} maxLength={100} onChange={e=>setOriginalName(e.target.value)}/><div className="trim-wave"><Waveform buffer={source.buffer} color="#a3b7ff" start={edit.start/source.buffer.duration} end={edit.end/source.buffer.duration} progress={transport.duration ? (edit.start + transport.time)/source.buffer.duration : 0} onSeek={f=>mixer.current?.seek(Math.max(0,f*source.buffer.duration-edit.start))}/><div className="trim-boundary" style={{left:`${edit.start/source.buffer.duration*100}%`}}/><div className="trim-boundary" style={{left:`${edit.end/source.buffer.duration*100}%`}}/></div><div className="trim-time"><span>{time(edit.start)}</span><span>{(edit.end-edit.start).toFixed(1)}s selected</span><span>{time(edit.end)}</span></div><div className="trim-controls"><label className="field-label">Start<input type="range" aria-label="Trim start" min="0" max={source.buffer.duration} step="0.01" value={edit.start} onChange={e=>editValue({start:Math.min(+e.target.value,edit.end-.02)})}/><input className="field time-field" type="number" aria-label="Start time in seconds" min="0" max={edit.end-.02} step="0.01" value={+edit.start.toFixed(2)} onChange={e=>editValue({start:Math.max(0,Math.min(+e.target.value,edit.end-.02))})}/></label><label className="field-label">End<input type="range" aria-label="Trim end" min="0" max={source.buffer.duration} step="0.01" value={edit.end} onChange={e=>editValue({end:Math.max(edit.start+.02,+e.target.value)})}/><input className="field time-field" type="number" aria-label="End time in seconds" min={edit.start+.02} max={source.buffer.duration} step="0.01" value={+edit.end.toFixed(2)} onChange={e=>editValue({end:Math.max(edit.start+.02,Math.min(+e.target.value,source.buffer.duration))})}/></label></div><div className="original-bottom"><span className="small-muted">{previewDirty?'Edits apply when you play or export.':'Ready to preview.'}</span><button className="button button-ghost" onClick={()=>{setEdit({start:0,end:source.buffer.duration,fadeIn:0,fadeOut:0,volume:1,normalize:false});setPreview(source.buffer);setPreviewDirty(false);notice('Edits reset')}}><Icon name="reset" size={15}/>Reset</button></div></section><aside className="panel adjustments-panel"><span className="eyebrow">SHAPE YOUR SOUND</span><label className="field-label">Fade in<output>{edit.fadeIn.toFixed(1)}s</output><input type="range" min="0" max={Math.min(10,(edit.end-edit.start)/2)} step="0.1" value={edit.fadeIn} onChange={e=>editValue({fadeIn:+e.target.value})}/></label><label className="field-label">Fade out<output>{edit.fadeOut.toFixed(1)}s</output><input type="range" min="0" max={Math.min(10,(edit.end-edit.start)/2)} step="0.1" value={edit.fadeOut} onChange={e=>editValue({fadeOut:+e.target.value})}/></label><label className="field-label">Volume<output>{Math.round(edit.volume*100)}%</output><input type="range" min="0" max="2" step="0.01" value={edit.volume} onChange={e=>editValue({volume:+e.target.value})}/></label><label className="switch-label"><span>Normalize<small>Bring peak level to −1 dB</small></span><input type="checkbox" role="switch" checked={edit.normalize} onChange={e=>editValue({normalize:e.target.checked})}/></label><button className="button button-primary" onClick={()=>{setExportFormat(prefs.format);setExportOpen(true)}} disabled={busy}><Icon name="download" size={19}/>Export audio</button><button className="button button-ghost" onClick={()=>navigate('dismantle')}><Icon name="split" size={17}/>Open in Dismantle<Icon name="arrow" size={16}/></button></aside></div>)}
      </>}
    </main>

    {hasPlayer && <section className="master-player panel" aria-label="Audio player"><button className={`player-play ${transport.playing?'playing':''}`} onClick={togglePlay} disabled={busy} aria-label={transport.playing?'Pause':'Play'}><Icon name={transport.playing?'pause':'play'} size={21}/></button><div className="player-info"><strong>{playerName}</strong><span>{playerSource.kind==='mix'?'REASSEMBLE':playerSource.kind==='stem'?'STEM PREVIEW':'ORIGINAL'}</span></div><button className="icon-button player-stop" onClick={()=>mixer.current?.stop()} aria-label="Stop"><Icon name="stop" size={17}/></button><div className="player-timeline"><input aria-label="Playback position" type="range" min="0" max={transport.duration || 1} step="0.05" value={Math.min(transport.time,transport.duration)} onChange={e=>mixer.current?.seek(+e.target.value)} disabled={busy}/><div><span>{time(transport.time)}</span><span>{time(transport.duration)}</span></div></div><div className="player-meter" aria-hidden="true"><i/><i/><i/><i/><i/></div></section>}
    <nav className="bottom-nav" aria-label="Main navigation">{NAV.map(item=><button className={view===item.id?'active':''} key={item.id} onClick={()=>navigate(item.id)} aria-current={view===item.id?'page':undefined}><Icon name={item.icon} size={21}/><span>{item.label}</span></button>)}</nav>

    {toast && <div className="toast" role="status"><Icon name="check" size={17}/><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast('')}><Icon name="close" size={15}/></button></div>}
    {operation && <div className="processing-overlay"><section className="processing-dialog panel" role="status" aria-live="polite"><div className="progress-ring" style={{'--progress':`${Math.max(0,Math.min(100,operation.percent))*3.6}deg`} as CSSProperties}><span>{Math.round(operation.percent)}<small>%</small></span></div><h2>{operation.title}</h2><p className="muted">{operation.stage}</p><div className="progress-track"><div style={{width:`${Math.max(2,operation.percent)}%`}}/></div>{controller.current && <button className="button button-ghost" onClick={()=>controller.current?.abort()}>Cancel</button>}</section></div>}
    {dragging && <div className="drop-overlay"><Icon name="upload" size={45}/><h2>Drop your audio.</h2></div>}
    {exportOpen && <Dialog title="Export your sound" onClose={()=>setExportOpen(false)}><p className="muted">{view==='reassemble'?projectName:originalName}</p><div className="segmented export-selector"><button className={exportFormat==='wav'?'active':''} onClick={()=>setExportFormat('wav')}>WAV<span>Lossless · 16-bit</span></button><button className={exportFormat==='mp3'?'active':''} onClick={()=>setExportFormat('mp3')}>MP3<span>Compressed · 192 kbps</span></button></div><button className="button button-primary full-width" onClick={()=>exportAudio()}><Icon name="download" size={19}/>Export {exportFormat.toUpperCase()}</button></Dialog>}
    {settingsOpen && <Dialog title="Settings" onClose={()=>setSettingsOpen(false)}><div className="settings-grid"><label className="field-label">Appearance<select className="field" value={prefs.appearance} onChange={e=>setPrefs({...prefs,appearance:e.target.value as Preferences['appearance']})}><option value="system">System</option><option value="dark">Dark</option><option value="extra">Extra Dark</option></select></label><label className="field-label">Motion<select className="field" value={prefs.motion} onChange={e=>setPrefs({...prefs,motion:e.target.value as Preferences['motion']})}><option value="system">System</option><option value="full">Full</option><option value="reduced">Reduced</option></select></label><label className="field-label">Default processing<select className="field" value={prefs.quality} onChange={e=>{const q=e.target.value as Quality;setPrefs({...prefs,quality:q});setQuality(q);if(q==='fast')setMode(2)}}><option value="balanced">Balanced · AI</option><option value="high">High · AI + overlap</option><option value="fast">Fast · center/side</option></select></label><label className="field-label">Default export<select className="field" value={prefs.format} onChange={e=>setPrefs({...prefs,format:e.target.value as Preferences['format']})}><option value="wav">WAV</option><option value="mp3">MP3</option></select></label></div><div className="settings-section"><span className="eyebrow">STORAGE</span><button className="button button-secondary" onClick={()=>setClearOpen(true)}><Icon name="trash" size={17}/>Clear Local Data</button></div><details className="settings-about"><summary>About SUNIX <span className="small-muted">1.0.0</span></summary><p>Audio and lyrics stay on your device. AI models are downloaded from Hugging Face when needed. No accounts or analytics.</p><p>Add SUNIX to your Home Screen for a standalone workspace. Installation is optional.</p><p>Built with <a href="https://react.dev/" target="_blank" rel="noreferrer">React</a>, <a href="https://vite.dev/" target="_blank" rel="noreferrer">Vite</a>, <a href="https://github.com/microsoft/onnxruntime" target="_blank" rel="noreferrer">ONNX Runtime</a>, <a href="https://github.com/facebookresearch/demucs" target="_blank" rel="noreferrer">Demucs</a> and <a href="https://huggingface.co/StemSplitio/htdemucs-onnx" target="_blank" rel="noreferrer">StemSplit’s ONNX model</a> (MIT). MP3 encoding: <a href="https://github.com/shijinyu/lamejs" target="_blank" rel="noreferrer">lamejs</a> (LGPL-3.0).</p><a href="https://github.com/robdojo88science/sunix" target="_blank" rel="noreferrer">Source & acknowledgments ↗</a></details></Dialog>}
    {clearOpen && <Dialog title="Clear local data?" onClose={()=>setClearOpen(false)}><p className="muted">This removes saved lyrics, the saved mix, preferences, and downloaded models from this browser. Export anything you want to keep first.</p><button className="button danger-button full-width" onClick={clearData}>Clear this device</button></Dialog>}
  </div>
}
