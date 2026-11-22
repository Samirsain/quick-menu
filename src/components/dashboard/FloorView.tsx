// Live floor: every table at a glance (free, seated, ordered, bill due, cleaning) and one sheet per table to run it:
// open it (shows the PIN), move or merge guests, take payments and close the bill.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Clock, KeyRound, Loader2, LayoutGrid, Printer, RefreshCw, Wallet } from "lucide-react";
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
import { staffApi, staffErrorCopy, inr, since, PAY_MODE, type DiningTable, type FloorSeating, type FloorState } from "@/lib/staffApi";
import { cn } from "@/lib/utils";

// ---------- data ----------

/** floor_state, kept live by realtime (debounced) with a slow poll as a safety net */
export function useFloor(restaurantId: string) {
  const [floor, setFloor] = useState<FloorState | null>(null);
  const [config, setConfig] = useState<{ numbers: string[]; name: string; requirePin: boolean; goal: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try { setFloor(await staffApi.floor(restaurantId)); setError(null); } catch (e) { setError(staffErrorCopy(e)); }
  }, [restaurantId]);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 350); }, [load]);

  useEffect(() => {
    load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- v2 columns aren't in the generated types until `supabase gen types` runs
    (supabase.from("restaurants") as any).select("name, table_config, require_table_pin, loyalty").eq("id", restaurantId).single()
      .then(({ data }: { data: { name: string; table_config: { total?: number; skip?: number[] }; require_table_pin?: boolean; loyalty?: { goal?: number } } | null }) => {
        const tc = data?.table_config || {};
        const skip = new Set(tc.skip || []);
        const numbers = Array.from({ length: tc.total || 10 }, (_, i) => i + 1).filter(n => !skip.has(n)).map(String);
        setConfig({ numbers, name: data?.name || "", requirePin: !!data?.require_table_pin, goal: data?.loyalty?.goal || 200 });
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

// ---------- floor map ----------

export default function FloorView({ restaurantId }: { restaurantId: string }) {
  const { floor, config, error, reload } = useFloor(restaurantId);
  const { locationLabel } = useBusinessType(restaurantId);
  const [open, setOpen] = useState<string | null>(null);
  const [section, setSection] = useState<string>("all");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const rows = useMemo(() => tableRows(floor, config?.numbers || []), [floor, config]);
  const sections = useMemo(() => [...new Set(floor?.tables.map(t => t.section).filter(Boolean) || [])], [floor]);
  const shown = rows.filter(r => section === "all" || r.table?.section === section);
  const count = (s: FloorStatus) => rows.filter(r => r.status === s).length;
  const cooking = floor?.seatings.reduce((n, s) => n + s.orders.filter(o => ["pending", "accepted", "preparing"].includes(o.status)).length, 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center"><LayoutGrid className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Floor</h2>
            <p className="text-sm text-muted-foreground">
              {floor ? `${rows.length - count("free") - count("cleaning")} seated · ${cooking} cooking · ${count("bill")} bills due` : "Loading tables"}
              {config?.requirePin && " · PIN on"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={reload} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}

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
                  ) : r.table?.is_active ? <p>Open, waiting for guests</p> : <p>{r.table?.section || " "}</p>}
                </div>
                {(r.calls > 0 || r.pendingPay > 0) && (
                  <span className="absolute -top-2 -right-2 flex gap-1">
                    {r.calls > 0 && <span className="h-6 min-w-6 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-semibold flex items-center justify-center gap-0.5"><Bell className="h-3 w-3" />{r.calls}</span>}
                    {r.pendingPay > 0 && <span className="h-6 min-w-6 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center gap-0.5" title="Payments to confirm"><Wallet className="h-3 w-3" />{r.pendingPay}</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">Tap a {locationLabel.toLowerCase()} to open it, see its PIN, move guests or take payment. Tables update live.</p>

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
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"cash" | "upi" | "card">("cash");
  const [moveTo, setMoveTo] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const row = rows.find(r => r.number === number) || null;
  const s = row?.seating || null;
  const b = s?.bill || null;
  const look = row ? STATUS_LOOK[row.status] : null;

  const open = b ? Math.max(0, Math.round((b.due - b.pending) * 100) / 100) : 0; // due minus payments waiting to be confirmed
  useEffect(() => { setAmount(open ? String(open) : ""); setMoveTo(""); setMergeInto(""); setCloseNote(""); }, [number, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await fn(); if (done) toast({ title: done }); onChanged(); return true; }
    catch (e) { toast({ title: "Couldn't do that", description: staffErrorCopy(e), variant: "destructive" }); return false; }
    finally { setBusy(null); }
  };

  const freeTables = rows.filter(r => !r.seating && r.number !== number).map(r => r.number);
  const seatedTables = rows.filter(r => r.seating && !r.mergedInto && r.number !== number).map(r => r.number);
  const lines = s?.orders.filter(o => !["rejected", "cancelled"].includes(o.status)).flatMap(o => o.items || []) || [];

  return (
    <Sheet open={!!number} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
        {row && look && (
          <div className="p-6 space-y-6">
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="flex items-center gap-3">
                <span className="font-display text-3xl font-normal">{locationLabel} {row.number}</span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground/80"><span className={cn("h-2 w-2 rounded-full", look.dot)} />{look.label}</span>
              </SheetTitle>
              <SheetDescription>
                {s ? `Seated ${since(s.opened_at)} ago${row.table?.activated_by ? ` · opened by ${row.table.activated_by}` : ""}` : row.status === "cleaning" ? "Bill closed. Clean it before the next guests." : "No guests right now."}
                {row.mergedInto && ` · shares the bill of ${locationLabel.toLowerCase()} ${row.mergedInto}`}
              </SheetDescription>
            </SheetHeader>

            {/* PIN: guests type it after scanning (when table PINs are on) */}
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border p-4">
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> Table PIN{config?.requirePin ? "" : " (off: guests don't need it)"}</p>
                <p className="mt-1 font-display text-3xl tracking-[0.2em] tabular-nums">{row.table?.pin ?? "----"}</p>
                {row.table?.pin_locked_until && new Date(row.table.pin_locked_until) > new Date() && (
                  <p className="mt-1 text-xs font-medium text-destructive">Locked after wrong tries. A new PIN unlocks it.</p>
                )}
              </div>
              <Button variant="outline" size="sm" disabled={!!busy} onClick={() => run("pin", () => staffApi.setPin(restaurantId, row.number, by), "New PIN set")}>
                {busy === "pin" ? <Loader2 className="h-4 w-4 animate-spin" /> : "New PIN"}
              </Button>
            </div>

            {!s && (
              <div className="grid gap-2">
                {row.status === "cleaning" && (
                  <Button variant="outline" disabled={!!busy} onClick={() => run("clean", () => staffApi.markClean(restaurantId, row.number, by), `${locationLabel} ${row.number} is ready`)}>Mark as cleaned</Button>
                )}
                <Button disabled={!!busy} onClick={() => run("open", () => staffApi.openTable(restaurantId, row.number, by), `${locationLabel} ${row.number} is open`)}>
                  {busy === "open" ? <Loader2 className="h-4 w-4 animate-spin" /> : `Seat guests at ${locationLabel.toLowerCase()} ${row.number}`}
                </Button>
                {config?.requirePin && <p className="text-xs text-muted-foreground">Opening the table switches its PIN on. Tell the guests the PIN, or point to the stand.</p>}
              </div>
            )}

            {s && b && (
              <>
                <section aria-label="Bill">
                  <h3 className="text-sm font-semibold mb-2">Bill</h3>
                  <div className="rounded-2xl border border-border divide-y divide-border text-sm">
                    <div className="p-4 space-y-1">
                      {lines.length === 0 && <p className="text-muted-foreground">Nothing ordered yet.</p>}
                      {lines.map((l, i) => (
                        <div key={i} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate">{l.quantity && l.quantity > 1 ? `${l.quantity} × ` : ""}{l.name}{l.options ? <span className="text-muted-foreground"> · {l.options}</span> : null}</span>
                          <span className="tabular-nums">{inr(l.price * (l.quantity || 1))}</span>
                        </div>
                      ))}
                    </div>
                    <div className="p-4 space-y-1 text-muted-foreground">
                      <Line label="Subtotal" value={inr(b.subtotal)} />
                      {b.discount > 0 && <Line label={`Discount${s.discount?.label ? ` · ${s.discount.label}` : ""}`} value={`−${inr(b.discount)}`} />}
                      {b.service > 0 && <Line label={`Service ${Number(b.service_pct)}%`} value={inr(b.service)} />}
                      {b.gst > 0 && <Line label={`GST ${Number(b.gst_rate)}%`} value={inr(b.gst)} />}
                      <div className="flex justify-between pt-1 text-base font-semibold text-foreground"><span>Total</span><span className="tabular-nums">{inr(b.total)}</span></div>
                      {b.paid > 0 && <Line label="Paid" value={inr(b.paid)} />}
                      <div className="flex justify-between text-foreground font-medium"><span>Due</span><span className="tabular-nums">{inr(b.due)}</span></div>
                    </div>
                  </div>
                </section>

                {s.payments.length > 0 && (
                  <section aria-label="Payments">
                    <h3 className="text-sm font-semibold mb-2">Payments</h3>
                    <ul className="rounded-2xl border border-border divide-y divide-border text-sm">
                      {s.payments.map(p => (
                        <li key={p.id} className="p-3 flex items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate">{p.payer || "Guest"} · {PAY_MODE[p.mode]} · <span className="tabular-nums">{inr(p.amount)}</span>{p.tip > 0 && <span className="text-muted-foreground"> + {inr(p.tip)} tip</span>}</span>
                            <span className="block text-xs text-muted-foreground">{p.status === "pending" ? (p.mode === "upi" ? "Check your UPI app, then confirm" : p.mode === "cash" ? "Collect the cash, then confirm" : "Take the card machine over") : p.status === "confirmed" ? `Confirmed${p.confirmed_by ? ` by ${p.confirmed_by}` : ""}` : "Marked not received"}</span>
                          </span>
                          {p.status === "pending" ? (
                            <span className="flex gap-1.5 flex-shrink-0">
                              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(`x${p.id}`, () => staffApi.settle(p.id, false, by), "Marked not received")}>Not received</Button>
                              <Button size="sm" disabled={!!busy} onClick={() => run(`p${p.id}`, () => staffApi.settle(p.id, true, by), "Payment confirmed")}>
                                {busy === `p${p.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
                              </Button>
                            </span>
                          ) : (
                            <span className={cn("text-xs font-semibold", p.status === "confirmed" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>{p.status === "confirmed" ? "Paid" : "No"}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {open > 0 && (
                  <section aria-label="Take payment" className="space-y-2">
                    <h3 className="text-sm font-semibold">Take payment at the table or counter</h3>
                    {b.pending > 0 && <p className="text-xs text-muted-foreground">{inr(b.pending)} is waiting for you to confirm above, so this covers the other {inr(open)}.</p>}
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
                    <Button className="w-full" variant={b.pending > 0 ? "outline" : "default"} disabled={!!busy || !(Number(amount) > 0)} onClick={() => run("pay", () => staffApi.addPayment(restaurantId, s.table_number, Number(amount), mode, by), `${inr(Number(amount))} recorded`)}>
                      {busy === "pay" ? <Loader2 className="h-4 w-4 animate-spin" /> : `Record ${inr(Number(amount) || 0)} ${PAY_MODE[mode]}`}
                    </Button>
                  </section>
                )}

                {s.guest_phone && (
                  <div className="rounded-2xl border border-border p-4 flex items-center justify-between gap-3 text-sm">
                    <span>Loyalty · ******{s.guest_phone.slice(-4)} · <span className="tabular-nums">{s.loyalty_points ?? 0} pts</span></span>
                    {(s.loyalty_points ?? 0) >= (config?.goal ?? 200) && (
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("redeem", () => staffApi.redeem(restaurantId, s.guest_phone!, by), "Reward redeemed")}>Give reward</Button>
                    )}
                  </div>
                )}

                <section aria-label="Table actions" className="space-y-3">
                  <h3 className="text-sm font-semibold">Table</h3>
                  <div className="flex gap-2">
                    <select aria-label="Move to table" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm">
                      <option value="">Move guests to…</option>
                      {freeTables.map(t => <option key={t} value={t}>{locationLabel} {t}</option>)}
                    </select>
                    <Button variant="outline" disabled={!moveTo || !!busy} onClick={async () => { if (await run("move", () => staffApi.transfer(restaurantId, s.table_number, moveTo, by), `Moved to ${locationLabel.toLowerCase()} ${moveTo}`)) onClose(); }}>Move</Button>
                  </div>
                  <div className="flex gap-2">
                    <select aria-label="Merge into table" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm">
                      <option value="">Join the bill of…</option>
                      {seatedTables.map(t => <option key={t} value={t}>{locationLabel} {t}</option>)}
                    </select>
                    <Button variant="outline" disabled={!mergeInto || !!busy} onClick={() => run("merge", () => staffApi.merge(restaurantId, s.table_number, mergeInto, by), `One bill with ${locationLabel.toLowerCase()} ${mergeInto}`)}>Merge</Button>
                  </div>
                  <Button variant="outline" className="w-full gap-2" onClick={() => printHtml(buildBillHtml({ restaurant: config?.name || "", table: s.table_number, lines, bill: b, discountLabel: s.discount?.label }, locationLabel))}>
                    <Printer className="h-4 w-4" /> Print bill
                  </Button>
                  {b.due === 0 ? (
                    <Button className="w-full" disabled={!!busy} onClick={async () => { if (await run("close", () => staffApi.closeTable(restaurantId, s.table_number, by), "Bill closed")) onClose(); }}>Close bill and free the table</Button>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border p-3 space-y-2">
                      <label htmlFor="close-note" className="text-xs text-muted-foreground">Closing with {inr(b.due)} still due needs a reason (it goes in the log)</label>
                      <div className="flex gap-2">
                        <Input id="close-note" value={closeNote} onChange={(e) => setCloseNote(e.target.value.slice(0, 120))} placeholder="e.g. paid outside the app" />
                        <Button variant="destructive" disabled={!closeNote.trim() || !!busy} onClick={async () => { if (await run("close", () => staffApi.closeTable(restaurantId, s.table_number, by, closeNote), "Bill closed")) onClose(); }}>Close</Button>
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const Line = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3"><span>{label}</span><span className="tabular-nums">{value}</span></div>
);
