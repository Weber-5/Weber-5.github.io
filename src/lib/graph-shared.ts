/** Geometry shared by the build-time layout and the browser renderer. No dependencies. */

export type NodeType = 'note' | 'ghost' | 'paper' | 'project';

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Node size follows how connected a note is. */
export function nodeRadius(type: NodeType, degree: number) {
  if (type === 'ghost') return 2.4;
  const r = 2.2 + Math.sqrt(degree) * 1.6;
  return type === 'note' ? r : r + 1.2;
}
