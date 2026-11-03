import type { MixTrack } from './audio'

type SavedTrack = Omit<MixTrack, 'buffer'> & { channels: Float32Array[]; sampleRate: number }
type SavedProject = { id: 'current'; name: string; tracks: SavedTrack[]; master: number }
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sunix-projects', 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('projects', { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new Error('Local project storage is unavailable.'))
  })
}
export async function saveProject(name: string, tracks: MixTrack[], master: number) {
  const db = await openDB()
  const project: SavedProject = { id: 'current', name, master, tracks: tracks.map(({buffer, ...t}) => ({...t, sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_,i) => buffer.getChannelData(i).slice())})) }
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(project); tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error('Could not save. Your device may be out of storage.')) }) } finally { db.close() }
}
export async function loadProject(): Promise<{ name: string; tracks: MixTrack[]; master: number } | null> {
  const db = await openDB()
  try {
    const project = await new Promise<SavedProject | undefined>((resolve, reject) => { const req = db.transaction('projects').objectStore('projects').get('current'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('Could not open this project.')) })
    if (!project) return null
    return { name: project.name, master: project.master, tracks: project.tracks.map(({channels, sampleRate,...t}) => { const buffer = new AudioBuffer({length: channels[0].length, numberOfChannels: channels.length, sampleRate}); channels.forEach((c,i) => buffer.copyToChannel(new Float32Array(c),i)); return {...t,buffer} }) }
  } finally { db.close() }
}
export async function clearProjects() { const db = await openDB(); try { await new Promise<void>((resolve,reject)=>{ const tx=db.transaction('projects','readwrite'); tx.objectStore('projects').clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('Could not clear local projects.')) }) } finally { db.close() } }
