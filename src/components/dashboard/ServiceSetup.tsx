// Service setup: table PIN security, tax + service charge, discount codes, loyalty, Spin & Win prizes and guest WiFi.
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { computeBill } from "@/lib/bill";
import { inr } from "@/lib/staffApi";
import { cn } from "@/lib/utils";

interface Settings {
  require_table_pin: boolean; gst_rate: number; service_charge_pct: number;
  loyalty: { enabled: boolean; rupees_per_point: number; goal: number; reward: string };
  spin_prizes: { label: string; kind: "pct" | "flat" | "item" | "none"; value?: number }[];
}
interface Coupon { id: string; code: string; kind: "pct" | "flat"; value: number; min_bill: number; active: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the v2 tables and columns aren't in the generated types until `supabase gen types` runs
const db = (name: string) => supabase.from(name as never) as any;
const GST = [0, 5, 12, 18];
const PRIZE_KIND = [{ v: "item", l: "Free item" }, { v: "pct", l: "% off" }, { v: "flat", l: "₹ off" }, { v: "none", l: "Try again" }] as const;

export default function ServiceSetup({ restaurantId }: { restaurantId: string }) {
  const { toast } = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [wifi, setWifi] = useState({ wifi_ssid: "", wifi_password: "" });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [draft, setDraft] = useState({ code: "", kind: "pct" as "pct" | "flat", value: "", min_bill: "" });
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, c, w] = await Promise.all([
      db("restaurants").select("require_table_pin, gst_rate, service_charge_pct, loyalty, spin_prizes").eq("id", restaurantId).single(),
      db("coupons").select("id, code, kind, value, min_bill, active").eq("restaurant_id", restaurantId).order("created_at"),
      db("restaurant_private").select("wifi_ssid, wifi_password").eq("restaurant_id", restaurantId).maybeSingle(),
    ]);
    if (r.error) { toast({ title: "Couldn't load settings", description: "Run the v2 database migration first.", variant: "destructive" }); return; }
    setS({ ...r.data, gst_rate: Number(r.data.gst_rate), service_charge_pct: Number(r.data.service_charge_pct) });
    setCoupons(c.data || []);
    if (w.data) setWifi(w.data);
  }, [restaurantId, toast]);
  useEffect(() => { load(); }, [load]);

  const save = async (key: string, patch: Partial<Settings>, done: string) => {
    setSaving(key);
    const { error } = await db("restaurants").update(patch).eq("id", restaurantId);
    setSaving(null);
    if (error) toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    else { setS(prev => (prev ? { ...prev, ...patch } : prev)); toast({ title: done }); }
  };

  const saveWifi = async () => {
    setSaving("wifi");
    const { error } = await db("restaurant_private").upsert({ restaurant_id: restaurantId, ...wifi });
    setSaving(null);
    toast(error ? { title: "Couldn't save WiFi", description: error.message, variant: "destructive" } : { title: "WiFi saved", description: "Seated guests see it under \"While you wait\"." });
  };

  const addCoupon = async () => {
    const code = draft.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const value = Number(draft.value);
    if (!/^[A-Z0-9]{3,16}$/.test(code) || !(value > 0) || (draft.kind === "pct" && value > 100)) {
      toast({ title: "Check the code", description: "3-16 letters or numbers, and a value above 0 (at most 100%).", variant: "destructive" });
      return;
    }
    setSaving("coupon");
    const { error } = await db("coupons").insert({ restaurant_id: restaurantId, code, kind: draft.kind, value, min_bill: Number(draft.min_bill) || 0 });
    setSaving(null);
    if (error) toast({ title: "Couldn't add the code", description: /duplicate/.test(error.message) ? `${code} already exists.` : error.message, variant: "destructive" });
    else { setDraft({ code: "", kind: "pct", value: "", min_bill: "" }); load(); }
  };
  const toggleCoupon = async (c: Coupon) => { await db("coupons").update({ active: !c.active }).eq("id", c.id); load(); };
  const removeCoupon = async (c: Coupon) => { await db("coupons").delete().eq("id", c.id); load(); };

  if (!s) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>;

  const example = computeBill([{ price: 1000 }], { gstRate: s.gst_rate, servicePct: s.service_charge_pct });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center"><SlidersHorizontal className="w-5 h-5 text-primary" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Service setup</h2>
          <p className="text-sm text-muted-foreground">How tables, bills and guest extras work.</p>
        </div>
      </div>

      <Panel title="Table PIN" sub="Stops orders from a photo of your QR code. Staff open a table when guests sit, and guests type the 4-digit PIN from the table stand once.">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="pin-on" className="text-sm font-normal">Guests need the table PIN to order</Label>
          <Switch id="pin-on" checked={s.require_table_pin} disabled={saving === "pin"}
            onCheckedChange={(v) => save("pin", { require_table_pin: v }, v ? "Table PIN switched on. Open tables from the Floor." : "Table PIN switched off")} />
        </div>
        {s.require_table_pin && <p className="text-xs text-muted-foreground">Each table's PIN is on the Floor screen. Print it on the table stand, or tell guests when they sit. After 5 wrong tries a table locks for 10 minutes.</p>}
      </Panel>

      <Panel title="Tax and service charge" sub={`A ₹1,000 order comes to ${inr(example.total)} with these settings.`}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label id="gst-label">GST</Label>
            <div className="flex gap-1.5" role="radiogroup" aria-labelledby="gst-label">
              {GST.map(g => (
                <button key={g} type="button" role="radio" aria-checked={s.gst_rate === g} onClick={() => setS({ ...s, gst_rate: g })}
                  className={cn("h-10 flex-1 rounded-md border text-sm", s.gst_rate === g ? "bg-foreground text-background border-foreground" : "border-input hover:bg-muted")}>{g}%</button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc">Service charge (%)</Label>
            <Input id="svc" inputMode="decimal" value={s.service_charge_pct} onChange={(e) => setS({ ...s, service_charge_pct: Math.min(20, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0) })} />
          </div>
        </div>
        <Button variant="outline" disabled={saving === "tax"} onClick={() => save("tax", { gst_rate: s.gst_rate, service_charge_pct: s.service_charge_pct }, "Tax saved. New bills use it.")}>
          {saving === "tax" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save tax"}
        </Button>
      </Panel>

      <Panel title="Discount codes" sub="Guests type these on the bill before anyone pays. One discount per bill.">
        {coupons.length > 0 && (
          <ul className="rounded-xl border border-border divide-y divide-border text-sm">
            {coupons.map(c => (
              <li key={c.id} className={cn("p-3 flex items-center justify-between gap-3", !c.active && "opacity-60")}>
                <span><span className="font-mono font-semibold tracking-wide">{c.code}</span> · {c.kind === "pct" ? `${Number(c.value)}% off` : `${inr(c.value)} off`}{Number(c.min_bill) > 0 && ` on bills over ${inr(c.min_bill)}`}</span>
                <span className="flex items-center gap-2">
                  <Switch checked={c.active} onCheckedChange={() => toggleCoupon(c)} aria-label={`${c.code} active`} />
                  <Button variant="ghost" size="icon" aria-label={`Delete ${c.code}`} onClick={() => removeCoupon(c)}><Trash2 className="h-4 w-4" /></Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form className="grid grid-cols-2 sm:grid-cols-[1.2fr_auto_0.8fr_0.8fr_auto] gap-2 items-end" onSubmit={(e) => { e.preventDefault(); addCoupon(); }}>
          <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label htmlFor="cp-code">Code</Label><Input id="cp-code" value={draft.code} placeholder="FLAT10" className="uppercase" onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().slice(0, 16) })} /></div>
          <div className="flex rounded-md border border-input overflow-hidden h-10" role="radiogroup" aria-label="Discount type">
            {(["pct", "flat"] as const).map(k => <button key={k} type="button" role="radio" aria-checked={draft.kind === k} onClick={() => setDraft({ ...draft, kind: k })} className={cn("px-3 text-sm", draft.kind === k ? "bg-foreground text-background" : "hover:bg-muted")}>{k === "pct" ? "%" : "₹"}</button>)}
          </div>
          <div className="space-y-1.5"><Label htmlFor="cp-val">Value</Label><Input id="cp-val" inputMode="decimal" value={draft.value} placeholder="10" onChange={(e) => setDraft({ ...draft, value: e.target.value.replace(/[^0-9.]/g, "") })} /></div>
          <div className="space-y-1.5"><Label htmlFor="cp-min">Min bill ₹</Label><Input id="cp-min" inputMode="numeric" value={draft.min_bill} placeholder="0" onChange={(e) => setDraft({ ...draft, min_bill: e.target.value.replace(/\D/g, "") })} /></div>
          <Button type="submit" disabled={saving === "coupon"} className="gap-1.5"><Plus className="h-4 w-4" /> Add</Button>
        </form>
      </Panel>

      <Panel title="Loyalty points" sub="Guests add their mobile number on the bill and earn points when it's paid. Cashiers give the reward from the table's bill.">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="loy-on" className="text-sm font-normal">Run a points programme</Label>
          <Switch id="loy-on" checked={s.loyalty.enabled} onCheckedChange={(v) => setS({ ...s, loyalty: { ...s.loyalty, enabled: v } })} />
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label htmlFor="loy-rpp">₹ per point</Label><Input id="loy-rpp" inputMode="numeric" value={s.loyalty.rupees_per_point} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, rupees_per_point: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) } })} /></div>
          <div className="space-y-1.5"><Label htmlFor="loy-goal">Points for the reward</Label><Input id="loy-goal" inputMode="numeric" value={s.loyalty.goal} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, goal: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) } })} /></div>
          <div className="space-y-1.5"><Label htmlFor="loy-rew">Reward</Label><Input id="loy-rew" value={s.loyalty.reward} maxLength={40} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, reward: e.target.value } })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">With these numbers a guest needs to spend about {inr(s.loyalty.goal * s.loyalty.rupees_per_point)} to earn "{s.loyalty.reward}".</p>
        <Button variant="outline" disabled={saving === "loyalty"} onClick={() => save("loyalty", { loyalty: s.loyalty }, "Loyalty saved")}>{saving === "loyalty" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save loyalty"}</Button>
      </Panel>

      <Panel title="Spin & Win" sub="One spin per table after their first order. Every prize has the same chance. Leave the list empty to switch it off. Prizes are yours to give.">
        <ul className="space-y-2">
          {s.spin_prizes.map((p, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto_5rem_auto] gap-2 items-center">
              <Input aria-label={`Prize ${i + 1}`} value={p.label} maxLength={24} onChange={(e) => setS({ ...s, spin_prizes: s.spin_prizes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <select aria-label={`Prize ${i + 1} type`} value={p.kind} onChange={(e) => setS({ ...s, spin_prizes: s.spin_prizes.map((x, j) => (j === i ? { ...x, kind: e.target.value as typeof p.kind } : x)) })} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
                {PRIZE_KIND.map(k => <option key={k.v} value={k.v}>{k.l}</option>)}
              </select>
              <Input aria-label={`Prize ${i + 1} value`} inputMode="numeric" disabled={p.kind === "item" || p.kind === "none"} value={p.kind === "item" || p.kind === "none" ? "" : p.value ?? ""}
                onChange={(e) => setS({ ...s, spin_prizes: s.spin_prizes.map((x, j) => (j === i ? { ...x, value: Number(e.target.value.replace(/\D/g, "")) || 0 } : x)) })} />
              <Button variant="ghost" size="icon" aria-label={`Remove prize ${i + 1}`} onClick={() => setS({ ...s, spin_prizes: s.spin_prizes.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-1.5" disabled={s.spin_prizes.length >= 8} onClick={() => setS({ ...s, spin_prizes: [...s.spin_prizes, { label: "Free dessert", kind: "item" }] })}><Plus className="h-4 w-4" /> Add prize</Button>
          <Button variant="outline" disabled={saving === "spin" || s.spin_prizes.some(p => !p.label.trim())}
            onClick={() => save("spin", { spin_prizes: s.spin_prizes.map(p => ({ label: p.label.trim(), kind: p.kind, ...(p.kind === "pct" || p.kind === "flat" ? { value: Math.min(p.kind === "pct" ? 100 : 100000, p.value || 0) } : {}) })) }, s.spin_prizes.length ? "Prizes saved" : "Spin & Win switched off")}>
            {saving === "spin" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save prizes"}
          </Button>
        </div>
      </Panel>

      <Panel title="Guest WiFi" sub="Shown to seated guests only (after the table PIN), never on the public menu.">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="wf-ssid">Network name</Label><Input id="wf-ssid" value={wifi.wifi_ssid} maxLength={64} onChange={(e) => setWifi({ ...wifi, wifi_ssid: e.target.value })} placeholder="Cafe_Guest" /></div>
          <div className="space-y-1.5"><Label htmlFor="wf-pass">Password</Label><Input id="wf-pass" value={wifi.wifi_password} maxLength={64} onChange={(e) => setWifi({ ...wifi, wifi_password: e.target.value })} autoComplete="off" /></div>
        </div>
        <Button variant="outline" disabled={saving === "wifi"} onClick={saveWifi}>{saving === "wifi" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save WiFi"}</Button>
      </Panel>
    </div>
  );
}

const Panel = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-border bg-card p-5 space-y-4" aria-label={title}>
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>
    </div>
    {children}
  </section>
);
