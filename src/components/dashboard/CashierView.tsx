// Cashier: payments guests say they've made (confirm or reject them), then every open bill.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useOnShift } from "@/hooks/useOnShift";
import { staffApi, staffErrorCopy, inr, since, PAY_MODE } from "@/lib/staffApi";
import { TableSheet, tableRows, useFloor, STATUS_LOOK } from "@/components/dashboard/FloorView";
import { cn } from "@/lib/utils";

export default function CashierView({ restaurantId }: { restaurantId: string }) {
  const { floor, config, error, reload } = useFloor(restaurantId);
  const { locationLabel } = useBusinessType(restaurantId);
  const { name: by } = useOnShift(restaurantId);
  const { toast } = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const rows = useMemo(() => tableRows(floor, config?.numbers || []), [floor, config]);
  const waiting = useMemo(() => (floor?.seatings || [])
    .flatMap(s => s.payments.filter(p => p.status === "pending"))
    .sort((a, b) => a.created_at.localeCompare(b.created_at)), [floor]);
  const bills = rows.filter(r => r.seating && !r.mergedInto && r.seating.bill && r.seating.bill.total > 0);
  const due = bills.reduce((n, r) => n + (r.seating?.bill?.due || 0), 0);

  const settle = async (id: string, accept: boolean) => {
    setBusy(id + accept);
    try {
      const b = await staffApi.settle(id, accept, by);
      toast({ title: accept ? "Payment confirmed" : "Marked not received", description: accept && b.due === 0 ? "Bill fully paid. The table now waits for cleaning." : undefined });
      reload();
    } catch (e) {
      toast({ title: "Couldn't update the payment", description: staffErrorCopy(e), variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center"><Wallet className="w-5 h-5 text-primary" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Cashier</h2>
          <p className="text-sm text-muted-foreground">{floor ? `${waiting.length} to confirm · ${bills.length} open bills · ${inr(due)} still due` : "Loading bills"}</p>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}

      <section aria-labelledby="cashier-waiting">
        <h3 id="cashier-waiting" className="text-sm font-semibold mb-2">Waiting for you</h3>
        {!floor ? <Skeleton className="h-20 rounded-2xl" /> : waiting.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            Nothing to confirm. When a guest pays by UPI, asks to pay cash or wants the card machine, it shows up here.
          </p>
        ) : (
          <ul className="rounded-2xl border border-border divide-y divide-border bg-card">
            {waiting.map(p => (
              <li key={p.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="font-display text-lg mr-2">{locationLabel} {p.table_number}</span>
                    <span className="tabular-nums">{inr(p.amount + p.tip)}</span>
                    <span className="text-muted-foreground font-normal"> · {PAY_MODE[p.mode]}{p.payer ? ` · ${p.payer}` : ""}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.mode === "upi" ? "Check the UPI app for this amount, then confirm" : p.mode === "cash" ? "Collect cash at the table" : "Take the card machine to the table"}
                    {p.tip > 0 && ` · includes ${inr(p.tip)} tip`} · {since(p.created_at, now)} ago
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!!busy} onClick={() => settle(p.id, false)}>Not received</Button>
                  <Button size="sm" disabled={!!busy} onClick={() => settle(p.id, true)}>
                    {busy === p.id + true ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirm ${inr(p.amount + p.tip)}`}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cashier-bills">
        <h3 id="cashier-bills" className="text-sm font-semibold mb-2">Open bills</h3>
        {!floor ? <Skeleton className="h-32 rounded-2xl" /> : bills.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">No open bills. Tables that order show up here until they're paid.</p>
        ) : (
          <div className="rounded-2xl border border-border overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left font-medium p-3">{locationLabel}</th>
                  <th className="text-right font-medium p-3">Total</th>
                  <th className="text-right font-medium p-3 hidden sm:table-cell">Paid</th>
                  <th className="text-right font-medium p-3">Due</th>
                  <th className="p-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bills.map(r => {
                  const b = r.seating!.bill!;
                  return (
                    <tr key={r.number} className="hover:bg-muted/30">
                      <td className="p-3">
                        <span className="font-display text-lg">{r.number}</span>
                        <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("h-2 w-2 rounded-full", STATUS_LOOK[r.status].dot)} />{STATUS_LOOK[r.status].label} · {since(r.seating!.opened_at, now)}</span>
                      </td>
                      <td className="p-3 text-right tabular-nums">{inr(b.total)}</td>
                      <td className="p-3 text-right tabular-nums hidden sm:table-cell">{inr(b.paid)}</td>
                      <td className="p-3 text-right tabular-nums font-semibold">{inr(b.due)}</td>
                      <td className="p-3 text-right"><Button variant="outline" size="sm" onClick={() => setOpen(r.number)}>Open</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TableSheet restaurantId={restaurantId} number={open} rows={rows} config={config} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
