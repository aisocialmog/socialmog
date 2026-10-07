/** Pure calculations shared by server and browser. */
import type { Paise } from './money.ts';

export interface DealLike {
  billing_model?: string | null;
  brand_price?: number | null;
  agency_fee?: number | null;
  editor_costs?: number | null;
  other_costs?: number | null;
  probability?: number | null;
  creators?: { fee?: number | null }[] | null;
}

/** Expected deal economics. Gross: brand price − creator fees − costs. Commission: our fee − costs. */
export function dealEconomics(d: DealLike) {
  const creatorCost: Paise = (d.creators ?? []).reduce((s, c) => s + (Number(c.fee) || 0), 0);
  const costs = (d.editor_costs ?? 0) + (d.other_costs ?? 0);
  const gross = d.billing_model !== 'commission';
  const agencyFee = gross ? (d.brand_price ?? 0) - creatorCost : d.agency_fee ?? 0;
  const margin = agencyFee - costs;
  const probability = Math.min(100, Math.max(0, d.probability ?? 0));
  return { creatorCost, costs, agencyFee, margin, weightedMargin: Math.round((margin * probability) / 100), probability };
}

export const STAGE_PROBABILITY: Record<string, number> = {
  lead: 10, contacted: 20, brief_received: 30, creator_shortlist: 40, proposal_sent: 50, negotiation: 70, won: 100, lost: 0,
};

/** Median of the numbers present; null when there are none. */
export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Percentage change, null when either side is unavailable or the base is zero. */
export function pctChange(current: number | null | undefined, base: number | null | undefined): number | null {
  if (current == null || base == null || base === 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}
