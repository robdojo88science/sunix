export interface LyricsDraft {
  id: string;
  title: string;
  text: string;
  updatedAt: number;
}

export interface LyricsStore {
  activeId: string;
  drafts: LyricsDraft[];
}

export const LYRICS_STORAGE_KEY = 'sunix:lyrics:v1';

export function createDraft(): LyricsDraft {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `lyrics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    text: '',
    updatedAt: Date.now(),
  };
}

export function readLyricsStore(): LyricsStore {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LYRICS_STORAGE_KEY) || 'null');
    if (!value || typeof value !== 'object' || !('drafts' in value) || !Array.isArray(value.drafts)) return { activeId: '', drafts: [] };
    const drafts = value.drafts.filter((draft): draft is LyricsDraft => Boolean(draft) && typeof draft === 'object' && typeof draft.id === 'string' && typeof draft.title === 'string' && typeof draft.text === 'string' && typeof draft.updatedAt === 'number').slice(0, 50);
    return { activeId: 'activeId' in value && typeof value.activeId === 'string' ? value.activeId : '', drafts };
  } catch {
    return { activeId: '', drafts: [] };
  }
}

export function syllablesInWord(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 0;
  if (clean.length <= 3) return 1;
  const withoutSilentEndings = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (withoutSilentEndings.match(/[aeiouy]{1,2}/g) || []).length);
}

export function lyricsStatistics(text: string) {
  const writingLines = text.split(/\r?\n/).filter(line => line.trim() && !/^\s*\[.+\]\s*$/.test(line));
  const words = writingLines.join(' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  const counts = new Map<string, { line: string; count: number }>();
  for (const line of writingLines) {
    const normalized = line.trim().toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ');
    if (!normalized) continue;
    const current = counts.get(normalized);
    counts.set(normalized, { line: line.trim(), count: (current?.count || 0) + 1 });
  }
  return {
    words: words.length,
    characters: [...text].length,
    lines: writingLines.length,
    syllables: words.reduce((sum, word) => sum + syllablesInWord(word), 0),
    duplicates: [...counts.values()].filter(item => item.count > 1),
  };
}

// A deliberately small, offline English rhyme dictionary. Suggestions are
// sound families rather than generated or network-provided writing.
const RHYME_GROUPS = [
  ['light', 'night', 'bright', 'sight', 'flight', 'right', 'white', 'write', 'tonight', 'alright', 'ignite'],
  ['day', 'away', 'stay', 'play', 'say', 'way', 'grey', 'gray'],
  ['fade', 'afraid', 'shade', 'made', 'trade', 'parade'],
  ['blue', 'true', 'you', 'new', 'through', 'too', 'two', 'view', 'knew', 'do'],
  ['heart', 'start', 'apart', 'art', 'part', 'chart', 'smart'],
  ['home', 'alone', 'known', 'own', 'stone', 'grown', 'roam', 'tone', 'chrome'],
  ['fire', 'desire', 'higher', 'wire', 'inspire', 'choir', 'entire'],
  ['dream', 'stream', 'seem', 'gleam', 'beam', 'theme', 'team', 'scream'],
  ['free', 'me', 'be', 'sea', 'see', 'tree', 'key', 'we'],
  ['believe', 'leave', 'grieve', 'receive', 'achieve', 'weave'],
  ['rain', 'pain', 'again', 'chain', 'train', 'remain', 'explain', 'vein'],
  ['love', 'above', 'dove', 'glove', 'shove'],
  ['time', 'rhyme', 'climb', 'chime', 'prime', 'sublime'],
  ['shine', 'mine', 'line', 'sign', 'divine', 'align'],
  ['go', 'slow', 'flow', 'know', 'glow', 'snow', 'show', 'grow', 'below'],
  ['sound', 'found', 'ground', 'around', 'bound', 'round', 'profound'],
  ['feel', 'real', 'heal', 'steal', 'reveal', 'wheel', 'deal'],
  ['air', 'care', 'dare', 'there', 'where', 'share', 'prayer', 'rare'],
  ['soul', 'whole', 'control', 'roll', 'goal', 'toll'],
  ['deep', 'keep', 'sleep', 'leap', 'weep'],
  ['burn', 'turn', 'learn', 'return', 'yearn'],
  ['break', 'wake', 'take', 'shake', 'make', 'ache', 'awake'],
  ['song', 'long', 'strong', 'belong', 'wrong', 'along'],
  ['eyes', 'rise', 'skies', 'flies', 'lies', 'wise', 'surprise'],
  ['fall', 'call', 'all', 'wall', 'small', 'recall'],
  ['beat', 'street', 'heat', 'meet', 'sweet', 'complete', 'repeat'],
];

export function findRhymes(input: string, text: string): { exact: string[]; nearby: string[] } {
  const word = input.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return { exact: [], nearby: [] };
  const group = RHYME_GROUPS.find(words => words.includes(word));
  const exact = group?.filter(candidate => candidate !== word) || [];
  const ending = word.slice(-3);
  const documentWords = text.toLowerCase().match(/[a-z]+/g) || [];
  const nearby = [...new Set([...documentWords, ...RHYME_GROUPS.flat()])].filter(candidate => candidate !== word && !exact.includes(candidate) && candidate.length > 2 && candidate.endsWith(ending)).slice(0, 12);
  return { exact, nearby };
}

export function replaceLiteral(text: string, find: string, replacement: string, matchCase: boolean): { text: string; count: number } {
  if (!find) return { text, count: 0 };
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let count = 0;
  const result = text.replace(new RegExp(escaped, matchCase ? 'g' : 'gi'), () => {
    count += 1;
    return replacement;
  });
  return { text: result, count };
}
