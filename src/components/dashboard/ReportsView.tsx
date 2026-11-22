// Owner reports: sales, orders, average bill and kitchen time for today / 7 / 30 days, bestsellers, peak hours,
// tables and payment modes. Worked out in the browser by src/lib/reports.ts (tested in reports.test.ts).
import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useBusinessType } from "@/hooks/useBusinessType";
import { hourLabel, rangeStart, salesReport, type ReportOrder, type ReportPayment } from "@/lib/reports";
import { inr } from "@/lib/staffApi";
import { cn } from "@/lib/utils";

type Range = "today" | "7d" | "30d";
const RANGES: { value: Range; label: string }[] = [{ value: "today", label: "Today" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }];
const MODE: Record<string, string> = { upi: "UPI", card: "Card", cash: "Cash" };
const compact = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L` : inr(Math.round(n)));
// ponytail: one fetch of up to 5000 orders per range; page through, or aggregate in SQL, if a restaurant outgrows it
const LIMIT = 5000;

export default function ReportsView({ restaurantId }: { restaurantId: string }) {
  const { locationLabel } = useBusinessType(restaurantId);
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<{ orders: ReportOrder[]; payments: ReportPayment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    const from = rangeStart(range).toISOString();
    Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seating_id / payments aren't in the generated types until `supabase gen types` runs
      (supabase.from("orders") as any).select("id, status, created_at, table_number, items, seating_id")
        .eq("restaurant_id", restaurantId).gte("created_at", from).order("created_at").range(0, LIMIT - 1),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("payments" as never) as any).select("amount, tip, mode, status").eq("restaurant_id", restaurantId).gte("created_at", from).range(0, LIMIT - 1),
    ]).then(([o, p]) => {
      if (!live) return;
      if (o.error) { setError("Couldn't load orders. Check your connection and try again."); return; }
      setError(null);
      setData({ orders: o.data || [], payments: p.error ? [] : p.data || [] });
    });
    return () => { live = false; };
  }, [restaurantId, range]);

  const r = useMemo(() => (data ? salesReport(data.orders, data.payments) : null), [data]);
  const maxHour = r ? Math.max(...r.hours.map(h => h.sales), 1) : 1;
  const topItems = r?.items.slice(0, 8) || [];
  const maxItem = Math.max(...topItems.map(i => i.qty), 1);
  const slow = r && r.items.length > 8 ? r.items.slice(-3).reverse() : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center"><BarChart3 className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Reports</h2>
            <p className="text-sm text-muted-foreground">Declined and cancelled orders aren't counted.</p>
          </div>
        </div>
        <div className="inline-flex rounded-full bg-muted p-1" role="radiogroup" aria-label="Period">
          {RANGES.map(x => (
            <button key={x.value} role="radio" aria-checked={range === x.value} onClick={() => setRange(x.value)}
              className={cn("h-8 px-4 rounded-full text-sm font-medium transition-colors", range === x.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{x.label}</button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Sales", value: r ? compact(r.sales) : null, sub: r?.tips ? `+ ${inr(r.tips)} tips` : "Before tips" },
          { label: "Orders", value: r ? String(r.orders) : null, sub: r?.voided ? `${r.voided} declined or cancelled` : "Sent to the kitchen" },
          { label: `Average bill per ${locationLabel.toLowerCase()}`, value: r ? inr(r.avgBill) : null, sub: r ? `${r.bills} ${r.bills === 1 ? "bill" : "bills"}` : "" },
          { label: "Kitchen time", value: r ? (r.kitchenMinutes == null ? "–" : `${r.kitchenMinutes} min`) : null, sub: "Order to ready, on average" },
        ].map(k => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{k.label}</p>
            {k.value == null ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="mt-1 text-[28px] leading-tight font-semibold">{k.value}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{k.sub}</p>
          </div>
        ))}
      </div>

      {r && r.orders === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No orders {range === "today" ? "yet today" : "in this period"}. Reports fill in as guests order from the table.
        </p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Peak hours: one hue, the busiest hour in full strength */}
          <section aria-labelledby="peak-title" className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
            <h3 id="peak-title" className="font-semibold">Busiest hours</h3>
            <p className="text-sm text-muted-foreground">{r?.peakHour != null ? `Most sales around ${hourLabel(r.peakHour)}` : "Sales by hour"}</p>
            {!r ? <Skeleton className="mt-4 h-40" /> : (
              <>
                <div className="mt-5 h-40 flex items-end gap-[2px] border-b border-border" role="list" aria-label="Sales by hour">
                  {r.hours.map(h => (
                    <div key={h.hour} role="listitem" className="group relative flex-1 h-full flex items-end justify-center">
                      <button
                        type="button"
                        aria-label={`${hourLabel(h.hour)}: ${inr(h.sales)}, ${h.orders} ${h.orders === 1 ? "order" : "orders"}`}
                        className={cn("w-full max-w-[24px] rounded-t-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          h.hour === r.peakHour ? "bg-primary" : "bg-primary/30 hover:bg-primary/50")}
                        style={{ height: h.sales ? `${Math.max(3, (h.sales / maxHour) * 100)}%` : "0" }}
                      />
                      <span className="pointer-events-none absolute bottom-full mb-2 hidden group-hover:block group-focus-within:block whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md z-10">
                        <span className="block font-semibold tabular-nums">{inr(h.sales)}</span>
                        <span className="text-muted-foreground">{hourLabel(h.hour)} · {h.orders} {h.orders === 1 ? "order" : "orders"}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex text-[11px] text-muted-foreground tabular-nums" aria-hidden>
                  {r.hours.map(h => <span key={h.hour} className="flex-1 text-center">{h.hour % 6 === 0 ? hourLabel(h.hour).replace(" ", "") : ""}</span>)}
                </div>
              </>
            )}
          </section>

          <RankedBars
            title="Bestsellers"
            sub="By quantity"
            rows={topItems.map(i => ({ name: i.name, value: i.qty, max: maxItem, right: `${i.qty} · ${compact(i.revenue)}` }))}
            loading={!r}
            footer={slow.length > 0 ? `Slowest: ${slow.map(s => `${s.name} (${s.qty})`).join(", ")}` : undefined}
          />

          <div className="space-y-6">
            <RankedBars
              title="Payments"
              sub="Confirmed, by how guests paid"
              rows={(r?.payModes || []).map(m => ({ name: MODE[m.mode] || m.mode, value: m.amount, max: Math.max(...(r?.payModes || []).map(x => x.amount), 1), right: inr(m.amount) }))}
              loading={!r}
              empty="No payments through the app in this period."
            />
            <RankedBars
              title={`Top ${locationLabel.toLowerCase()}s`}
              sub="By sales"
              rows={(r?.tables || []).slice(0, 5).map(t => ({ name: `${locationLabel} ${t.table}`, value: t.sales, max: r?.tables[0]?.sales || 1, right: `${compact(t.sales)} · ${t.orders} ${t.orders === 1 ? "order" : "orders"}` }))}
              loading={!r}
            />
          </div>
        </div>
      )}

      {r && r.orders > 0 && (
        <details className="rounded-2xl border border-border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">Every dish as a table</summary>
          <table className="mt-3 w-full">
            <thead className="text-xs text-muted-foreground"><tr><th className="text-left font-medium py-1.5">Dish</th><th className="text-right font-medium py-1.5">Sold</th><th className="text-right font-medium py-1.5">Sales</th></tr></thead>
            <tbody className="divide-y divide-border">
              {r.items.map(i => <tr key={i.name}><td className="py-1.5">{i.name}</td><td className="py-1.5 text-right tabular-nums">{i.qty}</td><td className="py-1.5 text-right tabular-nums">{inr(i.revenue)}</td></tr>)}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

/** Ranked horizontal bars, one hue: compares parts on one baseline */
function RankedBars({ title, sub, rows, loading, footer, empty }: {
  title: string; sub: string; rows: { name: string; value: number; max: number; right: string }[]; loading: boolean; footer?: string; empty?: string;
}) {
  return (
    <section aria-label={title} className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{sub}</p>
      {loading ? <Skeleton className="mt-4 h-32" /> : rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{empty || "Nothing yet."}</p> : (
        <ol className="mt-4 space-y-3">
          {rows.map(row => (
            <li key={row.name}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{row.name}</span>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">{row.right}</span>
              </div>
              <div className="mt-1.5 h-2.5" aria-hidden>
                <div className="h-full rounded-r-[4px] bg-primary/80" style={{ width: `${Math.max(2, (row.value / row.max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {footer && <p className="mt-4 text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
}
