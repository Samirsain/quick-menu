// Bill math shown on the guest's phone, the floor map and the demo.
// The real bill comes from seating_bill() in supabase/migrations/20261122000000_v2_table_service.sql; computeBill mirrors
// it step for step (discount -> service charge -> GST -> round to the rupee) and bill.test.ts checks the same numbers.
// Everything is worked in paise so floats never drift.

export interface BillLine { price: number; quantity?: number }
export interface Discount { kind: "pct" | "flat"; value: number; min_bill?: number; label?: string; code?: string }
export interface PaymentLike { amount: number; tip?: number; status: string; split?: string }
export interface Bill {
  subtotal: number; discount: number; service: number; gst: number; gst_rate: number; service_pct: number;
  total: number; paid: number; pending: number; tips: number; due: number;
}

const toPaise = (rupees: number) => Math.round(Number(rupees || 0) * 100);
const round = (x: number) => Math.round(x + 1e-9);

export function computeBill(
  lines: BillLine[],
  opts: { gstRate: number; servicePct: number; discount?: Discount | null; payments?: PaymentLike[] },
): Bill {
  const sub = lines.reduce((s, l) => s + toPaise(l.price) * (l.quantity || 1), 0);
  const d = opts.discount;
  let disc = 0;
  if (d && sub >= toPaise(d.min_bill || 0)) {
    disc = d.kind === "pct" ? round((sub * d.value) / 100) : Math.min(toPaise(d.value), sub);
  }
  const service = round(((sub - disc) * opts.servicePct) / 100);
  const gst = round(((sub - disc + service) * opts.gstRate) / 100);
  const total = round((sub - disc + service + gst) / 100) * 100;
  const sum = (status: string, field: "amount" | "tip") =>
    (opts.payments || []).filter(p => p.status === status).reduce((s, p) => s + toPaise(p[field] || 0), 0);
  const paid = sum("confirmed", "amount");
  return {
    subtotal: sub / 100, discount: disc / 100, service: service / 100, gst: gst / 100,
    gst_rate: opts.gstRate, service_pct: opts.servicePct, total: total / 100,
    paid: paid / 100, pending: sum("pending", "amount") / 100, tips: sum("confirmed", "tip") / 100,
    due: Math.max(total - paid, 0) / 100,
  };
}

/** What can still be claimed: due minus payments waiting for the cashier */
export const unclaimed = (b: Pick<Bill, "due" | "pending">) => Math.max(toPaise(b.due) - toPaise(b.pending), 0) / 100;

/** n shares in whole rupees that add up exactly to the amount; the first shares carry the leftover */
export function splitEqual(amount: number, n: number): number[] {
  const people = Math.max(1, Math.floor(n));
  const total = toPaise(amount);
  const base = Math.floor(total / people / 100) * 100;
  const stray = (total - base * people) % 100;              // paise that don't make a whole rupee
  let rupees = (total - base * people - stray) / 100;       // whole rupees left over
  return Array.from({ length: people }, (_, i) => {
    const extra = rupees > 0 ? 100 : 0;
    rupees -= extra ? 1 : 0;
    return (base + extra + (i === 0 ? stray : 0)) / 100;
  });
}

/** Your equal share: the next unpaid share of the whole bill, never more than what's left to claim */
export function equalShare(bill: Pick<Bill, "total" | "due" | "pending">, people: number, equalPaymentsSoFar: number): number {
  const shares = splitEqual(bill.total, people);
  const share = shares[Math.min(equalPaymentsSoFar, shares.length - 1)];
  return Math.min(share, unclaimed(bill));
}

/** Pay for what you ate: your items' share of the subtotal, scaled to include discount, service and GST */
export function itemsShare(bill: Pick<Bill, "subtotal" | "total" | "due" | "pending">, picked: BillLine[]): number {
  const sub = toPaise(bill.subtotal);
  if (sub === 0) return 0;
  const mine = picked.reduce((s, l) => s + toPaise(l.price) * (l.quantity || 1), 0);
  const share = round((mine * toPaise(bill.total)) / sub / 100);
  return Math.min(share, Math.floor(unclaimed(bill)));
}

/** Tip on a share, in whole rupees (reel: ₹820 + 10% = ₹902) */
export const tipFor = (amount: number, pct: number) => round((toPaise(amount) * pct) / 100 / 100);

/** A typed amount, at most 2 decimals and never more than what's left; 0 when it isn't a positive number */
export function clampAmount(typed: string | number, bill: Pick<Bill, "due" | "pending">): number {
  const n = Math.floor(Number(String(typed).replace(/[^0-9.]/g, "")) * 100) / 100;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, unclaimed(bill));
}

export type FloorStatus = "free" | "open" | "ordered" | "bill" | "cleaning";

/** One word for a table on the floor map */
export function floorStatus(
  table: { needs_cleaning?: boolean } | null,
  seating: { orders: { status: string }[]; bill?: Pick<Bill, "due" | "pending" | "total"> | null } | null,
  calls: { call_type: string; status: string }[] = [],
): FloorStatus {
  if (!seating) return table?.needs_cleaning ? "cleaning" : "free";
  const live = seating.orders.filter(o => !["rejected", "cancelled"].includes(o.status));
  const cooking = live.some(o => ["pending", "accepted", "preparing", "ready"].includes(o.status));
  const askedForBill = calls.some(c => c.call_type === "bill" && c.status !== "completed");
  const b = seating.bill;
  if (askedForBill || (b && b.pending > 0) || (live.length > 0 && !cooking && b && b.due > 0)) return "bill";
  if (cooking) return "ordered";
  return "open";
}
