/** Utilitários de texto determinísticos (sem regex catastrófica, tudo O(n) ou perto disso). */

const STOP_EN = `a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who why will with would you your`;
const STOP_PT = `a ao aos as até com como da das de dela dele deles depois do dos e ela ele eles em entre era essa esse esta este eu foi for há isso isto já mais mas me mesmo meu minha muito na nas nem no nos nós não o os ou para pela pelo por qual quando que quem se seu sua são só também te tem têm um uma você vocês`;
export const STOPWORDS: ReadonlySet<string> = new Set(`${STOP_EN} ${STOP_PT}`.split(/\s+/));

export function clean(input: string): string {
  return (
    input
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export function words(input: string): string[] {
  return input.match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? [];
}

export function contentWords(input: string): string[] {
  return words(input.toLowerCase()).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function splitSentences(input: string): string[] {
  const out: string[] = [];
  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const part of trimmed.split(/(?<=[.!?…])\s+/u)) {
      const s = part.trim();
      if (s.length > 0) out.push(s);
    }
  }
  return out;
}

export function frequencies(ws: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of ws) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

export const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
