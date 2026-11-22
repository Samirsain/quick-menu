// Staff: accounts with a role and a PIN (for shift sign-in on a shared device), and the log of who did what.
import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Loader2, UserRound, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useOnShift } from "@/hooks/useOnShift";
import { staffApi, staffErrorCopy, type StaffMember } from "@/lib/staffApi";
import { cn } from "@/lib/utils";

const ROLES: { value: StaffMember["role"]; label: string }[] = [
  { value: "waiter", label: "Waiter" }, { value: "kitchen", label: "Kitchen" }, { value: "cashier", label: "Cashier" }, { value: "manager", label: "Manager" },
];
const ACTION: Record<string, string> = {
  table_opened: "Opened table", bill_closed: "Closed bill", bill_closed_unpaid: "Closed bill with money due", pin_changed: "Changed table PIN",
  table_moved: "Moved guests", tables_merged: "Merged tables", payment_confirmed: "Confirmed payment", payment_rejected: "Marked payment not received",
  payment_taken: "Took payment", reward_redeemed: "Gave loyalty reward", staff_added: "Added staff", staff_updated: "Updated staff",
  shift_started: "Started shift", order_status: "Moved an order", call_answered: "Answered a call",
};

interface LogRow { id: string; staff_name: string | null; action: string; details: Record<string, unknown>; created_at: string }

function describe(r: LogRow): string {
  const d = r.details || {};
  return [d.table && `table ${d.table}`, d.from && d.to && `${d.from} → ${d.to}`, d.into && `${d.from} into ${d.into}`,
    d.amount != null && `₹${d.amount}`, d.mode && String(d.mode).toUpperCase(), d.name && String(d.name), d.status && String(d.status), d.note && `"${d.note}"`]
    .filter(Boolean).join(" · ");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the v2 tables aren't in the generated types until `supabase gen types` runs
const table = (name: string) => supabase.from(name as never) as any;

export default function StaffView({ restaurantId }: { restaurantId: string }) {
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [who, setWho] = useState("all");
  const [edit, setEdit] = useState<(Partial<StaffMember> & { pin?: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([
      table("staff").select("id, name, role, section, active, created_at").eq("restaurant_id", restaurantId).order("name"),
      table("activity_log").select("id, staff_name, action, details, created_at").eq("restaurant_id", restaurantId).order("created_at", { ascending: false }).limit(200),
    ]);
    if (s.error || l.error) toast({ title: "Couldn't load staff", description: staffErrorCopy(s.error || l.error), variant: "destructive" });
    setStaff(s.data || []);
    setLog(l.data || []);
  }, [restaurantId, toast]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!edit?.name?.trim() || !edit.role) return;
    setSaving(true);
    try {
      await staffApi.saveStaff(restaurantId, { id: edit.id, name: edit.name.trim(), role: edit.role, pin: edit.pin || null, section: edit.section, active: edit.active ?? true });
      toast({ title: edit.id ? "Saved" : `${edit.name.trim()} added`, description: edit.pin ? "They can now start a shift with their PIN." : undefined });
      setEdit(null);
      load();
    } catch (e) {
      toast({ title: "Couldn't save", description: staffErrorCopy(e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const setActive = async (m: StaffMember, active: boolean) => {
    try { await staffApi.saveStaff(restaurantId, { ...m, active }); load(); }
    catch (e) { toast({ title: "Couldn't update", description: staffErrorCopy(e), variant: "destructive" }); }
  };

  const names = useMemo(() => [...new Set((log || []).map(r => r.staff_name).filter(Boolean))] as string[], [log]);
  const shown = (log || []).filter(r => who === "all" || r.staff_name === who);
  const pinOk = !edit?.pin || /^\d{4,6}$/.test(edit.pin);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center"><Users className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Staff</h2>
            <p className="text-sm text-muted-foreground">Everyone starts their shift with a PIN, so the log shows who did what.</p>
          </div>
        </div>
        <Button onClick={() => setEdit({ role: "waiter", active: true, name: "", section: "", pin: "" })}>Add staff</Button>
      </div>

      <section aria-label="Team">
        {!staff ? <Skeleton className="h-28 rounded-2xl" /> : staff.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            No staff yet. Add your waiters, kitchen and cashier with a 4-6 digit PIN each. Their name then shows to guests ("Rahul is on the way") and in the log.
          </p>
        ) : (
          <ul className="rounded-2xl border border-border divide-y divide-border bg-card">
            {staff.map(m => (
              <li key={m.id} className={cn("p-4 flex flex-wrap items-center justify-between gap-3", !m.active && "opacity-60")}>
                <span className="flex items-center gap-3 min-w-0">
                  <span className="h-9 w-9 rounded-full bg-accent text-primary flex items-center justify-center font-display" aria-hidden>{m.name.charAt(0)}</span>
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{m.name}</span>
                    <span className="block text-xs text-muted-foreground">{ROLES.find(r => r.value === m.role)?.label}{m.section ? ` · ${m.section}` : ""}{!m.active ? " · switched off" : ""}</span>
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEdit({ ...m, pin: "" })}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => setActive(m, !m.active)}>{m.active ? "Switch off" : "Switch on"}</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="log-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="log-title" className="text-lg font-semibold flex items-center gap-2"><History className="h-5 w-5 text-muted-foreground" /> Activity</h3>
          {names.length > 0 && (
            <select aria-label="Show actions by" value={who} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="all">Everyone</option>
              {names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>
        {!log ? <Skeleton className="h-40 rounded-2xl" /> : shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">Nothing logged yet. Opening tables, payments, PIN changes and bill closes appear here.</p>
        ) : (
          <ol className="rounded-2xl border border-border divide-y divide-border bg-card text-sm">
            {shown.map(r => (
              <li key={r.id} className="p-3 grid grid-cols-[auto_1fr] gap-x-4">
                <time className="text-xs text-muted-foreground tabular-nums pt-0.5" dateTime={r.created_at}>
                  {new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </time>
                <span className="min-w-0">
                  <span className="font-medium">{r.staff_name || "Owner"}</span> <span className="text-foreground/80">{(ACTION[r.action] || r.action).toLowerCase()}</span>
                  {describe(r) && <span className="block text-xs text-muted-foreground truncate">{describe(r)}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{edit?.id ? `Edit ${edit.name}` : "Add staff"}</DialogTitle>
            <DialogDescription>{edit?.id ? "Leave the PIN empty to keep the current one." : "They'll use the PIN to start a shift on any of your devices."}</DialogDescription>
          </DialogHeader>
          {edit && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <div className="space-y-1.5"><Label htmlFor="st-name">Name</Label><Input id="st-name" value={edit.name || ""} maxLength={40} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></div>
              <div className="space-y-1.5">
                <Label id="st-role">Role</Label>
                <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-labelledby="st-role">
                  {ROLES.map(r => (
                    <button type="button" key={r.value} role="radio" aria-checked={edit.role === r.value} onClick={() => setEdit({ ...edit, role: r.value })}
                      className={cn("h-9 rounded-md border text-sm", edit.role === r.value ? "bg-foreground text-background border-foreground" : "border-input hover:bg-muted")}>{r.label}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-pin">{edit.id ? "New PIN" : "PIN"}</Label>
                <Input id="st-pin" inputMode="numeric" autoComplete="off" value={edit.pin || ""} maxLength={6} placeholder="4 to 6 digits"
                  onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, "") })} aria-invalid={!pinOk} />
                {!pinOk && <p className="text-xs text-destructive">Use 4 to 6 digits.</p>}
              </div>
              <div className="space-y-1.5"><Label htmlFor="st-sec">Section <span className="text-muted-foreground font-normal">(optional, e.g. Outdoor)</span></Label><Input id="st-sec" value={edit.section || ""} maxLength={40} onChange={(e) => setEdit({ ...edit, section: e.target.value })} /></div>
              <Button type="submit" className="w-full" disabled={saving || !edit.name?.trim() || !pinOk || (!edit.id && !edit.pin)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : edit.id ? "Save" : "Add"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "On shift: Rahul" in the dashboard header; tap to switch person with a PIN */
export function ShiftChip({ restaurantId, className }: { restaurantId: string | null; className?: string }) {
  const { who, unlock, signOut } = useOnShift(restaurantId);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const submit = async () => {
    if (!/^\d{4,6}$/.test(pin)) return;
    setBusy(true); setWrong(false);
    try {
      if (await unlock(pin)) { setOpen(false); setPin(""); }
      else { setWrong(true); setPin(""); }
    } catch (e) { toast({ title: "Couldn't start the shift", description: staffErrorCopy(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("h-9 px-3 rounded-full border border-border bg-card text-sm flex items-center gap-2 hover:border-primary/40 transition-colors", className)}>
        <UserRound className="h-4 w-4 text-primary" />
        <span className="truncate max-w-[9rem]">{who ? who.name : "Who's on shift?"}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{who ? `On shift: ${who.name}` : "Start your shift"}</DialogTitle>
            <DialogDescription>Enter your staff PIN. Tables you open, payments you confirm and calls you answer go under your name.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Label htmlFor="shift-pin" className="sr-only">Staff PIN</Label>
            <Input id="shift-pin" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} autoFocus
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setWrong(false); }}
              className="h-14 text-center text-2xl tracking-[0.4em] tabular-nums" aria-invalid={wrong} aria-describedby="shift-msg" />
            <p id="shift-msg" role="alert" className="min-h-5 text-sm text-destructive">{wrong ? "That PIN doesn't match anyone on your team." : ""}</p>
            <Button type="submit" className="w-full" disabled={busy || pin.length < 4}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start shift"}</Button>
            {who && <Button type="button" variant="ghost" className="w-full" onClick={() => { signOut(); setOpen(false); }}>End {who.name}'s shift</Button>}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
