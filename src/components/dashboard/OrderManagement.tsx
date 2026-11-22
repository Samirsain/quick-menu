import { useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useBusinessType } from "@/hooks/useBusinessType";
import { 
  Clock, Package, Bell, RefreshCw, ChevronDown, ChevronUp, 
  Receipt, CheckCircle2, Timer, Utensils,
  Search, Calendar, TrendingUp, X, XCircle, ChefHat, Printer
} from "lucide-react";
import { printKot } from "@/lib/printKot";
import { STATUS, STATUS_TONE, asStatus, isActive, type OrderStatus } from "@/lib/orderFlow";
import { RealtimeChannel } from "@supabase/supabase-js";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";

interface Order {
  id: string;
  order_number: string;
  table_number: string;
  items: any;
  status: string;
  created_at: string;
  session_id: string | null;
}

interface SessionGroup {
  sessionId: string;
  tableNumber: string;
  orders: Order[];
  totalItems: number;
  totalPrice: number;
  allItems: { name: string; quantity: number; price: number; selectedSize?: string }[];
  latestOrderTime: string;
  earliestOrderTime: string;
  hasNewOrder: boolean;
  allCompleted: boolean;
}

interface OrderManagementProps {
  restaurantId: string;
  onNewOrder?: (order: Order) => void;
  newOrderTrigger?: Order | null;
  isVisible?: boolean;
}

type FilterTab = 'active' | 'completed' | 'cancelled' | 'all';

const GROUPING_WINDOW_MS = 90 * 60 * 1000; // 90 minutes

const LEAD_ORDER: OrderStatus[] = ["pending", "ready", "accepted", "preparing", "completed", "rejected", "cancelled"];

const OrderManagement = ({ restaurantId, newOrderTrigger, isVisible }: OrderManagementProps) => {
  const { toast } = useToast();
  const { locationLabel, locationLabelLower } = useBusinessType(restaurantId);
  const [orders, setOrders] = useState<Order[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Filter states
  const [activeTab, setActiveTab] = useState<FilterTab>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('today');

  useEffect(() => {
    fetchOrders();
    subscribeToOrders();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [restaurantId]);

  useEffect(() => {
    if (isVisible) {
      fetchOrders();
    }
  }, [isVisible]);

  useEffect(() => {
    if (newOrderTrigger && newOrderTrigger.id) {
      setOrders(currentOrders => {
        const exists = currentOrders.some(o => o.id === newOrderTrigger.id);
        if (exists) return currentOrders;
        
        setNewOrderIds(prev => new Set(prev).add(newOrderTrigger.id));
        const sessionKey = newOrderTrigger.session_id || `table_${newOrderTrigger.table_number}_${newOrderTrigger.id}`;
        setExpandedSessions(prev => new Set(prev).add(sessionKey));
        
        // Switch to active tab when new order comes
        setActiveTab('active');
        
        setTimeout(() => {
          setNewOrderIds(prev => {
            const updated = new Set(prev);
            updated.delete(newOrderTrigger.id);
            return updated;
          });
        }, 10000);
        
        return [newOrderTrigger, ...currentOrders];
      });
    }
  }, [newOrderTrigger]);

  const fetchOrders = async () => {
    try {
      setIsRefreshing(true);
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load orders",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
      setInitialLoading(false);
    }
  };

  const subscribeToOrders = () => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channelName = `order-management-updates-${restaurantId}-${Date.now()}`;

    channelRef.current = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const updatedOrder = payload.new as Order;
          setOrders(prev => prev.map(order =>
            order.id === updatedOrder.id ? updatedOrder : order
          ));
        }
      )
      .subscribe();
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      setOrders(prev => prev.map(order =>
        order.id === orderId ? { ...order, status: newStatus } : order
      ));

      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus })
        .eq("id", orderId);

      if (error) throw error;

      toast({
        title: "Order updated",
        description: `Marked as ${getStatusLabel(newStatus).toLowerCase()}`,
        duration: 2000,
      });
    } catch (error: any) {
      fetchOrders();
      toast({
        title: "Error",
        description: "Failed to update order status",
        variant: "destructive",
      });
    }
  };

  // Filter orders based on date
  const filteredByDate = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return orders.filter(order => {
      const orderDate = new Date(order.created_at);
      if (dateFilter === 'today') return orderDate >= startOfToday;
      if (dateFilter === 'week') return orderDate >= startOfWeek;
      if (dateFilter === 'month') return orderDate >= startOfMonth;
      return true;
    });
  }, [orders, dateFilter]);

  // Filter by search query
  const filteredBySearch = useMemo(() => {
    if (!searchQuery.trim()) return filteredByDate;
    const q = searchQuery.toLowerCase();
    return filteredByDate.filter(order => 
      order.order_number.toLowerCase().includes(q) ||
      order.table_number.toLowerCase().includes(q) ||
      order.items?.items?.some((item: any) => item.name.toLowerCase().includes(q))
    );
  }, [filteredByDate, searchQuery]);

  // Filter by tab (active/completed/cancelled/all)
  const filteredOrders = useMemo(() => {
    if (activeTab === 'active') {
      return filteredBySearch.filter(o => isActive(o.status));
    } else if (activeTab === 'completed') {
      return filteredBySearch.filter(o => o.status === 'completed');
    } else if (activeTab === 'cancelled') {
      return filteredBySearch.filter(o => o.status === 'rejected' || o.status === 'cancelled');
    }
    return filteredBySearch;
  }, [filteredBySearch, activeTab]);

  // Group orders by session_id
  const sessionGroups = useMemo((): SessionGroup[] => {
    const now = Date.now();
    const groups: Map<string, SessionGroup> = new Map();

    filteredOrders.forEach(order => {
      const sessionKey = order.session_id || `legacy_${order.id}`;
      
      if (!groups.has(sessionKey)) {
        groups.set(sessionKey, {
          sessionId: sessionKey,
          tableNumber: order.table_number,
          orders: [],
          totalItems: 0,
          totalPrice: 0,
          allItems: [],
          latestOrderTime: order.created_at,
          earliestOrderTime: order.created_at,
          hasNewOrder: false,
          allCompleted: true,
        });
      }

      const group = groups.get(sessionKey)!;
      group.orders.push(order);
      
      if (newOrderIds.has(order.id)) {
        group.hasNewOrder = true;
      }

      if (order.status !== 'completed') {
        group.allCompleted = false;
      }

      if (new Date(order.created_at) > new Date(group.latestOrderTime)) {
        group.latestOrderTime = order.created_at;
      }
      if (new Date(order.created_at) < new Date(group.earliestOrderTime)) {
        group.earliestOrderTime = order.created_at;
      }

      const orderItems = order.items?.items || [];
      orderItems.forEach((item: any) => {
        const existingItem = group.allItems.find(
          i => i.name === item.name && i.selectedSize === item.selectedSize
        );
        if (existingItem) {
          existingItem.quantity += item.quantity || 1;
        } else {
          group.allItems.push({
            name: item.name,
            quantity: item.quantity || 1,
            price: item.price,
            selectedSize: item.selectedSize,
          });
        }
        group.totalItems += item.quantity || 1;
        group.totalPrice += (item.price || 0) * (item.quantity || 1);
      });
    });

    return Array.from(groups.values()).sort((a, b) => {
      if (a.allCompleted !== b.allCompleted) {
        return a.allCompleted ? 1 : -1;
      }
      return new Date(b.latestOrderTime).getTime() - new Date(a.latestOrderTime).getTime();
    });
  }, [filteredOrders, newOrderIds]);

  const toggleSessionExpand = (sessionId: string) => {
    setExpandedSessions(prev => {
      const updated = new Set(prev);
      if (updated.has(sessionId)) {
        updated.delete(sessionId);
      } else {
        updated.add(sessionId);
      }
      return updated;
    });
  };

  // Labels come from the shared order flow so the dashboard and kitchen display use the same words
  const getStatusColor = (status: string) => STATUS_TONE[asStatus(status)];
  const getStatusLabel = (status: string) => STATUS[asStatus(status)].badge;

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${mins % 60}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-IN', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-IN', { 
      day: 'numeric',
      month: 'short',
    });
  };

  // Stats based on filtered orders (respects date filter)
  const activeOrdersCount = filteredByDate.filter(o => isActive(o.status)).length;
  const completedOrdersCount = filteredByDate.filter(o => o.status === 'completed').length;
  const cancelledOrdersCount = filteredByDate.filter(o => o.status === 'rejected' || o.status === 'cancelled').length;
  
  // Revenue from completed orders in the selected date range
  const filteredRevenue = useMemo(() => {
    return filteredByDate
      .filter(o => o.status === 'completed')
      .reduce((sum, o) => {
        const orderTotal = o.items?.items?.reduce((s: number, item: any) => 
          s + ((item.price || 0) * (item.quantity || 1)), 0) || 0;
        return sum + orderTotal;
      }, 0);
  }, [filteredByDate]);

  // Total orders count (all time, for the "All Orders" tab)
  const totalOrdersCount = orders.length;

  const dateLabel = dateFilter === 'today' ? "Today's" : dateFilter === 'week' ? "This Week's" : dateFilter === 'month' ? "This Month's" : "Total";

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'active', label: 'Active', count: activeOrdersCount },
    { id: 'completed', label: 'Completed', count: completedOrdersCount },
    { id: 'cancelled', label: 'Cancelled', count: cancelledOrdersCount },
    { id: 'all', label: 'All Orders', count: filteredByDate.length },
  ];

  return (
    <div className="space-y-6">
      {/* Skeleton Loading */}
      {initialLoading ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-8 w-52 rounded-xl" />
              <Skeleton className="h-4 w-72 rounded-lg" />
            </div>
            <Skeleton className="h-10 w-24 rounded-xl" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-10 w-28 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : (
      <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Orders</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Live orders, grouped by table visit
          </p>
        </div>
        <Button
          onClick={fetchOrders}
          variant="outline"
          className="gap-2"
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          { label: "Active orders", value: activeOrdersCount, Icon: Timer, tab: 'active' as FilterTab, stamp: true },
          { label: "Completed", value: completedOrdersCount, Icon: CheckCircle2, tab: 'completed' as FilterTab },
          { label: "Cancelled", value: cancelledOrdersCount, Icon: XCircle, tab: 'cancelled' as FilterTab },
        ]).map(({ label, value, Icon, tab, stamp }) => (
          <button
            key={label}
            type="button"
            onClick={() => { setActiveTab(tab); if (tab !== 'active') setDateFilter('all'); }}
            aria-pressed={activeTab === tab}
            className={`rounded-[20px] border bg-card p-4 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === tab ? 'border-primary/50' : ''}`}
          >
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${stamp ? 'bg-accent text-primary' : 'bg-muted/70 text-foreground/70'}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums leading-tight">{value}</p>
                <p className="text-xs text-muted-foreground font-medium">{label}</p>
              </div>
            </div>
          </button>
        ))}
        <div className="rounded-[20px] border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 bg-muted/70 text-foreground/70">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums leading-tight">₹{filteredRevenue.toFixed(0)}</p>
              <p className="text-xs text-muted-foreground font-medium">{dateLabel} revenue</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {tabs.map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'completed' || tab.id === 'cancelled') {
                  setDateFilter('all');
                }
              }}
              aria-pressed={activeTab === tab.id}
              className="gap-2 rounded-full"
            >
              {tab.label}
              <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums flex items-center justify-center ${activeTab === tab.id ? 'bg-primary-foreground/20' : 'bg-muted'}`}>
                {tab.count}
              </span>
            </Button>
          ))}
        </div>

        {/* Search & Date Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search orders"
              placeholder={`Search by order #, ${locationLabelLower}, or item`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10 h-11 rounded-full"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {/* Scrolls sideways on narrow phones instead of cutting off "All Time" */}
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Button
              variant={dateFilter === 'today' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateFilter('today')}
              className="gap-2 rounded-full"
            >
              <Calendar className="h-4 w-4" />
              Today
            </Button>
            <Button
              variant={dateFilter === 'week' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateFilter('week')}
              className="rounded-full"
            >
              This Week
            </Button>
            <Button
              variant={dateFilter === 'month' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateFilter('month')}
              className="rounded-full"
            >
              This Month
            </Button>
            <Button
              variant={dateFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateFilter('all')}
              className="rounded-full"
            >
              All Time
            </Button>
          </div>
        </div>
      </div>

      {/* Session Groups */}
      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {sessionGroups.map((group) => {
            const isExpanded = expandedSessions.has(group.sessionId);
            
            return (
              <motion.div
                key={group.sessionId}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
              >
                <Card className={`overflow-hidden transition-colors duration-300 ${
                  group.allCompleted
                    ? 'bg-background/60'
                    : group.hasNewOrder
                      ? 'border-primary/50 ring-1 ring-primary/25'
                      : 'hover:border-primary/30'
                }`}>
                  {/* Session Header */}
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleSessionExpand(group.sessionId)}
                    className="w-full p-4 md:p-5 flex items-center justify-between gap-4 hover:bg-muted/30 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className={`h-12 w-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                        group.allCompleted
                          ? 'bg-muted/70 text-muted-foreground'
                          : group.hasNewOrder
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-accent text-primary'
                      }`}>
                        {group.hasNewOrder && !group.allCompleted && <Bell className="h-5 w-5" />}
                        {!group.hasNewOrder && !group.allCompleted && <Utensils className="h-5 w-5" />}
                        {group.allCompleted && <CheckCircle2 className="h-5 w-5" />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className={`font-display text-2xl leading-tight ${group.allCompleted ? 'text-muted-foreground' : ''}`}>
                            {locationLabel} {group.tableNumber}
                          </h3>
                          {group.orders.length > 1 && (
                            <Badge variant="secondary" className="text-xs">
                              {group.orders.length} orders
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {getTimeAgo(group.latestOrderTime)}
                          </span>
                          <span aria-hidden>·</span>
                          <span>{group.totalItems} items</span>
                          {dateFilter !== 'today' && (
                            <>
                              <span aria-hidden>·</span>
                              <span>{formatDate(group.latestOrderTime)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                      <div className="text-right space-y-1">
                        <p className="text-xl md:text-2xl font-semibold tabular-nums leading-tight">
                          ₹{group.totalPrice.toFixed(0)}
                        </p>
                        {(() => {
                          // Show the status that needs attention first, same order as the kitchen display
                          const lead = LEAD_ORDER.find(s => group.orders.some(o => asStatus(o.status) === s)) ?? 'completed';
                          return (
                            <Badge className={`${getStatusColor(lead)} whitespace-nowrap`} variant="outline">
                              {getStatusLabel(lead)}
                            </Badge>
                          );
                        })()}
                      </div>
                      <div className="h-9 w-9 flex items-center justify-center rounded-full bg-muted/50">
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5" />
                        ) : (
                          <ChevronDown className="h-5 w-5" />
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Expanded Content */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 md:px-5 pb-4 md:pb-5 space-y-4 border-t">
                          {/* Combined Items Summary */}
                          <div className="pt-4">
                            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                              <Receipt className="h-4 w-4" />
                              All Items Summary
                            </h4>
                            <div className="bg-muted/30 rounded-xl p-4 space-y-2">
                              {group.allItems.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center text-sm">
                                  <span className="flex items-center gap-2">
                                    <span className="font-medium">{item.name}</span>
                                    {item.selectedSize && (
                                      <Badge variant="outline" className="text-xs px-1.5 py-0 font-medium text-muted-foreground">
                                        {item.selectedSize}
                                      </Badge>
                                    )}
                                    <span className="text-muted-foreground tabular-nums">×{item.quantity}</span>
                                  </span>
                                  <span className="font-semibold tabular-nums">₹{(item.price * item.quantity).toFixed(0)}</span>
                                </div>
                              ))}
                              <div className="border-t pt-2 mt-2 flex justify-between font-semibold">
                                <span>Total</span>
                                <span className="tabular-nums">₹{group.totalPrice.toFixed(0)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Individual Orders */}
                          <div>
                            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                              <Package className="h-4 w-4" />
                              Individual Orders
                            </h4>
                            <div className="space-y-3">
                              {group.orders.map((order) => {
                                const isNew = newOrderIds.has(order.id);
                                const isCompleted = order.status === 'completed';
                                const isTerminal = ['completed', 'rejected', 'cancelled'].includes(order.status);
                                
                                return (
                                  <div
                                    key={order.id}
                                    className={`rounded-2xl p-4 ${
                                      isNew ? 'bg-accent/60 ring-1 ring-primary/30' : 'bg-muted/25'
                                    } ${isTerminal ? 'opacity-60' : ''}`}
                                  >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                          {isNew && <Bell className="h-4 w-4 text-primary" aria-label="New" />}
                                          <span className="font-display text-lg leading-none">#{order.order_number}</span>
                                          <Badge className={`${getStatusColor(order.status)} text-xs`} variant="outline">
                                            {getStatusLabel(order.status)}
                                          </Badge>
                                          <span className="text-xs text-muted-foreground tabular-nums">
                                            {formatTime(order.created_at)}
                                          </span>
                                          {order.status !== 'rejected' && order.status !== 'cancelled' && (
                                            <button
                                              type="button"
                                              onClick={() => printKot(order, locationLabel)}
                                              className="ml-auto inline-flex items-center gap-1 rounded-lg h-8 px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                              title="Print kitchen ticket"
                                            >
                                              <Printer className="h-3.5 w-3.5" />
                                              KOT
                                            </button>
                                          )}
                                        </div>
                                        
                                        <div className="flex flex-wrap gap-1.5">
                                          {order.items?.items?.map((item: any, idx: number) => (
                                            <Badge
                                              key={idx}
                                              variant="outline"
                                              className="text-xs font-normal bg-card"
                                            >
                                              {item.name}
                                              {item.selectedSize && (
                                                <span className="ml-1 text-muted-foreground">
                                                  ({item.selectedSize})
                                                </span>
                                              )}
                                              {item.quantity > 1 && <span className="ml-1 font-semibold tabular-nums">×{item.quantity}</span>}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>

                                      {!isTerminal && (
                                        <div className="flex gap-2 flex-wrap">
                                          {/* One forward action per order (stamp), Reject stays quiet */}
                                          {order.status === 'pending' && (
                                            <Button size="sm" onClick={() => updateOrderStatus(order.id, 'accepted')} className="gap-1.5">
                                              <CheckCircle2 className="h-4 w-4" />
                                              Accept
                                            </Button>
                                          )}
                                          {order.status === 'accepted' && (
                                            <Button size="sm" onClick={() => updateOrderStatus(order.id, 'preparing')} className="gap-1.5">
                                              <ChefHat className="h-4 w-4" />
                                              Start preparing
                                            </Button>
                                          )}
                                          {order.status === 'preparing' && (
                                            <Button size="sm" onClick={() => updateOrderStatus(order.id, 'completed')} className="gap-1.5">
                                              <CheckCircle2 className="h-4 w-4" />
                                              Mark complete
                                            </Button>
                                          )}
                                          {order.status === 'ready' && (
                                            <Button size="sm" onClick={() => updateOrderStatus(order.id, 'completed')} className="gap-1.5">
                                              <CheckCircle2 className="h-4 w-4" />
                                              Mark served
                                            </Button>
                                          )}
                                          {(order.status === 'pending' || order.status === 'accepted') && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => updateOrderStatus(order.id, 'rejected')}
                                              className="gap-1.5 text-destructive hover:border-destructive/40"
                                            >
                                              <XCircle className="h-4 w-4" />
                                              Reject
                                            </Button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Empty State */}
      {sessionGroups.length === 0 && (
        <Card className="p-10 md:p-12 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-accent flex items-center justify-center">
            <Package className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            {activeTab === 'active' && 'No active orders'}
            {activeTab === 'completed' && 'No completed orders'}
            {activeTab === 'cancelled' && 'No cancelled orders'}
            {activeTab === 'all' && 'No orders yet'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {activeTab === 'active' && 'Active orders will appear here when customers place them'}
            {activeTab === 'completed' && 'Completed orders will appear here'}
            {activeTab === 'cancelled' && 'Rejected and cancelled orders will appear here'}
            {activeTab === 'all' && 'Orders will appear here when customers place them'}
          </p>
          {(searchQuery || dateFilter !== 'all') && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setSearchQuery('');
                setDateFilter('all');
              }}
            >
              Clear filters
            </Button>
          )}
        </Card>
      )}
      </>
      )}
    </div>
  );
};

export default OrderManagement;
