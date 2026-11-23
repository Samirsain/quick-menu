import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import { 
  QrCode, 
  LogOut, 
  Menu as MenuIcon, 
  Package,
  BarChart3,
  Settings,
  Bell,
  X,
  User,
  FileText,
  ChefHat,
  Download,
  Sun,
  Moon,
  MoreHorizontal,
  Droplets,
  PauseCircle,
  LayoutGrid,
  Users,
  LineChart,
  ChevronDown,
  LifeBuoy,
  SprayCan,
} from "lucide-react";
import { InstallAppButton } from "@/components/InstallAppButton";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import MenuManagement from "@/components/dashboard/MenuManagement";
import OrderManagement from "@/components/dashboard/OrderManagement";
import FeedbackView from "@/components/dashboard/FeedbackView";
import StatsOverview from "@/components/dashboard/StatsOverview";
import QRCodeDisplay from "@/components/dashboard/QRCodeDisplay";
import SocialLinksForm from "@/components/dashboard/SocialLinksForm";
import RestaurantProfile from "@/components/dashboard/RestaurantProfile";
import ServiceCallsPanel from "@/components/dashboard/ServiceCallsPanel";
import FloorView from "@/components/dashboard/FloorView";
import ReportsView from "@/components/dashboard/ReportsView";
import StaffView, { ShiftChip } from "@/components/dashboard/StaffView";
import ServiceSetup from "@/components/dashboard/ServiceSetup";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useOnShift } from "@/hooks/useOnShift";

interface Order {
  id: string;
  order_number: string;
  table_number: string;
  items: any;
  status: string;
  created_at: string;
  session_id: string | null;
}

interface ServiceCall {
  id: string;
  table_number: string;
  call_type: "waiter" | "water" | "bill";
  status: string;
  created_at: string;
}

const DashboardWithSidebar = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const { locationLabel } = useBusinessType(restaurantId);
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantLogo, setRestaurantLogo] = useState<string | null>(null);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [serviceCallsCount, setServiceCallsCount] = useState(0);
  const [serviceCallNotification, setServiceCallNotification] = useState<ServiceCall | null>(null);
  const serviceCallSoundRef = useRef<NodeJS.Timeout | null>(null);
  const serviceCallAudioRef = useRef<AudioContext | null>(null);

  // Apply saved dashboard theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('dashboard-theme') as 'light' | 'dark' | 'system' | null;
    const theme = savedTheme || 'light';
    
    if (theme === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', systemDark);
    } else {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
  }, []);

  const [newOrderNotification, setNewOrderNotification] = useState<Order | null>(null);
  const [lastNewOrder, setLastNewOrder] = useState<Order | null>(null);
  const [lastViewCount, setLastViewCount] = useState(0);
  const [isRestaurantDisabled, setIsRestaurantDisabled] = useState(false);
  // The tab lives in the URL (?tab=orders) so refresh/back keep it and app shortcuts can open a tab directly
  const [activeTab, setActiveTab] = useState(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "cashier") return "floor"; // the cashier list now sits at the top of Floor
    return tab && TABS.includes(tab) ? tab : "stats";
  });
  const { who: onShift } = useOnShift(restaurantId);
  const [setupPref, setSetupPref] = useState<boolean | null>(() => {
    try { const v = localStorage.getItem("qm_nav_setup"); return v ? v === "open" : null; } catch { return null; }
  });
  const [open, setOpen] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastOrderCountRef = useRef<number>(0);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dashboardLoadTimeRef = useRef<number>(Date.now()); // Track when dashboard loaded
  const processedOrderIdsRef = useRef<Set<string>>(new Set()); // Track processed orders

  // Helper to handle tab change and close mobile sidebar
  const handleTabChange = (tab: string) => {
    setOpen(false); // Close mobile sidebar
    if (tab === activeTab) return;
    setActiveTab(tab);
    window.history.replaceState(null, "", tab === "stats" ? "/dashboard" : `/dashboard?tab=${tab}`);
  };

  // Two groups: what staff use during service, and set-up/review pages (owners mostly)
  const links = [
    { group: "service", label: "Home", href: "#stats", icon: <BarChart3 className="h-5 w-5 flex-shrink-0" />, onClick: () => handleTabChange("stats") },
    { group: "service", label: "Floor", href: "#floor", icon: <LayoutGrid className="h-5 w-5 flex-shrink-0" />, onClick: () => handleTabChange("floor") },
    {
      group: "service", label: "Orders", href: "#orders", icon: <Package className="h-5 w-5 flex-shrink-0" />,
      onClick: () => { handleTabChange("orders"); setNewOrdersCount(0); },
      badge: newOrdersCount,
    },
    { group: "service", label: "Kitchen", href: "/kitchen", icon: <ChefHat className="h-5 w-5 flex-shrink-0" />, onClick: () => {} },
    {
      group: "service", label: "Service calls", href: "#service-calls", icon: <Bell className="h-5 w-5 flex-shrink-0" />,
      onClick: () => { handleTabChange("service-calls"); setServiceCallsCount(0); },
      badge: serviceCallsCount,
    },
    { group: "setup", label: "Menu", href: "#menu", icon: <MenuIcon className="h-5 w-5 flex-shrink-0" />, onClick: () => handleTabChange("menu") },
    { group: "setup", label: "QR codes", href: "#qr", icon: <QrCode className="h-5 w-5 flex-shrink-0" />, onClick: () => handleTabChange("qr") },
    { group: "setup", label: "Staff", href: "#staff", icon: <Users className="h-5 w-5 flex-shrink-0" />, onClick: () => handleTabChange("staff") },
    { group: "setup", label: "Reports", href: "#reports", icon: <LineChart className="h-5 w-5 flex-shrink-0" />, onClick: () => handleTabChange("reports") },
    { group: "setup", label: "Settings", href: "#profile", icon: <Settings className="h-5 w-5 flex-shrink-0" />, onClick: () => handleTabChange("profile") },
  ];
  const navTab = PARENT[activeTab] ?? activeTab; // sub-pages (Reviews, Bills & extras…) light up their parent item
  // Waiters/kitchen/cashier on shift rarely need set-up pages, so that group starts folded for them (one tap opens it)
  const crew = !!onShift && onShift.role !== "manager";
  const setupOpen = setupPref ?? (!crew || links.some(l => l.group === "setup" && l.href === `#${navTab}`));
  const toggleSetup = () => {
    setSetupPref(!setupOpen);
    try { localStorage.setItem("qm_nav_setup", setupOpen ? "closed" : "open"); } catch { /* private mode */ }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!restaurantId) return;
    const ch = supabase.channel(`low-rating-${restaurantId}-${Date.now()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "feedback", filter: `restaurant_id=eq.${restaurantId}` },
        async (p: { new: { rating: number; order_id: string; comment: string | null } }) => {
          if (p.new.rating > 2) return;
          const { data } = await supabase.from("orders").select("table_number").eq("id", p.new.order_id).maybeSingle();
          toast({
            title: `${p.new.rating}-star review${data?.table_number ? ` from table ${data.table_number}` : ""}`,
            description: p.new.comment ? `"${p.new.comment.slice(0, 120)}" Worth a visit to the table now.` : "Worth a visit to the table now.",
            variant: "destructive",
            duration: 20000,
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [restaurantId]);

  // Setup OneSignal for push notifications
  useEffect(() => {
    if (!restaurantId) return;

    const setupOneSignal = async () => {
      if (typeof window === "undefined" || !(window as any).OneSignalDeferred) {
        console.log("⚠️ OneSignal not available");
        return;
      }

      (window as any).OneSignalDeferred.push(async function (OneSignal: any) {
        try {
          // Tag user with restaurant_id so notifications go to the right device
          await OneSignal.User.addTag("restaurant_id", restaurantId);
          console.log("✅ OneSignal tagged with restaurant_id:", restaurantId);

          // Check if already subscribed
          const permission = await OneSignal.Notifications.permission;
          console.log("🔔 OneSignal permission:", permission);

          // Request permission if not granted
          if (!permission) {
            const granted = await OneSignal.Notifications.requestPermission();
            console.log("🔔 Permission request result:", granted);
            
            if (granted) {
              toast({
                title: "Notifications on",
                description: "You'll get an alert when a new order comes in",
                duration: 5000,
              });
            }
          }

          // Log subscription status
          const subscribed = await OneSignal.User.PushSubscription.optedIn;
          console.log("🔔 OneSignal subscribed:", subscribed);
        } catch (error) {
          console.error("❌ OneSignal setup error:", error);
        }
      });
    };

    // Delay to ensure OneSignal is fully loaded
    const timer = setTimeout(setupOneSignal, 2000);
    return () => clearTimeout(timer);
  }, [restaurantId]);

  // Refs for service call tracking
  const serviceCallChannelRef = useRef<any>(null);
  const processedServiceCallIds = useRef<Set<string>>(new Set());
  const serviceCallInitialLoadDone = useRef(false);

  // Subscribe to realtime updates
  useEffect(() => {
    if (restaurantId) {
      // Subscribe to orders at dashboard level (always active)
      const cleanupOrders = subscribeToNewOrders();
      const cleanupViews = subscribeToMenuViews();
      const cleanupServiceCalls = subscribeToServiceCalls();
      
      // Get initial view count
      supabase
        .from("menu_views")
        .select("view_count")
        .eq("restaurant_id", restaurantId)
        .single()
        .then(({ data }) => {
          if (data) {
            setLastViewCount(data.view_count);
          }
        });
      
      // IMPORTANT: Initialize order count FIRST before starting polling
      // This prevents the sound from playing on page load/refresh
      const initializeOrderCount = async () => {
        try {
          const { data, error } = await supabase
            .from("orders")
            .select("id")
            .eq("restaurant_id", restaurantId);
          
          if (!error && data) {
            // Set the initial count so polling doesn't think existing orders are new
            lastOrderCountRef.current = data.length;
            console.log('📊 Initialized order count:', data.length);
          }
        } catch (err) {
          console.error('Error initializing order count:', err);
        }
      };
      
      // Initialize first, then start polling after a delay
      initializeOrderCount().then(() => {
        // Start polling AFTER we have the initial count
        pollingIntervalRef.current = setInterval(async () => {
          try {
            const { data, error } = await supabase
              .from("orders")
              .select("id, order_number, table_number, items, status, created_at")
              .eq("restaurant_id", restaurantId)
              .order("created_at", { ascending: false });
            
            if (error) return;
            
            // Only trigger notification if count increased AND we have initialized
            if (data && data.length > lastOrderCountRef.current && lastOrderCountRef.current > 0) {
              const newOrderCount = data.length - lastOrderCountRef.current;
              const newOrders = data.slice(0, newOrderCount);
              
              newOrders.forEach((order) => {
                // Use the same checks as handleNewOrder
                const orderCreatedAt = new Date(order.created_at).getTime();
                if (orderCreatedAt < dashboardLoadTimeRef.current) {
                  return; // Skip old orders
                }
                if (processedOrderIdsRef.current.has(order.id)) {
                  return; // Skip already processed
                }
                
                processedOrderIdsRef.current.add(order.id);
                setNewOrdersCount(prev => prev + 1);
                setNewOrderNotification(order as Order);
                playPleasantNotificationSound();
                
                toast({
                  title: "New order",
                  description: `Order #${order.order_number} from ${locationLabel} ${order.table_number}`,
                  duration: 10000,
                });
              });
            }
            
            if (data) {
              lastOrderCountRef.current = data.length;
            }
          } catch (err) {
            console.error('Polling error:', err);
          }
        }, 5000); // Increased to 5 seconds to reduce load
      });
      
      return () => {
        if (cleanupOrders) cleanupOrders();
        if (cleanupViews) cleanupViews();
        if (cleanupServiceCalls) cleanupServiceCalls();
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
      };
    }
  }, [restaurantId]);

  // Subscribe to service calls at dashboard level (always active)
  const subscribeToServiceCalls = () => {
    if (!restaurantId) return;

    // First, fetch existing service calls to mark them as processed
    const initializeServiceCalls = async () => {
      try {
        const { data } = await supabase
          .from("service_calls")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .in("status", ["pending", "acknowledged"]);
        
        if (data) {
          data.forEach(call => processedServiceCallIds.current.add(call.id));
        }
        serviceCallInitialLoadDone.current = true;
        console.log('📞 Service calls initialized:', data?.length || 0);
      } catch (err) {
        console.error('Error initializing service calls:', err);
        serviceCallInitialLoadDone.current = true;
      }
    };

    initializeServiceCalls();

    const channelName = `dashboard-service-calls-${restaurantId}-${Date.now()}`;
    
    serviceCallChannelRef.current = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "service_calls",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const newCall = payload.new as ServiceCall;
          console.log('🔔 Dashboard: New service call received', newCall);
          
          // Skip if already processed
          if (processedServiceCallIds.current.has(newCall.id)) {
            console.log('⏭️ Skipping already processed service call');
            return;
          }
          
          // Skip if initial load not done
          if (!serviceCallInitialLoadDone.current) {
            console.log('⏭️ Skipping service call - initial load not done');
            processedServiceCallIds.current.add(newCall.id);
            return;
          }
          
          processedServiceCallIds.current.add(newCall.id);
          
          // Trigger notification with sound
          handleNewServiceCall(newCall);
          
          toast({
            title: `${CALL_LABEL[newCall.call_type] ?? "Service"} request`,
            description: `${locationLabel} ${newCall.table_number} needs ${newCall.call_type}`,
            duration: 10000,
          });
          
          console.log('✅ Dashboard: Service call notification triggered');
        }
      )
      .subscribe((status) => {
        console.log('📞 Dashboard service calls realtime status:', status);
      });

    return () => {
      if (serviceCallChannelRef.current) {
        supabase.removeChannel(serviceCallChannelRef.current);
      }
    };
  };

  const checkAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/auth");
        return;
      }

      const { data: restaurant, error } = await supabase
        .from("restaurants")
        .select("id, name, logo_url, is_active")
        .eq("user_id", session.user.id)
        .single();

      if (error) throw error;

      setRestaurantId(restaurant.id);
      setRestaurantName(restaurant.name);
      setRestaurantLogo(restaurant.logo_url);
      setIsRestaurantDisabled(!restaurant.is_active);
    } catch (error: any) {
      console.error("Auth check error:", error);
      toast({
        title: "Error",
        description: "Failed to load restaurant data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const subscribeToMenuViews = () => {
    if (!restaurantId) return;

    // Dashboard stays connected even in background - no visibility optimization
    const channelName = `menu-views-${restaurantId}-${Date.now()}`;
    
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "menu_views",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const newViewCount = payload.new.view_count;
          
          if (newViewCount > lastViewCount) {
            setLastViewCount(newViewCount);
            
            toast({
              title: "New customer",
              description: "Someone just scanned your QR code",
              duration: 5000,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  // Keep realtime subscription ALWAYS active at dashboard level
  // Dashboard must receive orders even when tab is in background
  const subscribeToNewOrders = () => {
    if (!restaurantId) return;

    const channelName = `dashboard-orders-${restaurantId}-${Date.now()}`;
    
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const newOrder = payload.new as Order;
          console.log('🔔 Dashboard: New order received', newOrder);
          handleNewOrder(newOrder);
        }
      )
      .subscribe((status) => {
        console.log('🔔 Dashboard realtime status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleNewOrder = (order: Order) => {
    // Skip if this order was created before dashboard loaded (prevents sound on refresh)
    const orderCreatedAt = new Date(order.created_at).getTime();
    if (orderCreatedAt < dashboardLoadTimeRef.current) {
      console.log('⏭️ Skipping old order (created before dashboard load):', order.order_number);
      return;
    }
    
    // Skip if we already processed this order (prevents duplicate sounds)
    if (processedOrderIdsRef.current.has(order.id)) {
      console.log('⏭️ Skipping already processed order:', order.order_number);
      return;
    }
    
    // Mark as processed
    processedOrderIdsRef.current.add(order.id);
    
    console.log('🎯 Dashboard: Handling new order', order);
    
    setNewOrdersCount(prev => prev + 1);
    setNewOrderNotification(order);
    
    // Create a new object reference to ensure React detects the change
    setLastNewOrder({ ...order, _timestamp: Date.now() } as any);
    
    playPleasantNotificationSound();
    
    toast({
      title: "New order",
      description: `Order #${order.order_number} from ${locationLabel} ${order.table_number}`,
      duration: 10000,
    });

    console.log('✅ Dashboard: New order notification triggered');
  };

  const playPleasantNotificationSound = () => {
    if (soundIntervalRef.current) {
      clearInterval(soundIntervalRef.current);
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const audioContext = audioContextRef.current;
    
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    let beepCount = 0;
    const maxBeeps = 30;

    const playBeep = () => {
      if (beepCount >= maxBeeps) {
        if (soundIntervalRef.current) {
          clearInterval(soundIntervalRef.current);
        }
        return;
      }

      const now = audioContext.currentTime;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      
      osc.start(now);
      osc.stop(now + 0.15);

      beepCount++;
    };

    playBeep();
    soundIntervalRef.current = setInterval(playBeep, 500);
  };

  const dismissNotification = () => {
    setNewOrderNotification(null);
    if (soundIntervalRef.current) {
      clearInterval(soundIntervalRef.current);
      soundIntervalRef.current = null;
    }
  };

  const dismissServiceCallNotification = () => {
    setServiceCallNotification(null);
    if (serviceCallSoundRef.current) {
      clearInterval(serviceCallSoundRef.current);
      serviceCallSoundRef.current = null;
    }
  };

  // Bell ringing sound for service calls (6+ seconds)
  const playServiceCallBellSound = () => {
    if (serviceCallSoundRef.current) {
      clearInterval(serviceCallSoundRef.current);
    }

    if (!serviceCallAudioRef.current) {
      serviceCallAudioRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const ctx = serviceCallAudioRef.current;
    if (ctx.state === "suspended") ctx.resume();

    let ringCount = 0;
    const maxRings = 8; // 8 rings over ~6-7 seconds

    const playBellRing = () => {
      if (ringCount >= maxRings) {
        if (serviceCallSoundRef.current) {
          clearInterval(serviceCallSoundRef.current);
          serviceCallSoundRef.current = null;
        }
        return;
      }

      const now = ctx.currentTime;
      
      // Bell sound with harmonics
      const bellFrequencies = [
        { freq: 830, gain: 0.4 },
        { freq: 1245, gain: 0.25 },
        { freq: 1660, gain: 0.15 },
        { freq: 415, gain: 0.2 },
      ];

      bellFrequencies.forEach(({ freq, gain: gainValue }) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(gainValue, now + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(gainValue * 0.3, now + 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.start(now);
        osc.stop(now + 0.6);
      });

      // Second strike for "ding-dong"
      setTimeout(() => {
        const now2 = ctx.currentTime;
        [{ freq: 622, gain: 0.35 }, { freq: 933, gain: 0.2 }, { freq: 1244, gain: 0.1 }].forEach(({ freq, gain: gainValue }) => {
          const osc = ctx.createOscillator();
          const gainNode = ctx.createGain();
          osc.connect(gainNode);
          gainNode.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = "sine";
          gainNode.gain.setValueAtTime(0, now2);
          gainNode.gain.linearRampToValueAtTime(gainValue, now2 + 0.01);
          gainNode.gain.exponentialRampToValueAtTime(gainValue * 0.3, now2 + 0.15);
          gainNode.gain.exponentialRampToValueAtTime(0.001, now2 + 0.5);
          osc.start(now2);
          osc.stop(now2 + 0.5);
        });
      }, 200);

      ringCount++;
    };

    playBellRing();
    serviceCallSoundRef.current = setInterval(playBellRing, 800);
  };

  const handleNewServiceCall = (call: ServiceCall) => {
    setServiceCallsCount(prev => prev + 1);
    setServiceCallNotification(call);
    playServiceCallBellSound();
    
    // Vibrate on mobile
    if ("vibrate" in navigator) {
      navigator.vibrate([200, 100, 200, 100, 200]);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background" role="status">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-border border-t-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  if (!restaurantId) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <h1 className="text-lg font-semibold">We couldn't load your restaurant</h1>
          <p className="mt-2 text-sm text-muted-foreground">Check your internet connection and try again. If it keeps happening, sign out and back in.</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
            <Button onClick={() => window.location.reload()}>Try again</Button>
            <Button variant="outline" onClick={handleSignOut} className="gap-2"><LogOut className="h-4 w-4" />Sign out</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (isRestaurantDisabled) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mx-auto mb-5">
            <PauseCircle className="h-8 w-8 text-primary" strokeWidth={1.75} />
          </div>
          <p className="font-display text-2xl leading-tight">{restaurantName}</p>
          <h1 className="mt-2 text-base font-semibold">Service is paused</h1>
          <p className="mt-1 text-sm text-muted-foreground">Guests can't open your menu or order right now. <Link to="/contact" className="font-medium text-accent-foreground underline underline-offset-4">Contact support</Link> to turn it back on.</p>
          <Button variant="outline" onClick={handleSignOut} className="mt-6 gap-2">
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </Card>
      </div>
    );
  }

  const CallIcon = serviceCallNotification ? CALL_ICON[serviceCallNotification.call_type] ?? Bell : Bell;

  return (
    <div className="flex flex-col md:flex-row bg-background w-full flex-1 mx-auto overflow-hidden h-[100dvh]">
      {/* Global New Order Notification */}
      {newOrderNotification && (
        <Card role="alert" className="fixed top-16 md:top-4 left-4 right-4 md:left-auto md:right-4 z-[100] md:w-96 border-primary/40 shadow-[var(--shadow-medium)] animate-in fade-in slide-in-from-top-4 duration-300">
          <CardHeader className="p-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                  <Bell className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold tracking-normal">New order</CardTitle>
                  <p className="font-display text-xl leading-tight">#{newOrderNotification.order_number}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={dismissNotification} className="h-9 w-9 -mr-1 -mt-1" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{locationLabel}</span>
                <Badge className="text-sm px-3 py-0.5 tabular-nums">{newOrderNotification.table_number}</Badge>
              </div>
              <div className="border-t pt-3 space-y-1 text-sm max-h-32 overflow-y-auto">
                {newOrderNotification.items?.items?.map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between gap-3">
                    <span className="truncate">{item.name} <span className="text-muted-foreground">×{item.quantity || 1}</span></span>
                    <span className="flex-shrink-0 tabular-nums">₹{(item.price * (item.quantity || 1)).toFixed(0)}</span>
                  </div>
                ))}
              </div>
              <Button
                onClick={() => {
                  handleTabChange("orders");
                  dismissNotification();
                }}
                className="w-full"
              >
                View order
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Global Service Call Notification */}
      {serviceCallNotification && (
        <Card role="alert" className={`fixed ${newOrderNotification ? 'top-[300px] md:top-[260px]' : 'top-16 md:top-4'} left-4 right-4 md:left-auto md:right-4 z-[99] md:w-96 border-primary/40 shadow-[var(--shadow-medium)] animate-in fade-in slide-in-from-top-4 duration-300`}>
          <div className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 bg-accent rounded-full flex items-center justify-center flex-shrink-0">
              <CallIcon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold">{CALL_LABEL[serviceCallNotification.call_type] ?? "Service"} request</p>
              <p className="text-sm text-muted-foreground">{locationLabel} <span className="font-semibold text-foreground tabular-nums">{serviceCallNotification.table_number}</span></p>
            </div>
            <Button variant="ghost" size="icon" onClick={dismissServiceCallNotification} className="h-9 w-9 -mr-1" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="px-4 pb-4">
            <Button
              onClick={() => {
                handleTabChange("service-calls");
                setServiceCallsCount(0);
                dismissServiceCallNotification();
              }}
              className="w-full"
            >
              View calls
            </Button>
          </div>
        </Card>
      )}

      <Sidebar open={open} setOpen={setOpen} animate={false}>
        <SidebarBody
          className="justify-between gap-4"
          mobileTitle={links.find(l => l.href === `#${navTab}`)?.label ?? "Dashboard"}
          mobileActions={
            <>
              <ShiftChip restaurantId={restaurantId} className="max-w-[9rem]" />
              <ThemeToggle />
            </>
          }
        >
          <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
            <Logo name={restaurantName} logo={restaurantLogo} />
            <ShiftChip restaurantId={restaurantId} className="hidden md:flex mt-4 w-full justify-start" />
            {(["service", "setup"] as const).map(g => (
            <div key={g} className="mt-4 flex flex-col gap-0.5">
              {g === "service" ? (
                <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">During service</p>
              ) : (
                <button type="button" onClick={toggleSetup} aria-expanded={setupOpen}
                  className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Set up & review
                  <ChevronDown className={cn("h-4 w-4 transition-transform", setupOpen && "rotate-180")} />
                </button>
              )}
              {links.filter(l => l.group === g && (g === "service" || setupOpen)).map((link) => {
                const active = link.href === `#${navTab}`;
                return (
                  <div key={link.href} className="relative" onClick={link.onClick}>
                    <SidebarLink
                      link={link}
                      className={cn(
                        "rounded-xl px-2.5 transition-colors",
                        active ? "bg-card text-foreground font-semibold ring-1 ring-border [&_svg]:text-primary" : "text-foreground/75 hover:bg-card/70 hover:text-foreground",
                      )}
                    />
                    {!!link.badge && (
                      <span className="absolute top-1/2 -translate-y-1/2 right-2 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold tabular-nums flex items-center justify-center">
                        {link.badge}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            ))}
          </div>
          <div className="space-y-0.5 pt-4 border-t border-border/70">
            <InstallAppButton className="w-full flex items-center justify-start gap-2 py-2 px-2.5 rounded-xl text-sm text-foreground/75 hover:bg-card/70 hover:text-foreground transition-colors">
              <Download className="h-5 w-5 flex-shrink-0" /> Install app
            </InstallAppButton>
            {/* Policy Links */}
            <Link
              to="/terms"
              className="flex items-center justify-start gap-2 py-2 px-2.5 rounded-xl text-sm text-foreground/75 hover:bg-card/70 hover:text-foreground transition-colors"
            >
              <FileText className="h-5 w-5 flex-shrink-0" />
              Terms & Policies
            </Link>

            <button
              type="button"
              onClick={() => {
                setOpen(false); // Close mobile sidebar
                const testOrder: Order = {
                  id: 'test-' + Date.now(),
                  order_number: 'TEST' + Date.now().toString().slice(-4),
                  table_number: '99',
                  items: {
                    items: [
                      { name: 'Test Burger', price: 150, quantity: 1 },
                      { name: 'Test Fries', price: 80, quantity: 2 }
                    ]
                  },
                  status: 'preparing',
                  created_at: new Date().toISOString(),
                  session_id: null
                };
                
                playPleasantNotificationSound();
                setNewOrderNotification(testOrder);
                
                toast({
                  title: "Testing the order alert",
                  description: "The alert beeps for 15 seconds. Close the card to stop it.",
                  duration: 3000,
                });
              }}
              className="w-full flex items-center justify-start gap-2 py-2 px-2.5 rounded-xl text-sm text-foreground/75 hover:bg-card/70 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Bell className="h-5 w-5 flex-shrink-0" />
              Test order alert
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false); // Close mobile sidebar
                handleSignOut();
              }}
              className="w-full flex items-center justify-start gap-2 py-2 px-2.5 rounded-xl text-sm text-foreground/75 hover:bg-card/70 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              Log out
            </button>
          </div>
        </SidebarBody>
      </Sidebar>

      <Dashboard 
        activeTab={activeTab} 
        restaurantId={restaurantId} 
        onNewOrder={handleNewOrder}
        newOrderTrigger={lastNewOrder}
        onNewServiceCall={handleNewServiceCall}
        onTabChange={handleTabChange}
      />

      {/* Phone: app-style tab bar for the pages used all day; "More" opens the full menu */}
      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {[
            { tab: "stats", label: "Home", Icon: BarChart3 },
            { tab: "orders", label: "Orders", Icon: Package, badge: newOrdersCount, onPick: () => setNewOrdersCount(0) },
            { tab: "floor", label: "Floor", Icon: LayoutGrid },
            { tab: "service-calls", label: "Calls", Icon: Bell, badge: serviceCallsCount, onPick: () => setServiceCallsCount(0) },
          ].map(({ tab, label, Icon, badge, onPick }) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => { handleTabChange(tab); onPick?.(); }}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", active ? "text-accent-foreground font-semibold" : "text-muted-foreground")}
              >
                <span className={cn("flex h-8 w-14 items-center justify-center rounded-full transition-colors", active && "bg-accent")}>
                  <Icon className="h-5 w-5" />
                </span>
                {label}
                {!!badge && (
                  <span className="absolute top-1.5 left-1/2 ml-2 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold tabular-nums flex items-center justify-center ring-2 ring-card">{badge}</span>
                )}
              </button>
            );
          })}
          <button type="button" onClick={() => setOpen(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground">
            <span className="flex h-8 w-14 items-center justify-center rounded-full"><MoreHorizontal className="h-5 w-5" /></span>
            More
          </button>
        </div>
      </nav>
    </div>
  );
};

const TABS = ["stats", "floor", "reports", "staff", "setup", "menu", "orders", "service-calls", "feedback", "social", "qr", "profile"];
// Sub-pages keep their own ?tab= id (so old links still work) but live under one sidebar item
const PARENT: Record<string, string> = { feedback: "reports", setup: "profile", social: "profile" };
const SUBTABS: Record<string, { tab: string; label: string }[]> = {
  reports: [{ tab: "reports", label: "Sales" }, { tab: "feedback", label: "Reviews" }],
  profile: [{ tab: "profile", label: "Restaurant" }, { tab: "setup", label: "Bills & extras" }, { tab: "social", label: "Social links" }],
};

const isDashboardDark = () => {
  const t = localStorage.getItem("dashboard-theme");
  return t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
};

// One-tap light/dark switch in the phone header. Settings > Appearance still has Light/Dark/System;
// both write localStorage "dashboard-theme" and fire "dashboard-theme" so they stay in sync.
const ThemeToggle = () => {
  const [dark, setDark] = useState(isDashboardDark);
  useEffect(() => {
    const sync = () => setDark(isDashboardDark());
    window.addEventListener("dashboard-theme", sync);
    return () => window.removeEventListener("dashboard-theme", sync);
  }, []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("dashboard-theme", next ? "dark" : "light");
    window.dispatchEvent(new Event("dashboard-theme"));
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="h-10 w-10 flex items-center justify-center rounded-full text-foreground active:bg-muted"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
};

const CALL_LABEL: Record<string, string> = { waiter: "Waiter", water: "Water", bill: "Bill", help: "Help", clean: "Clean the table" };
const CALL_ICON: Record<string, typeof Bell> = { waiter: User, water: Droplets, bill: FileText, help: LifeBuoy, clean: SprayCan };

const Logo = ({ name, logo }: { name: string; logo: string | null }) => {
  return (
    <div className="flex gap-2.5 items-center py-1 pl-1 pr-10 md:pr-0 relative z-20">
      {logo ? (
        <img src={logo} alt="" className="h-9 w-9 rounded-full flex-shrink-0 object-cover ring-1 ring-border" />
      ) : (
        <div className="h-9 w-9 bg-accent text-primary rounded-full flex-shrink-0 flex items-center justify-center font-display text-base" aria-hidden>
          {name.charAt(0)}
        </div>
      )}
      <span className="font-display text-lg leading-tight text-foreground truncate">{name}</span>
    </div>
  );
};

const Dashboard = ({ 
  activeTab, 
  restaurantId, 
  onNewOrder,
  newOrderTrigger,
  onNewServiceCall,
  onTabChange,
}: {
  activeTab: string;
  restaurantId: string;
  onNewOrder: (order: Order) => void;
  newOrderTrigger: Order | null;
  onNewServiceCall: (call: ServiceCall) => void;
  onTabChange: (tab: string) => void;
}) => {
  const subs = SUBTABS[PARENT[activeTab] ?? activeTab];
  return (
    <div className="flex flex-1 overflow-hidden md:pt-3">
      <main className="p-4 pb-28 md:p-8 lg:p-10 md:rounded-tl-[24px] md:border-l md:border-t border-border bg-card flex-1 w-full overflow-y-auto">
        {/* Centered content container with max-width */}
        <div className="max-w-6xl mx-auto w-full">
          <motion.div key={`top-${activeTab}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          {activeTab === "stats" && <StatsOverview restaurantId={restaurantId} />}
          {activeTab === "menu" && <MenuManagement restaurantId={restaurantId} />}
          </motion.div>
          
          {/* Always render OrderManagement to maintain realtime subscription */}
          <div style={{ display: activeTab === "orders" ? "block" : "none" }}>
            <OrderManagement 
              restaurantId={restaurantId}
              onNewOrder={onNewOrder}
              newOrderTrigger={newOrderTrigger}
              isVisible={activeTab === "orders"}
            />
          </div>
          
          {subs && (
            <nav aria-label="Section" className="mb-6 flex gap-2 overflow-x-auto [scrollbar-width:none]">
              {subs.map(s => (
                <button key={s.tab} type="button" onClick={() => onTabChange(s.tab)} aria-current={activeTab === s.tab ? "page" : undefined}
                  className={cn("h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeTab === s.tab ? "bg-foreground text-background" : "bg-muted text-foreground/75 hover:bg-muted/70")}>
                  {s.label}
                </button>
              ))}
            </nav>
          )}

          <motion.div key={`rest-${activeTab}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          {activeTab === "floor" && <FloorView restaurantId={restaurantId} />}
          {activeTab === "reports" && <ReportsView restaurantId={restaurantId} />}
          {activeTab === "staff" && <StaffView restaurantId={restaurantId} />}
          {activeTab === "setup" && <ServiceSetup restaurantId={restaurantId} />}
          {activeTab === "feedback" && <FeedbackView restaurantId={restaurantId} />}
          {activeTab === "service-calls" && <ServiceCallsPanel restaurantId={restaurantId} onNewCall={(call) => onNewServiceCall(call as ServiceCall)} />}
          {activeTab === "social" && <SocialLinksForm restaurantId={restaurantId} />}
          {activeTab === "qr" && <QRCodeDisplay restaurantId={restaurantId} />}
          {activeTab === "profile" && <RestaurantProfile restaurantId={restaurantId} />}
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default DashboardWithSidebar;
