import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { createDraft, findRhymes, LYRICS_STORAGE_KEY, lyricsStatistics, readLyricsStore, replaceLiteral } from '../lyrics';
import type { LyricsDraft } from '../lyrics';

interface LyricsStudioProps { onNotice?: (message: string) => void }
interface Snapshot { title: string; text: string }
const SECTIONS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'];

function Glyph({ name }: { name: 'undo' | 'redo' | 'copy' | 'download' | 'plus' | 'folder' | 'tools' }) {
  const paths = {
    undo: <><path d="M3 10h10a7 7 0 0 1 0 14" transform="translate(0 -5)" /><path d="m7 1-4 4 4 4" /></>,
    redo: <><path d="M21 5H11a7 7 0 0 0 0 14" /><path d="m17 1 4 4-4 4" /></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="3" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    folder: <path d="M3 8V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />,
    tools: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" fill="currentColor" /><circle cx="16" cy="12" r="2" fill="currentColor" /><circle cx="10" cy="18" r="2" fill="currentColor" /></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function LyricsStudio({ onNotice }: LyricsStudioProps) {
  const initialStore = useMemo(readLyricsStore, []);
  const [drafts, setDrafts] = useState<LyricsDraft[]>(initialStore.drafts);
  const [draft, setDraft] = useState<LyricsDraft>(() => initialStore.drafts.find(item => item.id === initialStore.activeId) || initialStore.drafts[0] || createDraft());
  const [saveStatus, setSaveStatus] = useState('Auto-save on');
  const [notice, setNotice] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [find, setFind] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [rhymeWord, setRhymeWord] = useState('');
  const [history, setHistory] = useState<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastEditTime = useRef(0);
  const draftsRef = useRef(drafts);
  const lastSaved = useRef('');
  const skipPersistence = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const statistics = useMemo(() => lyricsStatistics(draft.text), [draft.text]);
  const rhymes = useMemo(() => findRhymes(rhymeWord, draft.text), [rhymeWord, draft.text]);

  function announce(message: string) {
    setNotice(message);
    onNotice?.(message);
  }

  // Draft content never leaves this browser. Keep local writes small and debounce
  // keystrokes so editing does not block on localStorage.
  useEffect(() => {
    if (skipPersistence.current) return;
    if (!draft.title && !draft.text && !draftsRef.current.some(item => item.id === draft.id)) return;
    const serialized = JSON.stringify({ id: draft.id, title: draft.title, text: draft.text });
    if (serialized === lastSaved.current) return;
    setSaveStatus('Saving…');
    const timer = window.setTimeout(() => {
      if (skipPersistence.current) return;
      const savedDraft = { ...draft, updatedAt: Date.now() };
      const nextDrafts = [savedDraft, ...draftsRef.current.filter(item => item.id !== draft.id)].slice(0, 50);
      try {
        localStorage.setItem(LYRICS_STORAGE_KEY, JSON.stringify({ activeId: draft.id, drafts: nextDrafts }));
        draftsRef.current = nextDrafts;
        setDrafts(nextDrafts);
        lastSaved.current = serialized;
        setSaveStatus('Saved on this device');
      } catch {
        setSaveStatus('Storage full · export to keep your lyrics');
      }
    }, 450);
    saveTimer.current = timer;
    return () => { window.clearTimeout(timer); if (saveTimer.current === timer) saveTimer.current = null; };
  }, [draft]);

  // Flush the latest content when changing tools or closing the page before the
  // debounce finishes. No audio data is involved in these lyric-only saves.
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  useEffect(() => {
    const flush = () => {
      if (skipPersistence.current) return;
      const current = latestDraft.current;
      if (!current.title && !current.text && !draftsRef.current.some(item => item.id === current.id)) return;
      try {
        const next = [{ ...current, updatedAt: Date.now() }, ...draftsRef.current.filter(item => item.id !== current.id)].slice(0, 50);
        localStorage.setItem(LYRICS_STORAGE_KEY, JSON.stringify({ activeId: current.id, drafts: next }));
        draftsRef.current = next;
      } catch { /* Export remains available when browser storage is unavailable. */ }
    };
    const clear = () => {
      // Settings remounts this editor after removing local data. Block every
      // pending write on the old instance, including its unmount cleanup.
      skipPersistence.current = true;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const empty = createDraft();
      latestDraft.current = empty;
      draftsRef.current = [];
      lastSaved.current = '';
      lastEditTime.current = 0;
      setDraft(empty);
      setDrafts([]);
      setHistory({ past: [], future: [] });
      setFind('');
      setReplacement('');
      setMatchCase(false);
      setRhymeWord('');
      setNotice('');
      setSaveStatus('Auto-save on');
      setDraftsOpen(false);
      setInspectorOpen(false);
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('sunix:clear', clear);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('sunix:clear', clear);
      flush();
    };
  }, []);

  function edit(next: Snapshot, separateHistory = false) {
    const now = Date.now();
    if (next.text === draft.text && next.title === draft.title) return;
    const checkpoint = separateHistory || now - lastEditTime.current > 700 || history.past.length === 0;
    setHistory(value => ({ past: checkpoint ? [...value.past, { title: draft.title, text: draft.text }].slice(-80) : value.past, future: [] }));
    lastEditTime.current = separateHistory ? 0 : now;
    setDraft(value => ({ ...value, ...next }));
  }

  function undo() {
    const previous = history.past.at(-1);
    if (!previous) return;
    setHistory(value => ({ past: value.past.slice(0, -1), future: [{ title: draft.title, text: draft.text }, ...value.future] }));
    setDraft(value => ({ ...value, ...previous }));
    lastEditTime.current = 0;
  }

  function redo() {
    const next = history.future[0];
    if (!next) return;
    setHistory(value => ({ past: [...value.past, { title: draft.title, text: draft.text }], future: value.future.slice(1) }));
    setDraft(value => ({ ...value, ...next }));
    lastEditTime.current = 0;
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.id !== 'lyrics-title' && target.id !== 'lyrics-editor') return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
  }

  function insertSection(section: string) {
    const area = editorRef.current;
    const start = area?.selectionStart ?? draft.text.length;
    const end = area?.selectionEnd ?? start;
    const before = draft.text.slice(0, start);
    const after = draft.text.slice(end);
    const insertion = `${before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}[${section}]\n`;
    edit({ title: draft.title, text: before + insertion + after }, true);
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  }

  function persistBeforeSwitch() {
    if (skipPersistence.current) return;
    if (!draft.title && !draft.text && !draftsRef.current.some(item => item.id === draft.id)) return;
    const next = [{ ...draft, updatedAt: Date.now() }, ...draftsRef.current.filter(item => item.id !== draft.id)].slice(0, 50);
    draftsRef.current = next;
    setDrafts(next);
    try { localStorage.setItem(LYRICS_STORAGE_KEY, JSON.stringify({ activeId: draft.id, drafts: next })); }
    catch { announce('Could not save locally. Export TXT to keep your lyrics.'); }
  }

  function openDraft(nextDraft: LyricsDraft) {
    persistBeforeSwitch();
    setDraft(nextDraft);
    setHistory({ past: [], future: [] });
    lastEditTime.current = 0;
    lastSaved.current = '';
    setSaveStatus('Saved on this device');
    setDraftsOpen(false);
    setNotice('');
  }

  function newDraft() {
    persistBeforeSwitch();
    setDraft(createDraft());
    setHistory({ past: [], future: [] });
    lastEditTime.current = 0;
    lastSaved.current = '';
    setSaveStatus('Auto-save on');
    setNotice('');
    setDraftsOpen(false);
    requestAnimationFrame(() => editorRef.current?.focus());
  }

  async function openTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { announce('Choose a text file smaller than 2 MB.'); return; }
    try {
      const text = await file.text();
      if (text.includes('\0')) { announce('Choose a plain text file.'); return; }
      persistBeforeSwitch();
      setDraft({ ...createDraft(), title: file.name.replace(/\.[^.]+$/, ''), text });
      setHistory({ past: [], future: [] });
      lastEditTime.current = 0;
      lastSaved.current = '';
      setDraftsOpen(false);
      announce('Lyrics opened.');
    } catch { announce('Could not open this text file.'); }
  }

  function downloadLyrics() {
    const content = `${draft.title ? `${draft.title}\n\n` : ''}${draft.text}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(draft.title.trim() || 'SUNIX Lyrics').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    announce('Lyrics exported.');
  }

  async function copyLyrics() {
    const content = `${draft.title ? `${draft.title}\n\n` : ''}${draft.text}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(content);
      announce('Lyrics copied.');
    } catch {
      const area = editorRef.current;
      area?.focus();
      area?.select();
      announce('Lyrics selected. Use your device’s Copy action.');
    }
  }

  function replaceAll() {
    const result = replaceLiteral(draft.text, find, replacement, matchCase);
    if (result.count) edit({ title: draft.title, text: result.text }, true);
    announce(result.count ? `Replaced ${result.count} ${result.count === 1 ? 'match' : 'matches'}.` : 'No matches found.');
  }

  return <div className="lyrics-studio" onKeyDown={keyboard}>
    <div className="workspace-heading lyrics-heading">
      <div><p className="eyebrow">YOUR WORDS, YOUR SPACE</p><h1>Lyrics Studio</h1></div>
      <div className="lyrics-header-actions">
        <button className="button button-ghost" onClick={() => setDraftsOpen(value => !value)} aria-expanded={draftsOpen} aria-controls="lyrics-saved-drafts"><Glyph name="folder" /><span>Drafts</span></button>
        <button className="button button-primary" onClick={downloadLyrics} disabled={!draft.text && !draft.title}><Glyph name="download" /><span>Export TXT</span></button>
      </div>
    </div>

    {draftsOpen && <section className="panel lyrics-drafts" id="lyrics-saved-drafts" aria-label="Saved lyrics">
      <div className="lyrics-drafts-heading"><h2>On this device</h2><div className="lyrics-header-actions"><button className="button button-ghost" onClick={() => fileRef.current?.click()}><Glyph name="folder" />Open TXT</button><button className="button button-ghost" onClick={newDraft}><Glyph name="plus" />New lyrics</button></div></div>
      {drafts.length ? <div className="lyrics-draft-list">{drafts.map(item => <button className={`lyrics-draft-item${item.id === draft.id ? ' is-active' : ''}`} key={item.id} onClick={() => openDraft(item)}><strong>{item.title.trim() || 'Untitled lyrics'}</strong><span className="muted">{new Date(item.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></button>)}</div> : <p className="muted">Your lyrics save here as you write.</p>}
    </section>}
    <input type="file" accept=".txt,.text,text/plain" ref={fileRef} onChange={openTextFile} hidden aria-label="Open lyrics text file" />

    <div className={`lyrics-layout${inspectorOpen ? ' has-inspector' : ''}`}>
      <section className="panel lyrics-editor-panel" aria-label="Lyrics editor">
        <div className="lyrics-editor-topline"><span className="lyrics-autosave muted"><span className="lyrics-save-dot" aria-hidden="true" />{saveStatus}</span><div className="lyrics-edit-actions"><button className="icon-button" aria-label="Undo" title="Undo" onClick={undo} disabled={!history.past.length}><Glyph name="undo" /></button><button className="icon-button" aria-label="Redo" title="Redo" onClick={redo} disabled={!history.future.length}><Glyph name="redo" /></button><button className="icon-button" aria-label="Copy lyrics" title="Copy lyrics" onClick={copyLyrics} disabled={!draft.text && !draft.title}><Glyph name="copy" /></button></div></div>
        <label className="sr-only" htmlFor="lyrics-title">Song title</label>
        <input id="lyrics-title" className="lyrics-title-input" placeholder="Untitled lyrics" value={draft.title} maxLength={200} onChange={event => edit({ title: event.target.value, text: draft.text })} autoComplete="off" />
        <div className="lyrics-section-buttons" aria-label="Insert song section">{SECTIONS.map(section => <button className="lyrics-section-chip" key={section} onClick={() => insertSection(section)} aria-label={`Insert ${section} section`}>+ {section}</button>)}</div>
        <label className="sr-only" htmlFor="lyrics-editor">Your lyrics</label>
        <textarea id="lyrics-editor" className="lyrics-textarea" ref={editorRef} placeholder="A thought. A feeling. A first line…" value={draft.text} onChange={event => edit({ title: draft.title, text: event.target.value })} spellCheck aria-describedby="lyrics-editor-statistics" />
        <div className="lyrics-editor-footer"><p className="muted" id="lyrics-editor-statistics">{statistics.words.toLocaleString()} words<span aria-hidden="true"> · </span>{statistics.lines.toLocaleString()} lines</p><button className={`button button-ghost${inspectorOpen ? ' is-active' : ''}`} aria-expanded={inspectorOpen} aria-controls="lyrics-inspector" onClick={() => setInspectorOpen(value => !value)}><Glyph name="tools" />Writing tools</button></div>
      </section>

      {inspectorOpen && <aside className="panel lyrics-inspector" id="lyrics-inspector" aria-label="Writing tools">
        <div className="lyrics-inspector-title"><h2>Writing tools</h2><button className="icon-button" aria-label="Close writing tools" onClick={() => setInspectorOpen(false)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
        <div className="lyrics-stat-grid"><div><strong>{statistics.words.toLocaleString()}</strong><span>Words</span></div><div><strong>{statistics.characters.toLocaleString()}</strong><span>Characters</span></div><div><strong>{statistics.lines.toLocaleString()}</strong><span>Lines</span></div><div><strong>~{statistics.syllables.toLocaleString()}</strong><span>Syllables</span></div></div>
        <p className="lyrics-tool-hint muted">Syllables are an English approximation. Section labels are excluded from word and line counts.</p>
        <details className="lyrics-tool-section" open><summary>Rhyme helper</summary><label className="field-label" htmlFor="rhyme-word">Find a rhyme for</label><input className="field" id="rhyme-word" value={rhymeWord} maxLength={50} onChange={event => setRhymeWord(event.target.value)} placeholder="Try a word" autoComplete="off" />{rhymeWord.trim() && <div className="lyrics-rhyme-results">{rhymes.exact.length ? <div className="lyrics-rhyme-chips">{rhymes.exact.map(word => <span key={word}>{word}</span>)}</div> : <p className="muted">No sound family in the offline dictionary.</p>}{rhymes.nearby.length > 0 && <><p className="lyrics-tool-hint muted">Similar endings</p><div className="lyrics-rhyme-chips">{rhymes.nearby.map(word => <span key={word}>{word}</span>)}</div></>}</div>}</details>
        <details className="lyrics-tool-section"><summary>Find &amp; replace</summary><label className="field-label" htmlFor="lyrics-find">Find</label><input id="lyrics-find" className="field" value={find} onChange={event => setFind(event.target.value)} /><label className="field-label" htmlFor="lyrics-replacement">Replace with</label><input id="lyrics-replacement" className="field" value={replacement} onChange={event => setReplacement(event.target.value)} /><label className="lyrics-checkbox"><input type="checkbox" checked={matchCase} onChange={event => setMatchCase(event.target.checked)} />Match case</label><button className="button button-ghost" onClick={replaceAll} disabled={!find}>Replace all</button></details>
        <details className="lyrics-tool-section"><summary>Repeated lines <span className="muted">{statistics.duplicates.length || ''}</span></summary>{statistics.duplicates.length ? <ul className="lyrics-duplicates">{statistics.duplicates.map(item => <li key={item.line}><span>{item.line}</span><strong>×{item.count}</strong></li>)}</ul> : <p className="muted">No repeated lines.</p>}</details>
        <button className="button button-ghost lyrics-new-button" onClick={newDraft}><Glyph name="plus" />New lyrics</button>
      </aside>}
    </div>
    {notice && !onNotice && <p className="lyrics-notice muted" role="status">{notice}</p>}
  </div>;
}
