// Owner reports, worked out in the browser from the orders and payments of the chosen range.
// Rejected and cancelled orders never count as sales.

export interface ReportOrder {
  id: string;
  status: string;
  created_at: string;
  table_number: string;
  seating_id?: string | null;
  items: { items?: { name: string; price: number; quantity?: number }[]; timeline?: Record<string, string> } | null;
}
export interface ReportPayment { amount: number; tip?: number; mode: string; status: string }

export interface SalesReport {
  sales: number;
  orders: number;
  bills: number;
  avgBill: number;
  kitchenMinutes: number | null;
  items: { name: string; qty: number; revenue: number }[];
  hours: { hour: number; orders: number; sales: number }[];
  peakHour: number | null;
  tables: { table: string; sales: number; orders: number }[];
  payModes: { mode: string; amount: number }[];
  tips: number;
  voided: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function salesReport(orders: ReportOrder[], payments: ReportPayment[] = [], hourOf = (d: Date) => d.getHours()): SalesReport {
  const billed = orders.filter(o => !["rejected", "cancelled"].includes(o.status));
  const items = new Map<string, { qty: number; revenue: number }>();
  const tables = new Map<string, { sales: number; orders: number }>();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, sales: 0 }));
  const bills = new Set<string>();
  const kitchen: number[] = [];
  let sales = 0;

  for (const o of billed) {
    const lines = o.items?.items || [];
    const total = lines.reduce((s, l) => s + Number(l.price) * (l.quantity || 1), 0);
    sales += total;
    bills.add(o.seating_id || o.id);
    for (const l of lines) {
      const it = items.get(l.name) || { qty: 0, revenue: 0 };
      it.qty += l.quantity || 1;
      it.revenue += Number(l.price) * (l.quantity || 1);
      items.set(l.name, it);
    }
    const t = tables.get(o.table_number) || { sales: 0, orders: 0 };
    t.sales += total;
    t.orders += 1;
    tables.set(o.table_number, t);
    const h = hours[hourOf(new Date(o.created_at))];
    h.orders += 1;
    h.sales += total;
    const ready = o.items?.timeline?.ready || o.items?.timeline?.completed;
    if (ready) kitchen.push((new Date(ready).getTime() - new Date(o.created_at).getTime()) / 60000);
  }

  const peak = hours.reduce((best, h) => (h.sales > (best?.sales ?? 0) ? h : best), null as (typeof hours)[number] | null);
  const confirmed = payments.filter(p => p.status === "confirmed");
  const modes = new Map<string, number>();
  for (const p of confirmed) modes.set(p.mode, (modes.get(p.mode) || 0) + Number(p.amount));

  return {
    sales: r2(sales),
    orders: billed.length,
    bills: bills.size,
    avgBill: bills.size ? Math.round(sales / bills.size) : 0,
    kitchenMinutes: kitchen.length ? Math.round(kitchen.reduce((a, b) => a + b, 0) / kitchen.length) : null,
    items: [...items].map(([name, v]) => ({ name, qty: v.qty, revenue: r2(v.revenue) }))
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue),
    hours: hours.map(h => ({ ...h, sales: r2(h.sales) })),
    peakHour: peak ? peak.hour : null,
    tables: [...tables].map(([table, v]) => ({ table, sales: r2(v.sales), orders: v.orders })).sort((a, b) => b.sales - a.sales),
    payModes: [...modes].map(([mode, amount]) => ({ mode, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
    tips: r2(confirmed.reduce((s, p) => s + Number(p.tip || 0), 0)),
    voided: orders.length - billed.length,
  };
}

/** "7 PM", "12 AM": an hour the way a restaurant says it */
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

/** Start of the range in local time: today, the last 7 days or the last 30 days */
export function rangeStart(range: "today" | "7d" | "30d", now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (range === "7d") d.setDate(d.getDate() - 6);
  if (range === "30d") d.setDate(d.getDate() - 29);
  return d;
}
