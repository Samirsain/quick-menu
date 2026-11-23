// Live floor: every table at a glance (free, seated, ordered, bill due, cleaning), the payments waiting for a
// staff confirm, and one sheet per table that shows the one thing to do next (everything else folds away).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronDown, Clock, Loader2, LayoutGrid, Printer, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useOnShift } from "@/hooks/useOnShift";
import { floorStatus, type FloorStatus } from "@/lib/bill";
import { buildBillHtml, printHtml } from "@/lib/printKot";
import { staffApi, staffErrorCopy, inr, since, PAY_MODE, type DiningTable, type FloorCall, type FloorPayment, type FloorSeating, type FloorState } from "@/lib/staffApi";
import { cn } from "@/lib/utils";

// ---------- data ----------

/** floor_state, kept live by realtime (debounced) with a slow poll as a safety net */
export function useFloor(restaurantId: string) {
  const [floor, setFloor] = useState<FloorState | null>(null);
  const [config, setConfig] = useState<{ numbers: string[]; name: string; goal: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try { setFloor(await staffApi.floor(restaurantId)); setError(null); } catch (e) { setError(staffErrorCopy(e)); }
  }, [restaurantId]);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 350); }, [load]);

  useEffect(() => {
    load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- v2 columns aren't in the generated types until `supabase gen types` runs
    (supabase.from("restaurants") as any).select("name, table_config, loyalty").eq("id", restaurantId).single()
      .then(({ data }: { data: { name: string; table_config: { total?: number; skip?: number[] }; loyalty?: { goal?: number } } | null }) => {
        const tc = data?.table_config || {};
        const skip = new Set(tc.skip || []);
        const numbers = Array.from({ length: tc.total || 10 }, (_, i) => i + 1).filter(n => !skip.has(n)).map(String);
        setConfig({ numbers, name: data?.name || "", goal: data?.loyalty?.goal || 200 });
      });
    const ch = supabase.channel(`floor-${restaurantId}-${Date.now()}`);
    for (const table of ["dining_tables", "seatings", "payments", "orders", "service_calls"]) {
      ch.on("postgres_changes" as never, { event: "*", schema: "public", table, filter: `restaurant_id=eq.${restaurantId}` } as never, soon);
    }
    ch.subscribe();
    const poll = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); clearTimeout(timer.current); };
  }, [restaurantId, load, soon]);

  return { floor, config, error, reload: load };
}

export interface TableRow {
  number: string;
  table: DiningTable | null;
  seating: FloorSeating | null;
  mergedInto: string | null; // table number whose bill this table shares
  status: FloorStatus;
  calls: number;
  pendingPay: number;
}

export function tableRows(floor: FloorState | null, numbers: string[]): TableRow[] {
  if (!floor) return [];
  const all = [...new Set([...numbers, ...floor.tables.map(t => t.table_number)])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return all.map(n => {
    const table = floor.tables.find(t => t.table_number === n) || null;
    const own = floor.seatings.find(s => s.table_number === n) || null;
    const target = own?.status === "merged" ? floor.seatings.find(s => s.id === own.merged_into) || null : own;
    const calls = floor.calls.filter(c => c.table_number === n);
    const seatingForStatus = target ? { orders: target.orders, bill: target.bill } : null;
    return {
      number: n, table, seating: target,
      mergedInto: own?.status === "merged" ? target?.table_number ?? null : null,
      status: floorStatus(table, seatingForStatus, calls),
      calls: calls.filter(c => c.status === "pending").length,
      pendingPay: target?.payments.filter(p => p.status === "pending").length ?? 0,
    };
  });
}

export const STATUS_LOOK: Record<FloorStatus, { label: string; dot: string; tile: string }> = {
  free: { label: "Free", dot: "bg-emerald-500", tile: "bg-card border-border" },
  open: { label: "Seated", dot: "bg-amber-500", tile: "bg-amber-500/[0.06] border-amber-500/30" },
  ordered: { label: "Ordered", dot: "bg-sky-500", tile: "bg-sky-500/[0.06] border-sky-500/30" },
  bill: { label: "Bill due", dot: "bg-red-500", tile: "bg-red-500/[0.06] border-red-500/35" },
  cleaning: { label: "Cleaning", dot: "bg-muted-foreground/60", tile: "bg-muted/60 border-border border-dashed" },
};

export const CALL_LABEL: Record<string, string> = { waiter: "Waiter", water: "Water", bill: "Bill", help: "Help", clean: "Clean the table" };

const PAY_HINT: Record<FloorPayment["mode"], string> = {
  upi: "Check your UPI app for this amount, then confirm",
  cash: "Collect the cash, then confirm",
  card: "Take the card machine over, then confirm",
};

/** One payment a guest says they made: staff confirm it or mark it not received */
function PayToConfirm({ p, table, busy, onSettle }: { p: FloorPayment; table?: string; busy: string | null; onSettle: (accept: boolean) => void }) {
  return (
    <li className="py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {table && <span className="font-display text-base mr-2">{table}</span>}
          <span className="tabular-nums">{inr(p.amount + p.tip)}</span>
          <span className="font-normal text-muted-foreground"> · {PAY_MODE[p.mode]}{p.payer ? ` · ${p.payer}` : ""}</span>
        </p>
        <p className="text-xs text-muted-foreground">{PAY_HINT[p.mode]}{p.tip > 0 && ` · includes ${inr(p.tip)} tip`}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => onSettle(false)}>Not received</Button>
        <Button size="sm" disabled={!!busy} onClick={() => onSettle(true)}>
          {busy === `p${p.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
        </Button>
      </div>
    </li>
  );
}

// ---------- floor map ----------

export default function FloorView({ restaurantId }: { restaurantId: string }) {
  const { floor, config, error, reload } = useFloor(restaurantId);
  const { locationLabel } = useBusinessType(restaurantId);
  const { name: by } = useOnShift(restaurantId);
  const { toast } = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [section, setSection] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const rows = useMemo(() => tableRows(floor, config?.numbers || []), [floor, config]);
  const sections = useMemo(() => [...new Set(floor?.tables.map(t => t.section).filter(Boolean) || [])], [floor]);
  const waiting = useMemo(() => (floor?.seatings || [])
    .flatMap(s => s.payments.filter(p => p.status === "pending"))
    .sort((a, b) => a.created_at.localeCompare(b.created_at)), [floor]);
  const shown = rows.filter(r => section === "all" || r.table?.section === section);
  const count = (s: FloorStatus) => rows.filter(r => r.status === s).length;
  const seated = rows.length - count("free") - count("cleaning");
  const summary = [seated && `${seated} seated`, count("bill") && `${count("bill")} waiting to pay`].filter(Boolean).join(" · ") || "All tables are free";

  const settle = async (id: string, accept: boolean) => {
    setBusy((accept ? "p" : "x") + id);
    try {
      const b = await staffApi.settle(id, accept, by);
      toast({ title: accept ? "Payment confirmed" : "Marked not received", description: accept && b.due === 0 ? "Bill fully paid. The table now waits for cleaning." : undefined });
      reload();
    } catch (e) {
      toast({ title: "Couldn't update the payment", description: staffErrorCopy(e), variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Guest calls (waiter, water, bill…): "On my way" shows on the guest's phone, "Done" clears it
  const calls = floor?.calls || [];
  const answer = async (c: FloorCall, status: "acknowledged" | "completed") => {
    setBusy(status[0] + c.id);
    const at = new Date().toISOString();
    const patch = status === "acknowledged" ? { status, acknowledged_at: at, acknowledged_by: by } : { status, completed_at: at };
    const { error } = await supabase.from("service_calls").update(patch as never).eq("id", c.id);
    setBusy(null);
    if (error) { toast({ title: "Couldn't update the call", description: staffErrorCopy(error), variant: "destructive" }); return; }
    staffApi.log(restaurantId, by, "call_answered", { table: c.table_number, status: status === "acknowledged" ? "on the way" : "done" });
    reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center"><LayoutGrid className="w-5 h-5 text-primary" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Tables</h2>
          <p className="text-sm text-muted-foreground">{floor ? summary : "Loading tables"}</p>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}

      {calls.length > 0 && (
        <section aria-labelledby="floor-calls" className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-4 pt-3">
          <h3 id="floor-calls" className="text-sm font-semibold flex items-center gap-2"><Bell className="h-4 w-4 text-amber-600" /> Guests calling</h3>
          <ul className="divide-y divide-border">
            {calls.map(c => (
              <li key={c.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  <span className="font-display text-base mr-2">{locationLabel} {c.table_number}</span>
                  {CALL_LABEL[c.call_type] ?? "Help"}
                  <span className="font-normal text-muted-foreground"> · {c.status === "acknowledged" ? "on the way" : `${since(c.created_at, now)} ago`}</span>
                </p>
                <div className="flex gap-2">
                  {c.status === "pending" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => answer(c, "acknowledged")}>On my way</Button>}
                  <Button size="sm" disabled={!!busy} onClick={() => answer(c, "completed")}>{busy === `c${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : "Done"}</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section aria-labelledby="floor-waiting" className="rounded-2xl border border-primary/30 bg-primary/[0.04] px-4 pt-3">
          <h3 id="floor-waiting" className="text-sm font-semibold flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" /> Payments to confirm</h3>
          <ul className="divide-y divide-border">
            {waiting.map(p => <PayToConfirm key={p.id} p={p} table={`${locationLabel} ${p.table_number}`} busy={busy} onSettle={(ok) => settle(p.id, ok)} />)}
          </ul>
        </section>
      )}

      {sections.length > 0 && (
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]" role="radiogroup" aria-label="Section">
          {["all", ...sections].map(s => (
            <button key={s} role="radio" aria-checked={section === s} onClick={() => setSection(s)}
              className={cn("h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors", section === s ? "bg-foreground text-background" : "bg-muted text-foreground/75 hover:bg-muted/70")}>
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
      )}

      {!floor && !error ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-2xl" />)}</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {shown.map(r => {
            const look = STATUS_LOOK[r.status];
            return (
              <button
                key={r.number}
                onClick={() => setOpen(r.number)}
                className={cn("relative text-left rounded-2xl border p-4 min-h-[118px] flex flex-col justify-between transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", look.tile)}
                aria-label={`${locationLabel} ${r.number}: ${look.label}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-display text-[28px] leading-none tabular-nums">{r.number}</span>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-foreground/80"><span className={cn("h-2 w-2 rounded-full", look.dot)} />{look.label}</span>
                </div>
                <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
                  {r.mergedInto ? <p>One bill with {r.mergedInto}</p> : r.seating ? (
                    <>
                      <p className="flex items-center gap-1"><Clock className="h-3 w-3" />{since(r.seating.opened_at, now)}</p>
                      {r.seating.bill && r.seating.bill.total > 0 && <p className="text-sm font-semibold text-foreground tabular-nums">{inr(r.seating.bill.due)} due</p>}
                    </>
                  ) : null}
                </div>
                {(r.calls > 0 || r.pendingPay > 0) && (
                  <span className="absolute -top-2 -right-2 flex gap-1">
                    {r.calls > 0 && <span className="h-6 min-w-6 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-semibold flex items-center justify-center gap-0.5" title="Guest is calling"><Bell className="h-3 w-3" />{r.calls}</span>}
                    {r.pendingPay > 0 && <span className="h-6 min-w-6 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center gap-0.5" title="Payments to confirm"><Wallet className="h-3 w-3" />{r.pendingPay}</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">Tap a {locationLabel.toLowerCase()} to seat guests or take payment.</p>

      <TableSheet restaurantId={restaurantId} number={open} rows={rows} config={config} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}

// ---------- one table ----------

export function TableSheet({ restaurantId, number, rows, config, onClose, onChanged }: {
  restaurantId: string; number: string | null; rows: TableRow[]; config: ReturnType<typeof useFloor>["config"];
  onClose: () => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const { locationLabel } = useBusinessType(restaurantId);
  const { name: by } = useOnShift(restaurantId);
  const [busy, setBusy] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"cash" | "upi" | "card">("cash");
  const [moveTo, setMoveTo] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const row = rows.find(r => r.number === number) || null;
  const s = row?.seating || null;
  const b = s?.bill || null;
  const look = row ? STATUS_LOOK[row.status] : null;
  const lt = locationLabel.toLowerCase();

  const open = b ? Math.max(0, Math.round((b.due - b.pending) * 100) / 100) : 0; // due minus payments waiting to be confirmed
  useEffect(() => { setAmount(open ? String(open) : ""); setPaying(false); setMoveTo(""); setMergeInto(""); setCloseNote(""); }, [number, open]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await fn(); if (done) toast({ title: done }); onChanged(); return true; }
    catch (e) { toast({ title: "Couldn't do that", description: staffErrorCopy(e), variant: "destructive" }); return false; }
    finally { setBusy(null); }
  };
  const spin = (key: string, label: string) => busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : label;

  const freeTables = rows.filter(r => !r.seating && r.number !== number).map(r => r.number);
  const seatedTables = rows.filter(r => r.seating && !r.mergedInto && r.number !== number).map(r => r.number);
  const lines = s?.orders.filter(o => !["rejected", "cancelled"].includes(o.status)).flatMap(o => o.items || []) || [];
  const pending = s?.payments.filter(p => p.status === "pending") || [];
  const settled = s?.payments.filter(p => p.status !== "pending") || [];
  const close = async (note?: string) => { if (s && await run("close", () => staffApi.closeTable(restaurantId, s.table_number, by, note), "Bill closed")) onClose(); };

  return (
    <Sheet open={!!number} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
        {row && look && (
          <div className="p-6 space-y-5">
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="flex items-center gap-3">
                <span className="font-display text-3xl font-normal">{locationLabel} {row.number}</span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground/80"><span className={cn("h-2 w-2 rounded-full", look.dot)} />{look.label}</span>
              </SheetTitle>
              <SheetDescription>
                {s ? `Seated ${since(s.opened_at)} ago${row.table?.activated_by ? ` · opened by ${row.table.activated_by}` : ""}` : row.status === "cleaning" ? "Bill closed. Clean it before the next guests." : "No guests right now."}
                {row.mergedInto && ` · shares the bill of ${lt} ${row.mergedInto}`}
              </SheetDescription>
            </SheetHeader>

            {/* No guests: one button */}
            {!s && (row.status === "cleaning" ? (
              <Button className="w-full" disabled={!!busy} onClick={() => run("clean", () => staffApi.markClean(restaurantId, row.number, by), `${locationLabel} ${row.number} is ready`)}>
                {spin("clean", "Mark cleaned")}
              </Button>
            ) : (
              <Button className="w-full" disabled={!!busy} onClick={() => run("open", () => staffApi.openTable(restaurantId, row.number, by), `${locationLabel} ${row.number} is open`)}>
                {spin("open", "Seat guests")}
              </Button>
            ))}

            {s && b && (
              <>
                {/* Where the bill stands, then the next step */}
                {b.total === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nothing ordered yet. Guests order from their phones.</p>
                ) : (
                  <div className="rounded-2xl border border-border p-4 flex items-baseline justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{b.due > 0 ? "Due" : "Paid in full"}</span>
                    <span className="font-display text-3xl tabular-nums">{inr(b.due > 0 ? b.due : b.total)}</span>
                  </div>
                )}

                {pending.length > 0 && (
                  <section aria-label="Payments to confirm">
                    <h3 className="text-sm font-semibold">Confirm these payments</h3>
                    <ul className="divide-y divide-border">
                      {pending.map(p => <PayToConfirm key={p.id} p={p} busy={busy} onSettle={(ok) => run(`${ok ? "p" : "x"}${p.id}`, () => staffApi.settle(p.id, ok, by), ok ? "Payment confirmed" : "Marked not received")} />)}
                    </ul>
                  </section>
                )}

                {open > 0 && (paying ? (
                  <section aria-label="Take payment" className="space-y-2">
                    {b.pending > 0 && <p className="text-xs text-muted-foreground">{inr(b.pending)} is waiting for a confirm above, so this covers the other {inr(open)}.</p>}
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                        <Input aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="pl-7 tabular-nums" />
                      </div>
                      <div className="flex rounded-md border border-input overflow-hidden" role="radiogroup" aria-label="Payment mode">
                        {(["cash", "upi", "card"] as const).map(m => (
                          <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                            className={cn("px-3 text-sm font-medium", mode === m ? "bg-foreground text-background" : "hover:bg-muted")}>{PAY_MODE[m]}</button>
                        ))}
                      </div>
                    </div>
                    <Button className="w-full" disabled={!!busy || !(Number(amount) > 0)} onClick={() => run("pay", () => staffApi.addPayment(restaurantId, s.table_number, Number(amount), mode, by), `${inr(Number(amount))} recorded`)}>
                      {spin("pay", `Record ${inr(Number(amount) || 0)} ${PAY_MODE[mode]}`)}
                    </Button>
                  </section>
                ) : (
                  <Button className="w-full" variant={pending.length ? "outline" : "default"} onClick={() => setPaying(true)}>Take payment</Button>
                ))}

                {b.due === 0 && (
                  <Button className="w-full" variant={b.total === 0 ? "outline" : "default"} disabled={!!busy} onClick={() => close()}>
                    {spin("close", b.total === 0 ? `Free this ${lt}` : `Close bill and free the ${lt}`)}
                  </Button>
                )}

                {(lines.length > 0 || settled.length > 0 || s.guest_phone) && (
                  <Fold title="Bill details">
                    <div className="divide-y divide-border text-sm">
                      {lines.length > 0 && (
                        <div className="p-4 space-y-1">
                          {lines.map((l, i) => (
                            <div key={i} className="flex justify-between gap-3">
                              <span className="min-w-0 truncate">{l.quantity && l.quantity > 1 ? `${l.quantity} × ` : ""}{l.name}{l.options ? <span className="text-muted-foreground"> · {l.options}</span> : null}</span>
                              <span className="tabular-nums">{inr(l.price * (l.quantity || 1))}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="p-4 space-y-1 text-muted-foreground">
                        <Line label="Subtotal" value={inr(b.subtotal)} />
                        {b.discount > 0 && <Line label={`Discount${s.discount?.label ? ` · ${s.discount.label}` : ""}`} value={`−${inr(b.discount)}`} />}
                        {b.service > 0 && <Line label={`Service ${Number(b.service_pct)}%`} value={inr(b.service)} />}
                        {b.gst > 0 && <Line label={`GST ${Number(b.gst_rate)}%`} value={inr(b.gst)} />}
                        <div className="flex justify-between pt-1 font-semibold text-foreground"><span>Total</span><span className="tabular-nums">{inr(b.total)}</span></div>
                        {b.paid > 0 && <Line label="Paid" value={inr(b.paid)} />}
                      </div>
                      {settled.length > 0 && (
                        <ul className="p-4 space-y-1">
                          {settled.map(p => (
                            <li key={p.id} className="flex justify-between gap-3">
                              <span className="min-w-0 truncate">{p.payer || "Guest"} · {PAY_MODE[p.mode]}{p.tip > 0 && <span className="text-muted-foreground"> + {inr(p.tip)} tip</span>}</span>
                              <span className={cn("tabular-nums", p.status === "rejected" && "text-destructive line-through")}>{inr(p.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.guest_phone && (
                        <div className="p-4 flex items-center justify-between gap-3">
                          <span>Loyalty · ******{s.guest_phone.slice(-4)} · <span className="tabular-nums">{s.loyalty_points ?? 0} pts</span></span>
                          {(s.loyalty_points ?? 0) >= (config?.goal ?? 200) && (
                            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("redeem", () => staffApi.redeem(restaurantId, s.guest_phone!, by), "Reward redeemed")}>Give reward</Button>
                          )}
                        </div>
                      )}
                    </div>
                  </Fold>
                )}

                <Fold title="More">
                  <div className="p-4 space-y-3">
                    <div className="flex gap-2">
                      <select aria-label={`Move to ${lt}`} value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm">
                        <option value="">Move guests to…</option>
                        {freeTables.map(t => <option key={t} value={t}>{locationLabel} {t}</option>)}
                      </select>
                      <Button variant="outline" disabled={!moveTo || !!busy} onClick={async () => { if (await run("move", () => staffApi.transfer(restaurantId, s.table_number, moveTo, by), `Moved to ${lt} ${moveTo}`)) onClose(); }}>Move</Button>
                    </div>
                    <div className="flex gap-2">
                      <select aria-label={`Join the bill of another ${lt}`} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm">
                        <option value="">Join the bill of…</option>
                        {seatedTables.map(t => <option key={t} value={t}>{locationLabel} {t}</option>)}
                      </select>
                      <Button variant="outline" disabled={!mergeInto || !!busy} onClick={() => run("merge", () => staffApi.merge(restaurantId, s.table_number, mergeInto, by), `One bill with ${lt} ${mergeInto}`)}>Join</Button>
                    </div>
                    {lines.length > 0 && (
                      <Button variant="outline" className="w-full gap-2" onClick={() => printHtml(buildBillHtml({ restaurant: config?.name || "", table: s.table_number, lines, bill: b, discountLabel: s.discount?.label }, locationLabel))}>
                        <Printer className="h-4 w-4" /> Print bill
                      </Button>
                    )}
                    {b.due > 0 && (
                      <div className="space-y-2 pt-1">
                        <label htmlFor="close-note" className="text-xs text-muted-foreground">Close with {inr(b.due)} still due (the reason goes in the log)</label>
                        <div className="flex gap-2">
                          <Input id="close-note" value={closeNote} onChange={(e) => setCloseNote(e.target.value.slice(0, 120))} placeholder="e.g. paid outside the app" />
                          <Button variant="destructive" disabled={!closeNote.trim() || !!busy} onClick={() => close(closeNote)}>Close</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Fold>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const Fold = ({ title, children }: { title: string; children: ReactNode }) => (
  <details className="group rounded-2xl border border-border">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      {title}
      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-border">{children}</div>
  </details>
);

const Line = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3"><span>{label}</span><span className="tabular-nums">{value}</span></div>
);
