// Deterministic peer identity: adjective-animal name + color badge from peer id hash.

const ADJECTIVES = [
  'amber', 'azure', 'bold', 'calm', 'crisp', 'dusk', 'echo', 'fern',
  'gale', 'haze', 'idle', 'jade', 'keen', 'lark', 'mist', 'nova',
  'opal', 'pine', 'quill', 'rime', 'sage', 'teal', 'umber', 'vale',
  'wren', 'zinc', 'arch', 'brisk', 'cedar', 'dawn',
];

const ANIMALS = [
  'otter', 'crane', 'finch', 'heron', 'ibis', 'kite', 'loon', 'merlin',
  'newt', 'osprey', 'plover', 'quail', 'raven', 'snipe', 'swift',
  'tern', 'viper', 'wagtail', 'xenops', 'yak', 'zebu', 'adder', 'booby',
  'caiman', 'dhole', 'egret', 'falcon', 'gecko', 'harrier', 'impala',
];

// Each palette entry: [bg, fg text, border] — muted, accessible, x402-aligned.
const PALETTE: Array<{ bg: string; fg: string; border: string }> = [
  { bg: '#f0faf4', fg: '#0a7739', border: '#c6e8d4' }, // accent green
  { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' }, // blue
  { bg: '#fdf4ff', fg: '#7e22ce', border: '#e9d5ff' }, // purple
  { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' }, // orange
  { bg: '#fef9c3', fg: '#854d0e', border: '#fde68a' }, // amber
  { bg: '#f0f9ff', fg: '#0369a1', border: '#bae6fd' }, // sky
  { bg: '#f0fdf4', fg: '#166534', border: '#bbf7d0' }, // emerald
  { bg: '#fff1f2', fg: '#be123c', border: '#fecdd3' }, // rose
];

// FNV-1a 32-bit hash — fast, deterministic, good distribution.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function peerName(id: string): string {
  const h = fnv1a(id);
  const adj    = ADJECTIVES[h % ADJECTIVES.length];
  const animal = ANIMALS[(h >>> 5) % ANIMALS.length];
  return `${adj}-${animal}`;
}

export function peerColor(id: string): { bg: string; fg: string; border: string } {
  const h = fnv1a(id);
  return PALETTE[(h >>> 3) % PALETTE.length];
}
