export type IconName = 'home' | 'split' | 'mix' | 'wave' | 'lyrics' | 'upload' | 'arrow' | 'play' | 'pause' | 'stop' | 'download' | 'settings' | 'close' | 'plus' | 'trash' | 'reset' | 'save' | 'chevron' | 'headphones' | 'check' | 'volume'
const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-8h6v8"/></>,
  split: <><path d="M5 3v4c0 4 14 6 14 10v4M19 3v4c0 4-14 6-14 10v4"/><path d="m2 18 3 3 3-3m8-12 3-3 3 3"/></>,
  mix: <><path d="M5 3v5m0 6v7M12 3v9m0 6v3M19 3v2m0 6v10"/><rect x="2" y="8" width="6" height="6" rx="2"/><rect x="9" y="12" width="6" height="6" rx="2"/><rect x="16" y="5" width="6" height="6" rx="2"/></>,
  wave: <><path d="M3 10v4m4-8v12m5-16v20m5-16v12m4-8v4"/></>,
  lyrics: <><path d="M5 4h14M5 9h11M5 14h7M5 19h6m5-5 5-2v7"/><ellipse cx="18" cy="19" rx="3" ry="2"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  play: <path d="m8 4 12 8-12 8Z"/>,
  pause: <><path d="M8 4v16M16 4v16"/></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
  download: <><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
  settings: <><path d="m10 3-1 3-3 1-3 3 2 2-2 2 3 3 3 1 1 3h4l1-3 3-1 3-3-2-2 2-2-3-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  plus: <path d="M12 4v16M4 12h16"/>,
  trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
  reset: <><path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/></>,
  save: <><path d="M4 3h13l4 4v14H3V3ZM7 3v6h10V3M7 21v-8h10v8"/></>,
  chevron: <path d="m8 4 8 8-8 8"/>,
  headphones: <><path d="M3 15v-3a9 9 0 0 1 18 0v3"/><rect x="2" y="12" width="5" height="9" rx="2"/><rect x="17" y="12" width="5" height="9" rx="2"/></>,
  check: <path d="m4 12 5 5L20 6"/>,
  volume: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
}
export default function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
