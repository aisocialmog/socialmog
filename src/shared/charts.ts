/**
 * Minimal SVG charts rendered to strings, shared by the web app (with a CSS/JS hover layer)
 * and PDF reports (static). Specs follow the dataviz skill: 2px lines, ~10% area wash,
 * <=24px bars with 4px rounded data-ends, 2px gaps, hairline solid grid, one y-axis,
 * legend for >=2 series, selective direct labels, text in ink colors (never series colors).
 */

export interface ChartTheme {
  text: string;
  muted: string;
  grid: string;
  axis: string;
  surface: string;
  critical: string;
}

/** Validated categorical slots (dataviz reference palette, light/dark). */
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
export const SERIES_CSS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
export const THEME_CSS: ChartTheme = { text: 'var(--text)', muted: 'var(--muted)', grid: 'var(--grid)', axis: 'var(--axis)', surface: 'var(--surface)', critical: 'var(--critical)' };
export const THEME_PRINT: ChartTheme = { text: '#0b0b0b', muted: '#6b6a66', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#ffffff', critical: '#d03b3b' };

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    max = min === 0 ? 1 : min + Math.abs(min) * 0.1;
    min = Math.min(0, min);
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)!;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

const font = 'font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"';

function legend(series: Series[], x: number, y: number, theme: ChartTheme, kind: 'line' | 'rect'): string {
  if (series.length < 2) return '';
  let cx = x;
  return series
    .map((s) => {
      const key = kind === 'line' ? `<line x1="${cx}" x2="${cx + 14}" y1="${y}" y2="${y}" stroke="${s.color}" stroke-width="2" stroke-linecap="round"/>` : `<rect x="${cx}" y="${y - 5}" width="10" height="10" rx="2" fill="${s.color}"/>`;
      const out = `${key}<text x="${cx + (kind === 'line' ? 19 : 15)}" y="${y + 4}" font-size="11" fill="${theme.text}" ${font}>${esc(s.name)}</text>`;
      cx += (kind === 'line' ? 26 : 22) + s.name.length * 6.2;
      return out;
    })
    .join('');
}

export interface LineOptions {
  labels: string[];
  series: Series[];
  width?: number;
  height?: number;
  yFormat?: (n: number) => string;
  reference?: { value: number; label: string };
  interactive?: boolean;
  theme: ChartTheme;
  title?: string;
}

export function lineChart(o: LineOptions): string {
  const W = o.width ?? 720;
  const H = o.height ?? 240;
  const fmt = o.yFormat ?? ((n: number) => n.toLocaleString('en-IN'));
  const all = o.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (o.reference) all.push(o.reference.value);
  if (!all.length) return emptyChart(W, H, o.theme);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const left = Math.max(...ticks.map((t) => fmt(t).length)) * 6.6 + 12;
  const top = o.series.length > 1 ? 30 : 14;
  const right = 72;
  const bottom = 26;
  const pw = W - left - right;
  const ph = H - top - bottom;
  const n = o.labels.length;
  const x = (i: number) => left + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
  const parts: string[] = [];
  parts.push(legend(o.series, left, 12, o.theme, 'line'));
  for (const t of ticks) {
    parts.push(`<line x1="${left}" x2="${left + pw}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? o.theme.axis : o.theme.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${left - 8}" y="${y(t) + 4}" font-size="11" text-anchor="end" fill="${o.theme.muted}" ${font}>${esc(fmt(t))}</text>`);
  }
  const step = Math.max(1, Math.ceil(n / 7));
  for (let i = 0; i < n; i += step) parts.push(`<text x="${x(i)}" y="${H - 8}" font-size="11" text-anchor="middle" fill="${o.theme.muted}" ${font}>${esc(o.labels[i])}</text>`);
  if (o.reference) {
    const ry = y(o.reference.value);
    parts.push(`<line x1="${left}" x2="${left + pw}" y1="${ry}" y2="${ry}" stroke="${o.theme.critical}" stroke-width="1"/>`);
    parts.push(`<text x="${left + pw + 6}" y="${ry + 4}" font-size="11" fill="${o.theme.text}" ${font}>${esc(o.reference.label)}</text>`);
  }
  for (const s of o.series) {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    if (o.series.length === 1 && s.values.every((v) => v !== null)) {
      parts.push(`<path d="${d}L${x(n - 1).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}L${x(0).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}Z" fill="${s.color}" fill-opacity="0.1"/>`);
    }
    parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    const lastI = s.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
    if (lastI !== undefined && o.series.length <= 4) {
      const v = s.values[lastI]!;
      parts.push(`<circle cx="${x(lastI)}" cy="${y(v)}" r="4" fill="${s.color}" stroke="${o.theme.surface}" stroke-width="2"/>`);
      parts.push(`<text x="${x(lastI) + 8}" y="${y(v) + 4}" font-size="11" font-weight="600" fill="${o.theme.text}" ${font}>${esc(fmt(v))}</text>`);
    }
  }
  if (o.interactive) {
    const colW = n <= 1 ? pw : pw / (n - 1);
    for (let i = 0; i < n; i++) {
      const tip = [o.labels[i], ...o.series.map((s) => `${s.name}: ${s.values[i] === null ? 'unavailable' : fmt(s.values[i]!)}`)].join('\n');
      const marks = o.series.map((s) => (s.values[i] === null ? '' : `<circle class="mk" cx="${x(i)}" cy="${y(s.values[i]!)}" r="4" fill="${s.color}" stroke="${o.theme.surface}" stroke-width="2"/>`)).join('');
      parts.push(`<g class="hit" tabindex="0" data-tip="${esc(tip)}"><rect x="${x(i) - colW / 2}" y="${top}" width="${colW}" height="${ph}" fill="transparent"/><line class="xh" x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${top + ph}" stroke="${o.theme.muted}" stroke-width="1"/>${marks}</g>`);
    }
  }
  return wrap(W, H, parts.join(''), o.title);
}

export interface BarOptions {
  categories: string[];
  series: Series[];
  width?: number;
  height?: number;
  yFormat?: (n: number) => string;
  interactive?: boolean;
  theme: ChartTheme;
  title?: string;
}

/** Grouped vertical bars sharing one baseline at zero. */
export function barChart(o: BarOptions): string {
  const W = o.width ?? 720;
  const H = o.height ?? 240;
  const fmt = o.yFormat ?? ((n: number) => n.toLocaleString('en-IN'));
  const all = o.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (!all.length) return emptyChart(W, H, o.theme);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const left = Math.max(...ticks.map((t) => fmt(t).length)) * 6.6 + 12;
  const top = o.series.length > 1 ? 30 : 14;
  const bottom = 26;
  const pw = W - left - 12;
  const ph = H - top - bottom;
  const y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
  const band = pw / o.categories.length;
  const k = o.series.length;
  const bw = Math.min(24, (band * 0.7 - (k - 1) * 2) / k);
  const parts: string[] = [legend(o.series, left, 12, o.theme, 'rect')];
  for (const t of ticks) {
    parts.push(`<line x1="${left}" x2="${left + pw}" y1="${y(t)}" y2="${y(t)}" stroke="${o.theme.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${left - 8}" y="${y(t) + 4}" font-size="11" text-anchor="end" fill="${o.theme.muted}" ${font}>${esc(fmt(t))}</text>`);
  }
  o.categories.forEach((c, ci) => {
    const gx = left + ci * band + (band - (k * bw + (k - 1) * 2)) / 2;
    const maxLen = Math.max(4, Math.floor(band / 6.5));
    parts.push(`<text x="${left + ci * band + band / 2}" y="${H - 8}" font-size="11" text-anchor="middle" fill="${o.theme.muted}" ${font}>${esc(c.length > maxLen ? `${c.slice(0, maxLen - 1)}…` : c)}</text>`);
    o.series.forEach((s, si) => {
      const v = s.values[ci];
      if (v === null || v === 0) return;
      const x0 = gx + si * (bw + 2);
      const y0 = y(0);
      const y1 = y(v);
      const h = Math.abs(y0 - y1);
      const r = Math.min(4, h, bw / 2);
      // Rounded data-end, square at the baseline.
      const d = v > 0
        ? `M${x0},${y0}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + bw - r}Q${x0 + bw},${y1} ${x0 + bw},${y1 + r}V${y0}Z`
        : `M${x0},${y0}V${y1 - r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + bw - r}Q${x0 + bw},${y1} ${x0 + bw},${y1 - r}V${y0}Z`;
      const tip = `${c}\n${s.name}: ${fmt(v)}`;
      parts.push(o.interactive ? `<g class="bar" tabindex="0" data-tip="${esc(tip)}"><rect x="${x0 - 2}" y="${Math.min(y0, y1) - 6}" width="${bw + 4}" height="${h + 12}" fill="transparent"/><path d="${d}" fill="${s.color}"/></g>` : `<path d="${d}" fill="${s.color}"/>`);
    });
  });
  parts.push(`<line x1="${left}" x2="${left + pw}" y1="${y(0)}" y2="${y(0)}" stroke="${o.theme.axis}" stroke-width="1"/>`);
  return wrap(W, H, parts.join(''), o.title);
}

function emptyChart(W: number, H: number, theme: ChartTheme): string {
  return wrap(W, H, `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="${theme.muted}" ${font}>No data available for this period</text>`);
}

function wrap(W: number, H: number, body: string, title?: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"${title ? ` aria-label="${esc(title)}"` : ''}>${body}</svg>`;
}
