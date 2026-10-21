/**
 * Picks what Mutsumi mentions after reading the Skills Morning Brief.
 *
 * Priority: a fresh Tibo quota-reset notice, then an unseen Agent news item,
 * then the day's hottest Skill. Every reading yields one note; items already
 * mentioned are skipped so the next reading moves down the list. Tibo notices
 * rarely carry an exact reset time, so the copy never states one.
 */
export type BriefTibo = {id: string; title?: string; event_status?: string; published_at?: string | null; collected_at?: string};
export type BriefNews = {id: string; title?: string; source?: string; published_at?: string | null; collected_at?: string};
export type BriefSkill = {id: string; name?: string; repository?: string; stars?: number; stars_delta_7d?: number};
export type BriefData = {tibo: BriefTibo[]; news: BriefNews[]; skills: BriefSkill[]};
export type BriefNoteKind = 'tibo' | 'news' | 'skill' | 'missing';
export type BriefNote = {id: string; kind: BriefNoteKind; message: string; meta: string};

const DAY = 86_400_000;
/** Upcoming or in-progress resets stay news for three days, finished ones for two.
 * Each message breaks after its subject so the oval bubble wraps cleanly. */
const TIBO_COPY: Record<string, {message: string; days: number}> = {
  announced: {message: 'Codex\n又要重置了......', days: 3},
  mixed: {message: 'Codex\n又要重置了......', days: 3},
  in_progress: {message: 'Codex 的重置\n正在补发......', days: 3},
  completed: {message: 'Codex\n刚重置过了......', days: 2},
};
const NEWS_DAYS = 7, HOT_SKILLS = 5;

export const MISSING_BRIEF_NOTE: BriefNote = {id: 'missing', kind: 'missing', message: '晨报......\n还没送到', meta: '没有找到 Skills Morning Brief'};

/** Shorten by characters (not UTF-16 units) and mark the cut. */
export function clip(text: string, length: number) {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length <= length ? chars.join('') : chars.slice(0, length - 1).join('') + '…';
}

/** Milliseconds for an ISO time or a bare YYYY-MM-DD day (taken as the end of that day). */
function timeOf(value: string | null | undefined): number {
  if (!value) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(value + 'T23:59:59Z');
  return Date.parse(value);
}
const freshness = (item: {published_at?: string | null; collected_at?: string}) => {
  const published = timeOf(item.published_at);
  return Number.isFinite(published) ? published : timeOf(item.collected_at);
};

function tiboNote(items: BriefTibo[], seen: ReadonlySet<string>, now: number): BriefNote | null {
  const fresh = items
    .filter(item => item.id && TIBO_COPY[item.event_status ?? ''] && !seen.has('tibo:' + item.id))
    .filter(item => {const at = freshness(item); return Number.isFinite(at) && now - at < TIBO_COPY[item.event_status!].days * DAY && at - now < DAY;})
    .sort((a, b) => freshness(b) - freshness(a));
  const item = fresh[0];
  if (!item) return null;
  const day = (item.published_at ?? '').slice(0, 10);
  return {id: 'tibo:' + item.id, kind: 'tibo', message: TIBO_COPY[item.event_status!].message,
    meta: clip(['Tibo', day].filter(Boolean).join(' · '), 24)};
}

/** "Claude Code 发布", "OpenAI 官方动态" → the product name alone. */
export function sourceName(source: string) {
  let name = source.trim();
  for (let i = 0; i < 2; i++) name = name.replace(/\s*(官方)?(动态|更新日志|更新|发布说明|发布|资讯|公告|博客)$/, '').trim();
  return name;
}

function newsNote(items: BriefNews[], seen: ReadonlySet<string>, now: number): BriefNote | null {
  const item = items
    .filter(row => row.id && row.title && !seen.has('news:' + row.id))
    .filter(row => {const at = freshness(row); return Number.isFinite(at) && now - at < NEWS_DAYS * DAY;})
    .sort((a, b) => freshness(b) - freshness(a))[0];
  if (!item) return null;
  const source = sourceName(item.source ?? '');
  return {id: 'news:' + item.id, kind: 'news', message: clip(source || 'Agent', 14) + '\n有新动态......', meta: clip(item.title!, 24)};
}

function skillNote(items: BriefSkill[], seen: readonly string[]): BriefNote | null {
  const hot = items
    .filter(row => row.id && row.name)
    .sort((a, b) => (b.stars_delta_7d ?? 0) - (a.stars_delta_7d ?? 0) || (b.stars ?? 0) - (a.stars ?? 0))
    .slice(0, HOT_SKILLS);
  if (!hot.length) return null;
  // Rotate through the top few: an unseen one first, otherwise the one
  // mentioned longest ago.
  const order = (row: BriefSkill) => seen.indexOf('skill:' + row.id);
  const item = hot.find(row => order(row) < 0) ?? [...hot].sort((a, b) => order(a) - order(b))[0];
  const growth = item.stars_delta_7d ? `★ +${item.stars_delta_7d}（7 天）` : '';
  return {id: 'skill:' + item.id, kind: 'skill', message: '今天的热门......\n' + clip(item.name!, 18),
    meta: clip([growth, item.repository].filter(Boolean).join(' · '), 24)};
}

/** The note for this reading. `seen` lists earlier note ids, oldest first. */
export function pickBriefNote(data: BriefData | null, seen: readonly string[], now = Date.now()): BriefNote {
  if (!data) return MISSING_BRIEF_NOTE;
  const set = new Set(seen);
  return tiboNote(data.tibo, set, now) ?? newsNote(data.news, set, now) ?? skillNote(data.skills, seen) ??
    {id: 'quiet', kind: 'news', message: '今天的晨报\n很安静......', meta: 'Skills Morning Brief'};
}

/** Remember a mentioned note, keeping the most recent ones. */
export function rememberNote(seen: readonly string[], id: string, limit = 300): string[] {
  if (id === 'missing' || id === 'quiet') return [...seen];
  return [...seen.filter(item => item !== id), id].slice(-limit);
}
