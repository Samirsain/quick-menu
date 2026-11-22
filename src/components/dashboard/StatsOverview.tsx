import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Eye, Package, MessageSquare, TrendingUp, TrendingDown, 
  Utensils, IndianRupee, Clock, ArrowUpRight, ArrowDownRight,
  ShoppingBag, Star, Users, Send
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import CountUp from "@/components/CountUp";
import type { ReactNode } from "react";
import { STATUS, STATUS_TONE, asStatus } from "@/lib/orderFlow";

interface StatsOverviewProps {
  restaurantId: string;
}

interface DayStats {
  orders: number;
  revenue: number;
  avgOrderValue: number;
}

const StatsOverview = ({ restaurantId }: StatsOverviewProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalViews: 0,
    totalOrders: 0,
    totalFeedback: 0,
    totalMenuItems: 0,
    avgRating: 0,
    activeOrders: 0,
  });
  const [today, setToday] = useState<DayStats>({ orders: 0, revenue: 0, avgOrderValue: 0 });
  const [yesterday, setYesterday] = useState<DayStats>({ orders: 0, revenue: 0, avgOrderValue: 0 });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [topItems, setTopItems] = useState<{ name: string; count: number }[]>([]);
  const [todayTop, setTodayTop] = useState<[string, number][]>([]);

  useEffect(() => {
    fetchAllStats();
    subscribeToMenuViews();
  }, [restaurantId]);

  const subscribeToMenuViews = () => {
    const channel = supabase
      .channel(`stats-views-${restaurantId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu_views", filter: `restaurant_id=eq.${restaurantId}` },
        () => { toast({ title: "New menu view", description: "Someone is looking at your menu" }); fetchAllStats(); }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  };

  const fetchAllStats = async () => {
    try {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfYesterday = new Date(startOfToday);
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);

      // Parallel fetch all data
      const [viewsRes, ordersRes, feedbackRes, menuRes, allOrdersRes, ratingRes] = await Promise.all([
        supabase.from("menu_views").select("view_count").eq("restaurant_id", restaurantId).single(),
        supabase.from("orders").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurantId),
        supabase.from("feedback").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurantId),
        supabase.from("menu_items").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurantId),
        supabase.from("orders").select("id, order_number, table_number, items, status, created_at").eq("restaurant_id", restaurantId).gte("created_at", startOfYesterday.toISOString()).order("created_at", { ascending: false }),
        supabase.from("feedback").select("rating").eq("restaurant_id", restaurantId),
      ]);

      // Rejected/cancelled orders never earned money - keep them out of revenue and item counts
      const allOrders = (allOrdersRes.data || []).filter(o => !["rejected", "cancelled"].includes(o.status));
      const ratings = ratingRes.data || [];
      const avgRating = ratings.length > 0 ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : 0;

      // Active orders (pending/accepted/preparing)
      const activeCount = allOrders.filter(o => ["pending", "accepted", "preparing"].includes(o.status)).length;

      // Calculate today and yesterday stats
      const todayOrders = allOrders.filter(o => new Date(o.created_at) >= startOfToday);
      const yesterdayOrders = allOrders.filter(o => {
        const d = new Date(o.created_at);
        return d >= startOfYesterday && d < startOfToday;
      });

      const calcRevenue = (orders: any[]) => orders.reduce((sum, o) => {
        const items = o.items?.items || [];
        return sum + items.reduce((s: number, i: any) => s + ((i.price || 0) * (i.quantity || 1)), 0);
      }, 0);

      const todayRevenue = calcRevenue(todayOrders);
      const yesterdayRevenue = calcRevenue(yesterdayOrders);

      setStats({
        totalViews: viewsRes.data?.view_count || 0,
        totalOrders: ordersRes.count || 0,
        totalFeedback: feedbackRes.count || 0,
        totalMenuItems: menuRes.count || 0,
        avgRating: Math.round(avgRating * 10) / 10,
        activeOrders: activeCount,
      });

      setToday({
        orders: todayOrders.length,
        revenue: todayRevenue,
        avgOrderValue: todayOrders.length > 0 ? todayRevenue / todayOrders.length : 0,
      });

      setYesterday({
        orders: yesterdayOrders.length,
        revenue: yesterdayRevenue,
        avgOrderValue: yesterdayOrders.length > 0 ? yesterdayRevenue / yesterdayOrders.length : 0,
      });

      // Recent 5 orders
      setRecentOrders(todayOrders.slice(0, 5));

      // Top items (from all recent orders)
      const itemCounts: Record<string, number> = {};
      allOrders.forEach(o => {
        ((o.items as { items?: { name: string; quantity?: number }[] } | null)?.items || []).forEach((i) => {
          itemCounts[i.name] = (itemCounts[i.name] || 0) + (i.quantity || 1);
        });
      });
      const todayCounts: Record<string, number> = {};
      todayOrders.forEach(o => ((o.items as { items?: { name: string; quantity?: number }[] } | null)?.items || []).forEach((i: { name: string; quantity?: number }) => { todayCounts[i.name] = (todayCounts[i.name] || 0) + (i.quantity || 1); }));
      setTodayTop(Object.entries(todayCounts).sort((a, b) => b[1] - a[1]).slice(0, 3));

      const sorted = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      setTopItems(sorted.map(([name, count]) => ({ name, count })));

    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatINR = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

  const getChange = (today: number, yesterday: number) => {
    if (yesterday === 0) return today > 0 ? 100 : 0;
    return Math.round(((today - yesterday) / yesterday) * 100);
  };

  // wa.me opens WhatsApp with the report typed out; owner picks who gets it (self, partner, manager)
  // ponytail: manual send; an automatic nightly report needs a backend cron + WhatsApp Business API
  const shareReport = () => {
    const date = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    const change = getChange(today.revenue, yesterday.revenue);
    const lines = [
      `📊 *Sales Report – ${date}*`,
      "",
      `💰 Revenue: *${formatINR(today.revenue)}*${yesterday.revenue ? ` (${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs yesterday)` : ""}`,
      `🧾 Orders: *${today.orders}*`,
      `🛒 Avg order: ${formatINR(today.avgOrderValue)}`,
      ...(todayTop.length ? ["", "🔥 *Top items*", ...todayTop.map(([n, c], i) => `${i + 1}. ${n} × ${c}`)] : []),
      ...(stats.avgRating ? ["", `⭐ Rating: ${stats.avgRating}/5 (${stats.totalFeedback} review${stats.totalFeedback === 1 ? "" : "s"})`] : []),
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener,noreferrer");
  };

  const formatTime =(d: string) => new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  const ordersChange = getChange(today.orders, yesterday.orders);
  const revenueChange = getChange(today.revenue, yesterday.revenue);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-52 rounded-xl" />
          <Skeleton className="h-4 w-80 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground mt-1">How today is going, at a glance</p>
        </div>
        <Button onClick={shareReport} variant="outline" className="gap-2">
          <Send className="h-4 w-4" />Send today's report
        </Button>
      </div>

      {/* Primary stats: today's performance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          { label: "Today's revenue", Icon: IndianRupee, value: <CountUp value={today.revenue} format={formatINR} />, change: revenueChange },
          { label: "Today's orders", Icon: ShoppingBag, value: <CountUp value={today.orders} />, change: ordersChange },
          { label: "Active orders", Icon: Clock, value: stats.activeOrders, live: stats.activeOrders > 0 },
          { label: "Menu views", Icon: Eye, value: stats.totalViews },
        ] as { label: string; Icon: typeof Clock; value: ReactNode; change?: number; live?: boolean }[]).map(({ label, Icon, value, change, live }) => (
          <Card key={label} className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center ${live ? 'bg-accent text-primary' : 'bg-muted/70 text-foreground/70'}`}>
                <Icon className="h-5 w-5" />
              </div>
              {!!change && (
                <span className={`inline-flex items-center rounded-full px-2 h-6 text-xs font-semibold tabular-nums ${change > 0 ? 'bg-emerald-600/10 text-emerald-800 dark:text-emerald-300' : 'bg-destructive/10 text-destructive'}`}>
                  {change > 0 ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
                  {Math.abs(change)}%<span className="sr-only"> vs yesterday</span>
                </span>
              )}
              {live && <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />}
            </div>
            <p className="text-2xl md:text-3xl font-semibold tabular-nums leading-tight">{value}</p>
            <p className="text-xs text-muted-foreground mt-1 font-medium">{label}</p>
          </Card>
        ))}
      </div>

      {/* Middle row: yesterday comparison and averages */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          ["Yesterday's revenue", formatINR(yesterday.revenue)],
          ["Yesterday's orders", yesterday.orders],
          ["Avg order value", formatINR(today.avgOrderValue)],
        ] as [string, ReactNode][]).map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
        <Card className="p-4">
          <p className="text-xs text-muted-foreground font-medium mb-1">Avg rating</p>
          {stats.avgRating > 0 ? (
            <p className="text-lg font-semibold tabular-nums flex items-center gap-1">
              <Star className="h-4 w-4 text-primary fill-primary" />{stats.avgRating}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground pt-1">No ratings yet</p>
          )}
        </Card>
      </div>

      {/* Bottom row: recent orders and top items */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card className="overflow-hidden">
          <div className="p-5 pb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              Recent orders today
            </h3>
          </div>
          <div className="px-5 pb-5">
            {recentOrders.length > 0 ? (
              <div className="space-y-1.5">
                {recentOrders.map((order) => (
                  <div key={order.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/30">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-display text-base w-12 flex-shrink-0">#{order.order_number?.slice(-3)}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">Table {order.table_number}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{formatTime(order.created_at)}</p>
                      </div>
                    </div>
                    <Badge className={`rounded-full text-xs ${STATUS_TONE[asStatus(order.status)]}`} variant="outline">
                      {STATUS[asStatus(order.status)].badge}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No orders today yet</p>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="p-5 pb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Top selling items
            </h3>
          </div>
          <div className="px-5 pb-5">
            {topItems.length > 0 ? (
              <ol className="space-y-1.5">
                {topItems.map((item, idx) => (
                  <li key={item.name} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/30">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold tabular-nums flex-shrink-0 ${idx === 0 ? 'bg-accent text-accent-foreground' : 'bg-muted/70 text-foreground/70'}`}>
                        {idx + 1}
                      </span>
                      <p className="text-sm font-semibold truncate">{item.name}</p>
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground flex-shrink-0">
                      {item.count} sold
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No sales data yet</p>
            )}
          </div>
        </Card>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        {([
          ["Menu items", stats.totalMenuItems, Utensils],
          ["Total orders", stats.totalOrders, Package],
          ["Feedback", stats.totalFeedback, MessageSquare],
        ] as [string, number, typeof Package][]).map(([label, value, Icon]) => (
          <Card key={label} className="p-4 text-center">
            <Icon className="h-5 w-5 text-primary mx-auto mb-2" />
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default StatsOverview;
