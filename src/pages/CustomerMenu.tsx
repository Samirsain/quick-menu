import { useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Minus, X, Search, Moon, Sun, Clock, ArrowRight, ArrowLeft, ChevronRight, Receipt, MoreVertical, ShoppingBag, Leaf,
  Instagram, Facebook, Twitter, Globe, Loader2, Star, CupSoda, IceCreamCone, ConciergeBell, Salad, Pizza, Croissant, UtensilsCrossed, Trash2,
  Sparkles, ArrowUpRight
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { isRateLimited, RATE_LIMITS, isValidTableNumber, sanitizeInput, getClientFingerprint } from "@/lib/security";
import { registerReconnectCallback, unregisterReconnectCallback } from "@/lib/realtimeOptimization";
import { VegMark, BestsellerBadge, ChefPickBadge } from "@/components/FoodBadges";
import { useTableSeat } from "@/hooks/useTableSeat";
import { errorCopy, joinErrorCopy, notifyStaff, type CartLine, type JoinResult, type SeatOrder } from "@/lib/tableService";
import BillSheet from "@/components/guest/BillSheet";
import WaiterCall from "@/components/guest/WaiterCall";
import WaitPanel from "@/components/guest/WaitPanel";
import { EASE, SHEET, prefersReducedMotion, CloseButton, SheetHeader, PrimaryButton, SecondaryButton, DrawnCheck, Stepper, inputClass } from "@/components/guest/ui";
import { celebrate } from "@/lib/celebrate";
import { sizedImage } from "@/lib/imageUpload";
import { DishPhoto } from "@/components/DishPhoto";
import CountUp from "@/components/CountUp";
import { useBusinessType } from "@/hooks/useBusinessType";
import { isZenCafe, getMockRestaurant, getMockCategories, getMockMenuItems } from "@/data/mockRestaurants";

gsap.registerPlugin(ScrollTrigger);

// Footer entrance: each part rises in after the one before it
const FOOT_RISE = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } };

const CustomerMenu = () => {
  const { restaurantId } = useParams();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { locationLabel, locationLabelLower } = useBusinessType(restaurantId || null);
  const [cart, setCart] = useState<any[]>([]);
  // Pre-fill table number from QR URL param (per-table QR mode)
  const [tableNumber, setTableNumber] = useState(() => searchParams.get("table") || "");
  const tableFromQR = searchParams.get("table"); // locked if came from per-table QR
  const [showOrderConfirmation, setShowOrderConfirmation] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false); // Track if user dismissed feedback
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [reviewStep, setReviewStep] = useState<"rate" | "google">("rate");
  const [commentCopied, setCommentCopied] = useState(false);
  // The table: seating, live orders, bill, calls (src/hooks/useTableSeat.ts)
  const seat = useTableSeat(restaurantId, (e) => toast({ title: "An order couldn't be sent", description: errorCopy(e), variant: "destructive" }));
  const activeOrders: SeatOrder[] = useMemo(() => seat.state?.orders ?? [], [seat.state?.orders]);
  const currentOrder = activeOrders.filter(o => !["rejected", "cancelled"].includes(o.status)).pop() ?? null;
  const [orderNote, setOrderNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCartDialog, setShowCartDialog] = useState(false);
  const [showOrderStatusDialog, setShowOrderStatusDialog] = useState(false);
  const [showBill, setShowBill] = useState(false);
  // Splash shows the restaurant name while it loads: at least 0.7s so it doesn't flash, never longer than loading needs
  const [splashMinDone, setSplashMinDone] = useState(false);
  // Review popup replaces any open dialog so it is never hidden behind the cart/order sheets
  const openFeedback = () => {
    setShowCartDialog(false);
    setShowOrderConfirmation(false);
    setShowOrderStatusDialog(false);
    setShowBill(false);
    setShowFeedback(true);
  };
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('customer-menu-theme') === 'dark');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [vegOnly, setVegOnly] = useState(false);
  const [serviceDisabled, setServiceDisabled] = useState(false);
  const [restaurantContact, setRestaurantContact] = useState<{ name: string } | null>(null);
  const [imageLoaded, setImageLoaded] = useState<Record<string, boolean>>({});
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const feedbackDismissedRef = useRef(false); // Ref for realtime callback access
  
  // Session management
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [remainingMinutes, setRemainingMinutes] = useState<number | null>(null);
  const sessionActivityRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get session ID from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const menuSessionId = urlParams.get('session');
  
  
  // Validate session on load and periodically
  useEffect(() => {
    if (!menuSessionId) {
      // No session - allow access for backward compatibility but show warning
      if (import.meta.env.DEV) console.log("⚠️ No session ID - direct access");
      return;
    }

    const validateSession = async () => {
      try {
        const { data, error } = await supabase.rpc("validate_menu_session", {
          p_session_id: menuSessionId,
        });

        if (error) {
          console.error("Session validation error:", error);
          return;
        }

        const result = data?.[0];
        if (!result) return;

        if (!result.is_valid) {
          setSessionExpired(true);
          setSessionError(result.error_message || "Session expired");
        } else {
          setRemainingMinutes(result.remaining_minutes);
        }
      } catch (err) {
        console.error("Session check failed:", err);
      }
    };

    // Validate immediately
    validateSession();

    // Validate every 2 minutes to update activity and check expiry
    sessionActivityRef.current = setInterval(validateSession, 2 * 60 * 1000);

    return () => {
      if (sessionActivityRef.current) {
        clearInterval(sessionActivityRef.current);
      }
    };
  }, [menuSessionId]);

  const formatINR = useCallback((value: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0)), []);

  // Production-optimized queries with proper cache management
  const { data: restaurant, isLoading: isLoadingRestaurant } = useQuery({
    queryKey: ['restaurant', restaurantId],
    queryFn: async () => {
      if (isZenCafe(restaurantId)) {
        return getMockRestaurant(restaurantId);
      }

      try {
        const { data, error } = await (supabase
          .from("restaurants") as any)
          .select("social_links, name, description, logo_url, cover_url, is_active, orders_enabled, waiter_call_enabled, upi_id")
          .eq("id", restaurantId)
          .single();
        
        if (error) throw error;
        
        if (data && !data.is_active) {
          setServiceDisabled(true);
          setRestaurantContact({ name: data.name });
        }
        
        return data;
      } catch (err) {
        if (isZenCafe(restaurantId)) {
          return getMockRestaurant(restaurantId);
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: !!restaurantId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const showSplash = !splashMinDone || isLoadingRestaurant;
  const ordersEnabled = restaurant?.orders_enabled !== false;
  const waiterCallEnabled = restaurant?.waiter_call_enabled !== false;
  const googleReviewRaw = (restaurant?.social_links as any)?.google_review;
  const googleReviewUrl: string | null = typeof googleReviewRaw === "string" && /^https:\/\//i.test(googleReviewRaw) ? googleReviewRaw : null;
  const upiId: string | null = restaurant?.upi_id || null;
  // What the table owes, from the live bill (discount, service charge and GST included)
  const billTotal = seat.state?.bill.total ?? 0;

  const { data: menuItems = [], isLoading: isLoadingItems } = useQuery({
    queryKey: ['menuItems', restaurantId],
    queryFn: async () => {
      if (isZenCafe(restaurantId)) {
        return getMockMenuItems(restaurantId);
      }

      try {
        const { data, error } = await (supabase
          .from("menu_items") as any)
          .select("id, restaurant_id, name, description, price, image_url, is_available, category_id, has_size_variants, size_variants, is_veg, is_bestseller, prep_minutes, addons, is_chef_special")
          .eq("restaurant_id", restaurantId)
          .eq("is_available", true) // Only fetch available items for customers
          .order("created_at", { ascending: true });
        
        if (error) throw error;
        return data || [];
      } catch (err) {
        if (isZenCafe(restaurantId)) {
          return getMockMenuItems(restaurantId);
        }
        throw err;
      }
    },
    staleTime: 3 * 60 * 1000, // 3 minutes - shorter for menu items
    gcTime: 30 * 60 * 1000,
    enabled: !!restaurantId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
    queryKey: ['categories', restaurantId],
    queryFn: async () => {
      if (isZenCafe(restaurantId)) {
        return getMockCategories(restaurantId);
      }

      try {
        const { data, error } = await supabase
          .from("menu_categories")
          .select("id, restaurant_id, name, display_order")
          .eq("restaurant_id", restaurantId)
          .order("display_order", { ascending: true });
        
        if (error) throw error;
        return data || [];
      } catch (err) {
        if (isZenCafe(restaurantId)) {
          return getMockCategories(restaurantId);
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: !!restaurantId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const isLoading = isLoadingRestaurant || isLoadingItems || isLoadingCategories;

  const incrementViewMutation = useMutation({
    mutationFn: async () => {
      const { data: currentViews } = await supabase.from("menu_views").select("view_count").eq("restaurant_id", restaurantId).single();
      if (currentViews) {
        await supabase.from("menu_views").update({ view_count: currentViews.view_count + 1 }).eq("restaurant_id", restaurantId);
      }
    },
  });

  // Night mode uses the warm night palette from index.css (.dark), never pure black
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('customer-menu-theme', isDarkMode ? 'dark' : 'light');
    // Night mode belongs to the menu only: don't let it leak into the dashboard/landing after navigating away
    return () => document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  // Guest look (slate palette + Geist, see .guest in index.css) only while the menu is open
  useEffect(() => {
    document.documentElement.classList.add('guest');
    return () => document.documentElement.classList.remove('guest');
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSplashMinDone(true), 700);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (restaurantId && !seat.api?.demo) incrementViewMutation.mutate(); // the demo has no database row to count
  }, [restaurantId]);

  // The table number follows the seat (set by the first order)
  useEffect(() => {
    if (seat.seat?.table && !tableFromQR) setTableNumber(seat.seat.table);
  }, [seat.seat?.table, tableFromQR]);

  // Tell the guest when an order moves, and ask for a rating once everything has been served
  const lastStatuses = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    const orders = seat.state?.orders;
    if (!orders) return;
    const prev = lastStatuses.current;
    if (prev) {
      for (const o of orders) {
        if (!prev[o.id] || prev[o.id] === o.status) continue;
        const no = `#${o.order_number.replace(/^ORD0*/, "")}`;
        if (o.status === "accepted") toast({ title: "Order confirmed", description: `The kitchen has order ${no}.`, duration: 5000 });
        else if (o.status === "preparing") toast({ title: "Being prepared", description: `The kitchen has started on order ${no}.`, duration: 5000 });
        else if (o.status === "ready") {
          navigator.vibrate?.([200, 100, 200]);
          toast({ title: "Your food is ready", description: `Order ${no} is on its way to your ${locationLabelLower}.`, duration: 8000 });
        } else if (o.status === "rejected") {
          navigator.vibrate?.([300, 100, 300]);
          toast({ title: "Order not accepted", description: `Order ${no} was declined. Please ask a member of staff.`, variant: "destructive", duration: 10000 });
        }
      }
    }
    lastStatuses.current = Object.fromEntries(orders.map(o => [o.id, o.status]));
    const served = orders.some(o => o.status === "completed") && orders.every(o => ["completed", "rejected", "cancelled"].includes(o.status));
    if (prev && served && !feedbackDismissedRef.current && !reviewed && !orders.some(o => localStorage.getItem(`feedback_submitted_${o.id}`))) {
      feedbackDismissedRef.current = true;
      setFeedbackDismissed(true);
      setTimeout(openFeedback, 900);
    }
  }, [seat.state?.orders]);

  // Cart functions - now with size variant support
  // Cart key is itemId + selectedSize to allow same item with different sizes
  const getCartItemKey = (itemId: string, selectedSize?: string) => selectedSize ? `${itemId}_${selectedSize}` : itemId;
  
  const lineKey = (i: any) => i.cartKey ?? getCartItemKey(i.id, i.selectedSize);
  const getCartItemQuantity = useCallback((itemId: string, selectedSize?: string) =>
    cart.filter(i => i.id === itemId && (i.selectedSize || undefined) === (selectedSize || undefined)).reduce((s, i) => s + (i.quantity || 1), 0), [cart]);

  // Get total quantity for an item (all sizes combined)
  const getTotalItemQuantity = useCallback((itemId: string) => {
    return cart.filter(i => i.id === itemId).reduce((sum, i) => sum + (i.quantity || 1), 0);
  }, [cart]);
  
  // A dish with add-ons or a note is its own cart line: "Paneer Tikka · Extra cheese" and plain "Paneer Tikka" don't merge
  const addToCart = useCallback((item: any, selectedSize?: { name: string; price: number }, extras?: { addons: { name: string; price: number }[]; note: string; qty?: number }) => {
    setCart(prev => {
      const addons = extras?.addons ?? [];
      const note = (extras?.note ?? "").trim().slice(0, 120);
      const base = getCartItemKey(item.id, selectedSize?.name);
      const cartKey = addons.length || note ? `${base}::${addons.map(a => a.name).sort().join("+")}::${note}` : base;
      const qty = extras?.qty ?? 1;
      const existing = prev.find(i => lineKey(i) === cartKey);
      if (existing) return prev.map(i => (i === existing ? { ...i, quantity: (i.quantity || 1) + qty } : i));
      return [...prev, {
        ...item, cartKey, quantity: qty, selectedSize: selectedSize?.name, addons: addons.map(a => a.name), note,
        displayPrice: (selectedSize?.price ?? item.price) + addons.reduce((s, a) => s + Number(a.price), 0),
      }];
    });
  }, []);

  const updateQuantity = useCallback((itemId: string, delta: number, selectedSize?: string) => {
    const cartKey = getCartItemKey(itemId, selectedSize);
    setCart(prev => prev.map(item => (lineKey(item) === cartKey ? { ...item, quantity: (item.quantity || 1) + delta } : item))
      .filter(item => (item.quantity || 0) > 0));
  }, []);

  const updateLine = useCallback((cartKey: string, delta: number) => {
    setCart(prev => prev.map(item => (lineKey(item) === cartKey ? { ...item, quantity: (item.quantity || 1) + delta } : item))
      .filter(item => (item.quantity || 0) > 0));
  }, []);

  const removeFromCart = useCallback((itemId: string, selectedSize?: string) => {
    const cartKey = getCartItemKey(itemId, selectedSize);
    setCart(prev => prev.filter(item => getCartItemKey(item.id, item.selectedSize) !== cartKey));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);


  const placeOrder = async () => {
    if (isPlacingOrder) return; // one tap, one order
    const table = (seat.seat?.table || tableNumber).trim();
    if (!table || cart.length === 0) {
      toast({ title: "Missing information", description: `Please enter ${locationLabelLower} number and add items`, variant: "destructive" });
      return;
    }
    if (!isValidTableNumber(table)) {
      toast({ title: `Invalid ${locationLabelLower} number`, description: `${locationLabel} number must be alphanumeric (max 10 chars)`, variant: "destructive" });
      return;
    }
    if (isRateLimited(`order_${getClientFingerprint()}`, RATE_LIMITS.order)) {
      toast({ title: "Too many orders", description: "Please wait before placing another order", variant: "destructive" });
      return;
    }

    setIsPlacingOrder(true);
    try {
      const lines: CartLine[] = cart.map(i => ({ id: i.id, qty: i.quantity || 1, size: i.selectedSize || null, addons: i.addons || [], note: i.note || "" }));
      const { order, queued } = await seat.placeOrder(table, lines, orderNote.trim() || null);
      setCart([]);
      setOrderNote("");
      setShowCartDialog(false);
      if (queued || !order) {
        toast({ title: "Saved while you're offline", description: "It goes to the kitchen as soon as your phone is back online.", duration: 8000 });
        return;
      }
      setOrderNumber(order.order_number.replace(/^ORD0*/, ""));
      setShowOrderConfirmation(true);
      celebrate();
    } catch (err) {
      const join = err as JoinResult;
      toast({
        title: "Order not sent",
        description: join && join.ok === false ? joinErrorCopy(join, table, locationLabel) : errorCopy(err),
        variant: "destructive",
      });
    } finally {
      setIsPlacingOrder(false);
    }
  };

  // Put an order's dishes back in the cart: "Order again", or "Change" on an order the kitchen hasn't accepted yet
  const toCart = (o: SeatOrder, keepNotes: boolean) => {
    const missing: string[] = [];
    for (const l of o.items?.items || []) {
      const m: any = menuItems.find((x: any) => x.id === l.id);
      if (!m) { missing.push(l.name); continue; }
      const parts = (l.options || "").split(" · ").filter(Boolean);
      const addons = (m.addons || []).filter((a: { name: string }) => parts.includes(a.name));
      const note = keepNotes ? parts.filter(x => !addons.some((a: { name: string }) => a.name === x)).join(" · ") : "";
      const size = l.selectedSize ? m.size_variants?.find((v: { name: string }) => v.name === l.selectedSize) : undefined;
      addToCart(m, size, { addons, note, qty: l.quantity || 1 });
    }
    return missing;
  };
  const orderAgain = (o: SeatOrder) => {
    const missing = toCart(o, false);
    setShowBill(false);
    setShowOrderStatusDialog(false);
    setShowCartDialog(true);
    if (missing.length) toast({ title: "Some dishes aren't available", description: `${missing.join(", ")} can't be ordered right now.` });
  };
  const changeOrder = async (o: SeatOrder) => {
    try {
      await seat.cancelOrder(o.id);
      toCart(o, true);
      setOrderNote(o.items?.note || "");
      setShowBill(false);
      setShowOrderStatusDialog(false);
      setShowCartDialog(true);
      toast({ title: "Order taken back", description: "Change it in your cart and send it again." });
    } catch (e) {
      toast({ title: "Can't change this order", description: errorCopy(e), variant: "destructive" });
    }
  };

  const submitFeedback = async () => {
    if (!currentOrder?.id) return;
    if (isRateLimited(`feedback_${getClientFingerprint()}`, RATE_LIMITS.feedback)) {
      toast({ title: "Too many submissions", description: "Please wait", variant: "destructive" });
      return;
    }
    if (!seat.api?.demo) {
      // The id is made here because guests can't read feedback back; a 1-2 star rating pings the owner's phone
      const id = crypto.randomUUID();
      const { error } = await supabase.from("feedback").insert([{ id, order_id: currentOrder.id, restaurant_id: restaurantId, rating, comment: sanitizeInput(comment.trim()) || null }]);
      if (!error && rating <= 2) notifyStaff("feedback", id);
    }
    localStorage.setItem(`feedback_submitted_${currentOrder.id}`, 'true');
    setReviewed(true);
    // Every rating (not just good ones) gets the Google ask - filtering by rating is "review gating", which Google bans
    if (googleReviewUrl) {
      if (comment.trim()) {
        navigator.clipboard?.writeText(comment.trim()).then(() => setCommentCopied(true)).catch(() => {});
      }
      setReviewStep("google");
      return;
    }
    toast({ title: servedBy ? `Thank you, from ${servedBy}` : "Thank you", description: "Your feedback went straight to the team.", duration: 4000 });
    setShowFeedback(false);
    setRating(0);
    setComment("");
    // Keep activeOrders and currentOrder - user can still view history for 90 mins
  };

  // Skip feedback - just close dialog without clearing orders
  const skipFeedback = () => {
    setShowFeedback(false);
    setFeedbackDismissed(true); // Don't show feedback again this session
    feedbackDismissedRef.current = true; // Also update ref for realtime callback
    setRating(0);
    setComment("");
    setReviewStep("rate");
    setCommentCopied(false);
    // Orders remain visible in history for 90 mins
  };

  const servedBy = seat.state?.served_by || null;

  // Memoized data - filter out unavailable items
  const availableMenuItems = useMemo(
    () => menuItems.filter(item => item.is_available && (!vegOnly || item.is_veg !== false)),
    [menuItems, vegOnly]
  );
  // Only offer the Veg filter when the menu actually mixes veg and non-veg
  const showVegFilter = useMemo(
    () => menuItems.some(i => i.is_veg === true) && menuItems.some(i => i.is_veg === false),
    [menuItems]
  );

  const groupedItems = useMemo(() => categories.reduce((acc, cat) => {
    acc[cat.id] = availableMenuItems.filter(item => item.category_id === cat.id);
    return acc;
  }, {} as Record<string, any[]>), [categories, availableMenuItems]);

  const uncategorizedItems = useMemo(() => availableMenuItems.filter(item => !item.category_id), [availableMenuItems]);

  // Filter items based on selected category
  const displayedCategories = useMemo(() => {
    const catsWithItems = categories.filter(c => groupedItems[c.id]?.length > 0);
    if (selectedCategory) {
      return catsWithItems.filter(c => c.id === selectedCategory);
    }
    return catsWithItems;
  }, [categories, groupedItems, selectedCategory]);

  const searchResults = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return availableMenuItems.filter(item => item.name.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q));
  }, [availableMenuItems, searchQuery]);

  const totalPrice = useMemo(() => cart.reduce((sum, item) => sum + ((item.displayPrice ?? item.price) * (item.quantity || 1)), 0), [cart]);
  const totalItems = useMemo(() => cart.reduce((sum, item) => sum + (item.quantity || 1), 0), [cart]);

  const handleCategoryClick = (categoryId: string | null) => {
    setSelectedCategory(categoryId);
    setSearchQuery("");
  };

  // ---- Motion (GSAP). Hooks live above the early returns so hook order never changes.
  const heroRef = useRef<HTMLElement>(null);
  const heroImgRef = useRef<HTMLImageElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [heroVisible, setHeroVisible] = useState(true);

  // Hero: image settles in, text staggers up, image drifts slower than the page (parallax)
  useLayoutEffect(() => {
    if (showSplash || !heroRef.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(heroImgRef.current, { scale: 1.12, duration: 1.6, ease: "power2.out" });
      gsap.from("[data-hero]", { y: 26, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.08, delay: 0.1 });
      gsap.to(heroImgRef.current, {
        yPercent: 12,
        ease: "none",
        scrollTrigger: { trigger: heroRef.current, start: "top top", end: "bottom top", scrub: true },
      });
    }, heroRef);
    return () => ctx.revert();
  }, [showSplash]);

  // Section headers and dish cards fade + slide up as they scroll in; photos scale down into place
  useLayoutEffect(() => {
    if (showSplash || isLoadingItems || !listRef.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.set("[data-reveal]", { opacity: 0, y: 22 });
      ScrollTrigger.batch("[data-reveal]", {
        start: "top 94%",
        once: true,
        onEnter: (els) => {
          gsap.to(els, { opacity: 1, y: 0, duration: 0.75, ease: "power3.out", stagger: 0.07, overwrite: true });
          const imgs = els.map(el => el.querySelector("[data-reveal-img]")).filter(Boolean);
          if (imgs.length) gsap.fromTo(imgs, { scale: 1.18 }, { scale: 1, duration: 1.1, ease: "power3.out", stagger: 0.07 });
        },
      });
    }, listRef);
    return () => ctx.revert();
  }, [showSplash, isLoadingItems, displayedCategories, searchQuery]);

  // Compact header slides in once the hero has scrolled away
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { rootMargin: "-120px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [showSplash]);

  // Splash Screen
  if (showSplash) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-menu-bg">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE }} className="text-center px-8">
          {restaurant?.logo_url ? (
            <img src={restaurant.logo_url} alt="" className="w-16 h-16 mx-auto mb-6 rounded-full object-cover ring-1 ring-menu-line" />
          ) : (
            <span className="mx-auto mb-6 h-16 w-16 rounded-full bg-menu-tint text-menu-accent flex items-center justify-center"><Leaf className="h-7 w-7" strokeWidth={1.5} /></span>
          )}
          <h1 className="font-display text-4xl tracking-tight text-menu-ink">{restaurant?.name || "Menu"}</h1>
          <div className="relative h-px w-24 mx-auto mt-8 overflow-hidden bg-menu-line">
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-y-0 w-1/2 bg-menu-accent"
            />
          </div>
        </motion.div>
      </div>
    );
  }

  // Service Disabled / Session Expired share one calm layout
  const blocked = serviceDisabled && restaurantContact
    ? { title: "Menu unavailable", body: `${restaurantContact.name}'s menu is currently unavailable.` }
    : sessionExpired
      ? { title: "Session ended", body: sessionError || "Your menu session has ended. Scan the QR code on your table to start again." }
      : null;

  if (blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-menu-bg text-menu-ink p-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="max-w-sm text-center">
          <div className="w-12 h-12 mx-auto mb-6 rounded-full bg-menu-tint text-menu-accent flex items-center justify-center">
            <Clock className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <h1 className="font-display text-3xl tracking-tight">{blocked.title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-menu-muted">{blocked.body}</p>
        </motion.div>
      </div>
    );
  }

  const restaurantName = restaurant?.name || "Menu";
  const social = (restaurant?.social_links || {}) as Record<string, string | undefined>;
  const socialLinks = [
    { key: "instagram", Icon: Instagram, label: "Instagram" },
    { key: "facebook", Icon: Facebook, label: "Facebook" },
    { key: "twitter", Icon: Twitter, label: "Twitter" },
    { key: "website", Icon: Globe, label: "Website" },
  ].filter(s => typeof social[s.key] === "string" && /^https:\/\//i.test(social[s.key]!));
  const status = overallStatus(activeOrders);
  const itemCount = activeOrders.reduce((sum, o) => sum + (o.items?.items?.reduce((s: number, i: { quantity?: number }) => s + (i.quantity || 1), 0) || 0), 0);
  const allSettled = activeOrders.length > 0 && activeOrders.every(o => ["completed", "rejected", "cancelled"].includes(o.status));
  const tabs = [{ id: null as string | null, name: "All" }, ...categories.filter(c => groupedItems[c.id]?.length > 0).map(c => ({ id: c.id as string | null, name: c.name as string }))];
  const canGoBack = window.history.length > 1;
  const cardProps = { onAdd: addToCart, onUpdate: updateQuantity, formatINR, getCartQtyBySize: getCartItemQuantity, ordersEnabled };
  const openSearch = () => { setIsSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 100); };
  const selectCategory = (id: string | null) => {
    handleCategoryClick(id);
    // Land at the top of the menu sheet, not the top of the page
    const top = (heroRef.current?.offsetHeight ?? 0) - 120;
    if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
  };

  const pills = (tone: "dark" | "light") => (
    <CategoryPills
      tone={tone}
      tabs={tabs}
      isSelected={(id) => (id === null ? selectedCategory === null && !searchQuery : selectedCategory === id)}
      onSelect={selectCategory}
      showVeg={showVegFilter}
      vegOnly={vegOnly}
      onToggleVeg={() => setVegOnly(v => !v)}
    />
  );

  const moreMenu = (tone: "dark" | "light") => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="More options" className={tone === "dark" ? GLASS : GHOST}>
          <MoreVertical className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-2xl border-menu-line bg-menu-card text-menu-ink p-1.5">
        <DropdownMenuItem onClick={() => setIsDarkMode(!isDarkMode)} className="rounded-xl gap-2.5 py-2.5">
          {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{isDarkMode ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        {activeOrders.length > 0 && (
          <DropdownMenuItem onClick={() => setShowBill(true)} className="rounded-xl gap-2.5 py-2.5">
            <Receipt className="h-4 w-4" />Bill & payment
          </DropdownMenuItem>
        )}
        {googleReviewUrl && (
          <DropdownMenuItem onClick={() => window.open(googleReviewUrl, "_blank", "noopener,noreferrer")} className="rounded-xl gap-2.5 py-2.5">
            <Star className="h-4 w-4" />Review us on Google
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Cart items list (reusable for modal and desktop sidebar)
  const cartItemsList = (
    <div className="divide-y divide-menu-line/80">
      {cart.map((item) => {
        const cartKey = lineKey(item);
        const itemPrice = item.displayPrice ?? item.price;
        const extras = [item.selectedSize, ...(item.addons || []), item.note].filter(Boolean).join(" · ");
        return (
          <motion.div key={cartKey} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-3 flex items-center gap-3">
            {item.image_url && (
              <img
                src={sizedImage(item.image_url, 144)}
                alt=""
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
                onError={(e) => { e.currentTarget.src = "/placeholder.svg"; }}
                className="h-12 w-12 rounded-xl object-cover flex-shrink-0 bg-menu-tint"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-display text-[15px] leading-snug truncate">{item.name}</p>
              <p className="text-xs text-menu-muted mt-0.5 truncate">{extras && <span>{extras} · </span>}{formatINR(itemPrice)}</p>
            </div>
            <QtyPill qty={item.quantity || 1} onMinus={() => updateLine(cartKey, -1)} onPlus={() => updateLine(cartKey, 1)} small />
          </motion.div>
        );
      })}
    </div>
  );

  const tableLocked = !!tableFromQR;
  // Cart checkout section (pinned total, table input, and place order button)
  const cartCheckoutSection = (
    <>
      <div className="flex justify-between items-baseline">
        <span className="text-sm text-menu-muted font-medium">Total</span>
        <span className="font-display text-[26px] font-semibold tabular-nums text-menu-ink">{formatINR(totalPrice)}</span>
      </div>
      {tableLocked ? (
        // The QR already told us the table: one quiet line instead of a form field
        <p className="text-sm text-menu-muted">For <span className="font-semibold text-menu-ink">{locationLabel} {tableNumber}</span></p>
      ) : (
      <div className="bg-menu-bg/80 p-3 rounded-2xl border border-menu-line/80">
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="table-no-input" className="text-xs font-semibold uppercase tracking-wider text-menu-ink flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-menu-accent inline-block" />
            {locationLabel} Number
          </label>
          {!tableNumber && <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Table number required</span>}
        </div>
        <input
          id="table-no-input"
          value={tableNumber}
          onChange={(e) => setTableNumber(e.target.value)}
          placeholder={`Enter ${locationLabelLower} number (e.g. 4)`}
          className="w-full h-11 px-4 rounded-xl border border-menu-line bg-menu-card text-[15px] font-medium text-menu-ink outline-none focus:border-menu-accent focus:ring-1 focus:ring-menu-accent transition-colors"
        />
      </div>
      )}
      <input id="order-note" aria-label="Note for the kitchen" maxLength={200} value={orderNote} onChange={(e) => setOrderNote(e.target.value)}
        placeholder="Note for the kitchen (optional)" className={`${inputClass} text-[14px]`} />
      <PrimaryButton onClick={placeOrder} disabled={!tableNumber || cart.length === 0 || isPlacingOrder} className="w-full h-12 text-[15px] font-semibold">
        {isPlacingOrder ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending to the kitchen</> : <>Place order · {formatINR(totalPrice)}</>}
      </PrimaryButton>
    </>
  );

  // Items + total + table + place order for desktop sidebar
  const orderSummary = (
    <>
      {cart.length === 0 ? (
        <p className="py-8 text-center text-sm text-menu-muted">Add a dish to start your order.</p>
      ) : (
        <>
          <div className="max-h-[42vh] overflow-y-auto pr-1">
            {cartItemsList}
          </div>
          <div className="pt-4 mt-2 border-t border-menu-line space-y-4">
            {cartCheckoutSection}
          </div>
        </>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-menu-bg text-menu-ink antialiased">
      {/* Compact header: appears once the hero is scrolled away, or while searching */}
      <AnimatePresence>
        {(!heroVisible || isSearchOpen) && (
          <motion.header
            initial={{ y: "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={{ duration: 0.45, ease: EASE }}
            className="fixed top-0 inset-x-0 z-50 bg-menu-bg/85 backdrop-blur-xl border-b border-menu-line/80"
          >
            <div className="max-w-6xl mx-auto px-4 lg:px-8">
              <div className="h-14 flex items-center gap-3">
                {isSearchOpen ? (
                  <>
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-menu-muted" strokeWidth={1.75} />
                      <input
                        ref={searchInputRef}
                        type="search"
                        placeholder="Search dishes"
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setSelectedCategory(null); }}
                        className="w-full h-10 pl-10 pr-4 rounded-full bg-menu-card border border-menu-line text-[15px] placeholder:text-menu-muted outline-none focus:border-menu-accent/60 transition-colors"
                        autoFocus
                      />
                    </div>
                    <button onClick={() => { setIsSearchOpen(false); setSearchQuery(""); }} className="h-10 px-1 text-sm font-medium text-menu-accent">Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 flex items-center gap-2.5">
                      {restaurant?.logo_url && <img src={restaurant.logo_url} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-menu-line flex-shrink-0" />}
                      <span className="font-display text-lg truncate">{restaurantName}</span>
                    </span>
                    <button onClick={openSearch} aria-label="Search" className={GHOST}><Search className="h-[18px] w-[18px]" strokeWidth={1.75} /></button>
                    {waiterCallEnabled && <WaiterCall seat={seat} tableNumber={tableNumber} locationLabel={locationLabel} triggerClassName={GHOST} onOpenBill={() => setShowBill(true)} />}
                    {moreMenu("light")}
                  </>
                )}
              </div>
              {!isSearchOpen && <div className="pb-3">{pills("light")}</div>}
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* Hero */}
      <section ref={heroRef} className="relative overflow-hidden bg-menu-hero">
        {/* The browser picks the smallest cover that fills the screen; object-cover fills the hero without stretching.
            One <img> whose src changes (never swapped), so the GSAP parallax stays attached to it. */}
        <img
          ref={heroImgRef}
          src={restaurant?.cover_url ? sizedImage(restaurant.cover_url, 1400) : DEFAULT_COVER}
          srcSet={restaurant?.cover_url ? [800, 1400, 2200].map(w => `${sizedImage(restaurant.cover_url, w)} ${w}w`).join(", ") : undefined}
          sizes="100vw"
          alt=""
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onError={(e) => { e.currentTarget.src = DEFAULT_COVER; e.currentTarget.removeAttribute("srcset"); }}
          className={`absolute inset-x-0 top-0 h-[115%] w-full object-cover ${restaurant?.cover_url ? "object-center" : "object-[center_75%]"}`}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/30 to-black/85" />
        <div className="relative max-w-6xl mx-auto px-4 lg:px-8">
          <div className="h-16 flex items-center justify-between">
            {canGoBack ? (
              <button onClick={() => window.history.back()} aria-label="Back" className={GLASS}><ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2} /></button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button onClick={openSearch} aria-label="Search" className={GLASS}><Search className="h-[18px] w-[18px]" strokeWidth={2} /></button>
              {waiterCallEnabled && <WaiterCall seat={seat} tableNumber={tableNumber} locationLabel={locationLabel} triggerClassName={GLASS} onOpenBill={() => setShowBill(true)} />}
              {moreMenu("dark")}
            </div>
          </div>
          <div className="pt-20 sm:pt-24 lg:pt-36 pb-12">
            {tableNumber && (
              <p data-hero className="inline-flex items-center h-7 px-3 rounded-full bg-white/15 ring-1 ring-white/20 backdrop-blur-md text-[13px] font-medium text-white">
                {locationLabel} {tableNumber}
              </p>
            )}
            <div data-hero className="mt-3 flex items-center gap-3">
              {restaurant?.logo_url && (
                <img src={restaurant.logo_url} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-white/25 flex-shrink-0" />
              )}
              <h1 className="font-display text-[40px] sm:text-[52px] lg:text-[68px] leading-[1.02] tracking-[-0.02em] text-[#FBF4EA] [text-wrap:balance]">{restaurantName}</h1>
            </div>
            {restaurant?.description && (
              <p data-hero className="mt-2 max-w-lg text-[15px] leading-relaxed text-white/75">{restaurant.description}</p>
            )}
            <div data-hero className="mt-7">{pills("dark")}</div>
          </div>
        </div>
      </section>

      {/* Menu sheet, overlapping the hero */}
      <div className="relative z-10 -mt-7 rounded-t-[28px] bg-menu-bg">
        <div
          ref={listRef}
          className={`max-w-6xl mx-auto px-4 lg:px-8 pt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10 ${activeOrders.length > 0 && cart.length > 0 ? "pb-48" : activeOrders.length > 0 || cart.length > 0 ? "pb-32" : "pb-10"} lg:pb-16`}
        >
          <main className="min-w-0">
            {!searchQuery && <WaitPanel seat={seat} />}
            {searchQuery && (
              <section>
                <p className="text-sm text-menu-muted mb-4">
                  {searchResults.length > 0 ? `${searchResults.length} ${searchResults.length === 1 ? "dish" : "dishes"} for “${searchQuery}”` : `Nothing found for “${searchQuery}”`}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {searchResults.map((item) => <DishCard key={item.id} item={item} cartQty={getTotalItemQuantity(item.id)} {...cardProps} />)}
                </div>
              </section>
            )}

            {!searchQuery && (
              <div className="space-y-10">
                {displayedCategories.map((category) => {
                  const items = groupedItems[category.id] || [];
                  return (
                    <section key={category.id}>
                      <SectionHeader
                        name={category.name}
                        count={items.length}
                        onViewAll={selectedCategory || items.length <= 4 ? undefined : () => selectCategory(category.id)}
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        {items.map((item) => <DishCard key={item.id} item={item} cartQty={getTotalItemQuantity(item.id)} {...cardProps} />)}
                      </div>
                    </section>
                  );
                })}

                {uncategorizedItems.length > 0 && !selectedCategory && (
                  <section>
                    <SectionHeader name="More" count={uncategorizedItems.length} />
                    <div className="grid gap-3 md:grid-cols-2">
                      {uncategorizedItems.map((item) => <DishCard key={item.id} item={item} cartQty={getTotalItemQuantity(item.id)} {...cardProps} />)}
                    </div>
                  </section>
                )}
              </div>
            )}

            {isLoadingItems && (
              <div className="space-y-3" aria-label="Loading menu">
                <div className="h-10 w-44 rounded-xl bg-menu-line/70 animate-pulse mb-4" />
                {[0, 1, 2, 3].map(r => (
                  <div key={r} className="p-4 flex items-center justify-between gap-4 rounded-[22px] bg-menu-card border border-menu-line/70">
                    <div className="flex-1 space-y-2.5">
                      <div className="h-4 w-1/3 rounded bg-menu-line/70 animate-pulse" />
                      <div className="h-4 w-16 rounded bg-menu-line/70 animate-pulse" />
                      <div className="h-3 w-3/4 rounded bg-menu-line/50 animate-pulse" />
                    </div>
                    <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-menu-line/60 animate-pulse flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}

            {!isLoadingItems && (
              <motion.footer
                initial={prefersReducedMotion() ? false : "hidden"}
                whileInView="show"
                viewport={{ once: true, amount: 0.3 }}
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09 } } }}
                className="mt-10 pb-6 text-center"
              >
                {/* A hairline that draws out from the centre, then links and credits rise in */}
                <motion.div variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 0.7, ease: EASE } } }} className="h-px bg-menu-line/70 mb-8" />
                <motion.div variants={FOOT_RISE}>
                {/* Google Review & Social Links */}
                {(googleReviewUrl || socialLinks.length > 0) && (
                  <div className="flex flex-wrap items-center justify-center gap-3 mb-5">
                    {googleReviewUrl && (
                      <motion.a
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        href={googleReviewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-menu-card border border-menu-line/80 text-xs font-medium text-menu-ink hover:border-menu-accent/50 shadow-sm transition-all"
                      >
                        <GoogleG className="h-3.5 w-3.5" />
                        <span>Review us on Google</span>
                        <ArrowUpRight className="h-3 w-3 text-menu-muted" />
                      </motion.a>
                    )}
                    {socialLinks.length > 0 && (
                      <div className="flex items-center gap-2">
                        {socialLinks.map(({ key, Icon, label }) => (
                          <motion.a
                            key={key}
                            whileHover={{ scale: 1.12, y: -1 }}
                            whileTap={{ scale: 0.92 }}
                            href={social[key]}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={label}
                            className="w-9 h-9 rounded-full bg-menu-card border border-menu-line/80 flex items-center justify-center text-menu-muted hover:text-menu-accent hover:border-menu-accent/50 shadow-sm transition-colors"
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </motion.a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Minimal Developer & Powered by Pill */}
                </motion.div>
                {/* Credits: two quiet lines */}
                <motion.div variants={FOOT_RISE}>
                <p className="text-xs text-menu-muted">
                  Powered by{" "}
                  <a href="https://zenviqdigital.in" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 align-middle font-semibold text-menu-accent hover:underline underline-offset-4">
                    <ZenviqLogo className="w-4 h-4 rounded-full" />zenviqdigital.in
                  </a>
                </p>
                <p className="mt-1.5 text-[11px] text-menu-muted">© {new Date().getFullYear()} QuickMenu · Crafted by Samir Sain</p>
                </motion.div>
              </motion.footer>
            )}
          </main>

          {/* Desktop: order panel instead of the bottom cart bar */}
          <aside className="hidden lg:block">
            <div className="sticky top-[132px] rounded-[24px] bg-menu-card border border-menu-line p-6 shadow-[0_24px_60px_-30px_rgba(14,17,22,0.35)]">
              {activeOrders.length > 0 && (
                <button onClick={() => setShowOrderStatusDialog(true)} className="mb-5 w-full flex items-center gap-3 rounded-2xl bg-menu-tint/60 px-4 py-3 text-left hover:bg-menu-tint transition-colors">
                  <StatusDot status={status} />
                  <span className="flex-1 min-w-0 text-sm font-medium truncate">{STATUS_META[status].label}</span>
                  <ChevronRight className="h-4 w-4 text-menu-muted" />
                </button>
              )}
              <div className="flex items-baseline justify-between">
                <div className="flex items-center gap-2.5">
                  <h3 className="font-display text-[26px] leading-none">Your order</h3>
                  {cart.length > 0 && (
                    <button
                      type="button"
                      onClick={clearCart}
                      className="text-xs font-semibold text-red-500 hover:text-red-600 transition-colors px-2 py-0.5 rounded hover:bg-red-500/10"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                {activeOrders.length > 0 && (
                  <button onClick={() => setShowBill(true)} className="text-xs font-medium text-menu-accent hover:underline underline-offset-4">Bill & payment</button>
                )}
              </div>
              {ordersEnabled ? <div className="mt-3">{orderSummary}</div> : <p className="mt-3 text-sm text-menu-muted">Please order with a member of staff.</p>}
            </div>
          </aside>
        </div>
      </div>

      {/* Phone: cart bar */}
      <AnimatePresence>
        {cart.length > 0 && ordersEnabled && (
          <motion.div
            initial={{ y: 110, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 110, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className={`lg:hidden fixed inset-x-3 z-50 ${activeOrders.length > 0 ? "bottom-[80px]" : "bottom-3"}`}
          >
            <button
              onClick={() => setShowCartDialog(true)}
              className="w-full max-w-xl mx-auto flex items-center rounded-[26px] p-2 pl-5 bg-gradient-to-r from-menu-accent to-menu-accent-2 dark:to-menu-accent text-[#FBF4EA] dark:text-menu-hero shadow-[0_22px_44px_-18px_rgba(138,58,30,0.75)] active:scale-[0.99] transition-transform"
            >
              <motion.span key={totalItems} initial={{ rotate: -12, scale: 0.9 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                <ShoppingBag className="h-[22px] w-[22px]" strokeWidth={1.75} />
              </motion.span>
              <span className="ml-3.5 text-left">
                <span className="block text-[17px] font-semibold leading-tight tabular-nums"><CountUp value={totalPrice} format={formatINR} duration={0.5} /></span>
                <span className="block text-xs opacity-80">{totalItems} {totalItems === 1 ? "item" : "items"}</span>
              </span>
              <span className="ml-auto mr-4 h-8 w-px bg-current opacity-25" />
              <span className="h-12 px-6 rounded-[20px] bg-[#FBF1E6] text-menu-accent-2 text-[15px] font-semibold flex items-center gap-2">
                View order <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phone: order status bar */}
      <AnimatePresence>
        {activeOrders.length > 0 && (
          <motion.div
            initial={{ y: 90 }}
            animate={{ y: 0 }}
            exit={{ y: 90 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-menu-card/90 backdrop-blur-xl border-t border-menu-line"
          >
            <button onClick={() => setShowOrderStatusDialog(true)} className="w-full px-5 h-[68px] flex items-center justify-between gap-4 text-left">
              <span className="flex items-center gap-3 min-w-0">
                <StatusDot status={status} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium truncate">{STATUS_META[status].label}</span>
                  <span className="block text-xs text-menu-muted truncate">
                    {activeOrders.length === 1 ? `Order #${activeOrders[0].order_number.replace(/^ORD0*/, "")}` : `${activeOrders.length} orders`} · {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[15px] font-semibold tabular-nums">{formatINR(billTotal)}</span>
                <ChevronRight className="w-4 h-4 text-menu-muted" />
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cart sheet (phone / mobile) with fixed header, scrollable items and pinned checkout */}
      <Dialog open={showCartDialog} onOpenChange={setShowCartDialog}>
        <DialogContent aria-describedby={undefined} className="max-w-md w-[95vw] sm:w-full max-h-[88dvh] flex flex-col p-0 gap-0 rounded-[24px] sm:rounded-[28px] overflow-hidden border border-menu-line bg-menu-bg text-menu-ink shadow-2xl z-[200] [&>button]:hidden">
          <SheetHeader
            title="Your order"
            onClose={() => setShowCartDialog(false)}
            action={cart.length > 0 ? (
              <button
                type="button"
                onClick={clearCart}
                className="text-xs font-semibold text-red-500 hover:text-red-600 transition-colors px-2 py-0.5 rounded hover:bg-red-500/10"
              >
                Clear all
              </button>
            ) : null}
          />
          {cart.length === 0 ? (
            <div className="py-16 text-center text-sm text-menu-muted px-6">
              <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30 text-menu-muted" />
              <p>Your order is empty.</p>
              <p className="text-xs mt-1">Add some dishes from the menu to get started.</p>
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2">
                {cartItemsList}
              </div>
              <div className="shrink-0 px-6 pt-3 pb-6 bg-menu-card/95 backdrop-blur-md border-t border-menu-line space-y-3.5">
                {cartCheckoutSection}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Order status */}
      <Dialog open={showOrderStatusDialog} onOpenChange={setShowOrderStatusDialog}>
        <DialogContent aria-describedby={undefined} className={`${SHEET} [&>button]:hidden`}>
          <DialogTitle className="sr-only">Order status</DialogTitle>
          <div className="px-6 pt-7 pb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-menu-muted">{locationLabel} {activeOrders[0]?.table_number}</p>
                <h2 className="mt-2 font-display text-[30px] leading-tight">{STATUS_META[status].title}</h2>
              </div>
              <CloseButton onClick={() => setShowOrderStatusDialog(false)} />
            </div>
            {STATUS_META[status].step >= 0 ? <OrderProgress step={STATUS_META[status].step} /> : (
              <p className="mt-4 text-sm text-menu-muted">Please ask a member of staff for help.</p>
            )}
          </div>
          <ScrollArea className="max-h-[36vh] border-t border-menu-line">
            <div className="px-6 divide-y divide-menu-line">
              {activeOrders.map((order) => <OrderBlock key={order.id} order={order} formatINR={formatINR} onChange={changeOrder} />)}
            </div>
          </ScrollArea>
          <div className="px-6 pt-4 pb-6 border-t border-menu-line space-y-3">
            {billTotal > 0 && (
              allSettled
                ? <PrimaryButton onClick={() => { setShowOrderStatusDialog(false); setShowBill(true); }}><Receipt className="h-4 w-4" /> Pay the bill · {formatINR(seat.state?.bill.due ?? billTotal)}</PrimaryButton>
                : <SecondaryButton onClick={() => { setShowOrderStatusDialog(false); setShowBill(true); }}><Receipt className="h-4 w-4" /> View bill · {formatINR(billTotal)}</SecondaryButton>
            )}
            <SecondaryButton onClick={() => setShowOrderStatusDialog(false)}>Close</SecondaryButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order placed */}
      <Dialog open={showOrderConfirmation} onOpenChange={setShowOrderConfirmation}>
        <DialogContent aria-describedby={undefined} className={`${SHEET} max-w-sm [&>button]:hidden`}>
          <DialogTitle className="sr-only">Order placed</DialogTitle>
          <div className="px-6 pt-10 pb-6 text-center">
            <DrawnCheck />
            <h2 className="mt-6 font-display text-[32px] leading-tight">Order placed</h2>
            <p className="mt-2 text-sm text-menu-muted">#{orderNumber} · {locationLabel} {tableNumber}</p>
            <p className="mt-5 text-[15px] leading-relaxed text-menu-ink/80">We've sent it to the kitchen. You'll see updates here as it's prepared.</p>
          </div>
          <div className="px-6 pb-6">
            <PrimaryButton onClick={() => setShowOrderConfirmation(false)}>Continue browsing</PrimaryButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Feedback → Google review */}
      <Dialog open={showFeedback} onOpenChange={skipFeedback}>
        <DialogContent aria-describedby={undefined} className={`${SHEET} max-w-sm [&>button]:hidden`}>
          <DialogTitle className="sr-only">Rate your experience</DialogTitle>
          {reviewStep === "google" && googleReviewUrl ? (
            <div className="px-6 pt-9 pb-6 text-center">
              <div className="flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <Star key={i} className={`h-5 w-5 ${i <= rating ? "text-menu-accent fill-menu-accent" : "text-menu-line"}`} strokeWidth={1.5} />
                ))}
              </div>
              <h2 className="mt-5 font-display text-[30px] leading-tight">Thank you</h2>
              {servedBy && <p className="mt-1 text-sm text-menu-muted">From {servedBy} and the team</p>}
              <p className="mt-3 text-[15px] leading-relaxed text-menu-ink/80">
                Would you share this on Google? It takes a moment and helps others find {restaurantName}.
              </p>
              {commentCopied && <p className="mt-3 text-xs text-menu-muted">Your note is copied. Just paste it there.</p>}
              <div className="mt-7 space-y-2">
                <button
                  onClick={() => { window.open(googleReviewUrl, "_blank", "noopener,noreferrer"); skipFeedback(); }}
                  className="w-full h-12 rounded-2xl bg-menu-card border border-menu-line text-[15px] font-medium flex items-center justify-center gap-2.5 hover:border-menu-accent/50 active:scale-[0.99] transition"
                >
                  <GoogleG className="h-5 w-5" />
                  Review on Google
                </button>
                <button onClick={skipFeedback} className="w-full h-10 text-sm text-menu-muted hover:text-menu-ink transition-colors">Not now</button>
              </div>
            </div>
          ) : (
            <div className="px-6 pt-9 pb-6">
              <h2 className="text-center font-display text-[30px] leading-tight">How was your meal?</h2>
              <p className="mt-2 text-center text-sm text-menu-muted">Your rating goes straight to {restaurantName}.</p>
              <StarRating value={rating} onChange={setRating} />
              <textarea
                placeholder="Anything you'd like to tell us? (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-2xl border border-menu-line bg-menu-card text-[15px] placeholder:text-menu-muted outline-none focus:border-menu-accent/60 resize-none transition-colors"
              />
              <div className="mt-4 space-y-2">
                <PrimaryButton onClick={submitFeedback} disabled={rating === 0}>Submit</PrimaryButton>
                <button onClick={skipFeedback} className="w-full h-10 text-sm text-menu-muted hover:text-menu-ink transition-colors">Maybe later</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BillSheet
        open={showBill}
        onOpenChange={setShowBill}
        seat={seat}
        restaurantName={restaurantName}
        upiId={upiId}
        locationLabel={locationLabel}
        reviewed={reviewed || activeOrders.some(o => !!localStorage.getItem(`feedback_submitted_${o.id}`))}
        onReview={() => { feedbackDismissedRef.current = true; openFeedback(); }}
        onOrderAgain={orderAgain}
        onChangeOrder={changeOrder}
      />
    </div>
  );
};

// ---------- Presentational pieces ----------

// Shown until the owner uploads a cover photo in Settings. Served from our own origin so the CSP allows it.
const DEFAULT_COVER = "/menu-cover.jpg";
// One quiet glass style for every control over the cover photo; terracotta stays for the active pill and the order
const GLASS = "relative h-10 w-10 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/20 text-white flex items-center justify-center hover:bg-black/45 active:scale-95 transition";
const GHOST = "relative h-9 w-9 rounded-full flex items-center justify-center text-menu-ink/80 hover:bg-menu-ink/5 transition-colors";

type OrderStatus = "pending" | "accepted" | "preparing" | "ready" | "completed" | "rejected" | "cancelled";
const STATUS_META: Record<OrderStatus, { label: string; title: string; dot: string; step: number }> = {
  pending: { label: "Waiting for the kitchen to confirm", title: "Order sent", dot: "bg-amber-500", step: 0 },
  accepted: { label: "Order confirmed", title: "Confirmed", dot: "bg-menu-accent-2", step: 1 },
  preparing: { label: "Being prepared", title: "In the kitchen", dot: "bg-menu-accent", step: 2 },
  ready: { label: "Ready. On its way to you", title: "Ready", dot: "bg-emerald-500", step: 3 },
  completed: { label: "Served. Enjoy your meal", title: "Enjoy your meal", dot: "bg-emerald-500", step: 4 },
  rejected: { label: "Order not accepted", title: "Order not accepted", dot: "bg-red-500", step: -1 },
  cancelled: { label: "Order taken back", title: "Order taken back", dot: "bg-menu-muted", step: -1 },
};
const STEPS = ["Sent", "Confirmed", "Preparing", "Ready", "Served"];

// The furthest-along live order speaks for the table; orders taken back or declined only count when nothing else is live
function overallStatus(orders: { status: string }[]): OrderStatus {
  const live = orders.filter(o => o.status !== "rejected" && o.status !== "cancelled");
  if (!live.length) return orders.some(o => o.status === "rejected") ? "rejected" : "cancelled";
  if (live.every(o => o.status === "completed")) return "completed";
  for (const s of ["ready", "preparing", "accepted"] as const) if (live.some(o => o.status === s)) return s;
  return "pending";
}

// Line icon per category name, like the section marks in a printed menu
const categoryIcon = (name: string) => {
  const n = name.toLowerCase();
  if (/drink|beverage|juice|coffee|tea|shake|mocktail/.test(n)) return CupSoda;
  if (/dessert|sweet|ice/.test(n)) return IceCreamCone;
  if (/main|course|curry|thali|entree/.test(n)) return ConciergeBell;
  if (/start|appet|snack|salad|soup/.test(n)) return Salad;
  if (/pizza/.test(n)) return Pizza;
  if (/bread|roti|naan/.test(n)) return Croissant;
  return UtensilsCrossed;
};

const CategoryPills = ({ tone, tabs, isSelected, onSelect, showVeg, vegOnly, onToggleVeg }: {
  tone: "dark" | "light";
  tabs: { id: string | null; name: string }[];
  isSelected: (id: string | null) => boolean;
  onSelect: (id: string | null) => void;
  showVeg: boolean;
  vegOnly: boolean;
  onToggleVeg: () => void;
}) => {
  const idle = tone === "dark"
    ? "bg-white/10 text-white/85 ring-1 ring-white/15 backdrop-blur-md hover:bg-white/15"
    : "bg-menu-ink/[0.05] text-menu-ink/70 hover:bg-menu-ink/[0.08]";
  return (
    <div className="-mx-4 px-4 lg:mx-0 lg:px-0 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {showVeg && (
        <button
          role="switch"
          aria-checked={vegOnly}
          onClick={onToggleVeg}
          className={`h-10 pl-3 pr-4 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 flex items-center gap-2 transition-colors ${vegOnly ? "bg-green-700 text-white" : idle}`}
        >
          <span className={`h-3.5 w-3.5 rounded-[3px] border-[1.5px] flex items-center justify-center ${vegOnly ? "border-white" : "border-green-600"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${vegOnly ? "bg-white" : "bg-green-600"}`} />
          </span>
          Veg
        </button>
      )}
      {/* The Veg switch is a filter, not a category: keep it visually apart */}
      {showVeg && <span aria-hidden="true" className={`h-6 w-px flex-shrink-0 ${tone === "dark" ? "bg-white/25" : "bg-menu-ink/15"}`} />}
      {tabs.map(({ id, name }) => {
        const active = isSelected(id);
        return (
          <motion.button
            key={id ?? "all"}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => { onSelect(id); e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); }}
            aria-pressed={active}
            className={`relative h-10 px-5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 capitalize transition-colors duration-300 ${active ? "text-[#FBF4EA] dark:text-menu-hero" : idle}`}
          >
            {active && (
              <motion.span
                layoutId={`pill-${tone}`}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="absolute inset-0 rounded-full bg-gradient-to-b from-menu-accent to-menu-accent-2 dark:to-menu-accent shadow-[0_8px_20px_-8px_rgba(176,82,44,0.8)]"
              />
            )}
            <span className="relative">{name}</span>
          </motion.button>
        );
      })}
    </div>
  );
};

const SectionHeader = ({ name, count, onViewAll }: { name: string; count: number; onViewAll?: () => void }) => {
  const Icon = categoryIcon(name);
  return (
    <div data-reveal className="flex items-center gap-3.5 mb-4">
      <Icon className="h-7 w-7 text-menu-ink/75 flex-shrink-0" strokeWidth={1.4} />
      <div className="flex-1 min-w-0">
        <h2 className="font-display text-[26px] leading-tight capitalize truncate">{name}</h2>
        <p className="text-[13px] text-menu-muted">{count} {count === 1 ? "dish" : "dishes"}</p>
      </div>
      {onViewAll && (
        <button onClick={onViewAll} className="h-9 px-4 rounded-full border border-menu-line bg-menu-card/60 text-[13px] font-medium text-menu-accent-2 dark:text-menu-accent flex items-center gap-1.5 hover:border-menu-accent/40 transition-colors">
          View all <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

// "+" circle that morphs into a − qty + pill once the dish is in the cart
const QtyPill = ({ qty, onMinus, onPlus, small = false }: { qty: number; onMinus?: () => void; onPlus: () => void; small?: boolean }) => {
  const h = small ? "h-8" : "h-8 sm:h-9";
  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      className={`${h} flex items-center overflow-hidden flex-shrink-0 rounded-full ${
        qty > 0
          ? "bg-menu-accent text-white shadow-md ring-1 ring-menu-accent"
          : "bg-menu-card border border-menu-line text-menu-accent shadow-sm hover:border-menu-accent/50"
      }`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {qty > 0 ? (
          <motion.div
            key="qty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center px-1"
          >
            <button
              type="button"
              onClick={onMinus}
              aria-label="Decrease quantity"
              className={`${small ? "w-7" : "w-8"} ${h} flex items-center justify-center text-white/90 hover:text-white active:scale-90 transition-transform`}
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <span className={`relative ${small ? "w-4" : "w-5"} ${h} overflow-hidden text-xs sm:text-sm font-bold tabular-nums text-center flex items-center justify-center`}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={qty}
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -12, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 600, damping: 32 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {qty}
                </motion.span>
              </AnimatePresence>
            </span>
            <button
              type="button"
              onClick={onPlus}
              aria-label="Increase quantity"
              className={`${small ? "w-7" : "w-8"} ${h} flex items-center justify-center text-white/90 hover:text-white active:scale-90 transition-transform`}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="add"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.18 }}
            whileTap={{ scale: 0.88 }}
            onClick={onPlus}
            aria-label="Add to order"
            className={`${small ? "px-2.5 text-xs" : "px-3.5 text-xs font-bold uppercase tracking-wider"} ${h} flex items-center justify-center gap-1 text-menu-accent hover:text-menu-accent-2 transition-colors`}
          >
            {small ? (
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <>
                <span>ADD</span>
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              </>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const DishCard = ({ item, cartQty, onAdd, onUpdate, formatINR, getCartQtyBySize, ordersEnabled = true }: any) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSizes, setShowSizes] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const hasLongDescription = item.description && item.description.length > 70;
  const hasSizeVariants = item.has_size_variants && item.size_variants?.length > 0;
  const addons: { name: string; price: number }[] = Array.isArray(item.addons) ? item.addons : [];
  const hasAddons = addons.length > 0;
  // Add-on picker (in the dish drawer)
  const [pickSize, setPickSize] = useState<string | null>(hasSizeVariants ? item.size_variants[0].name : null);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pickQty, setPickQty] = useState(1);
  const sizePrice = hasSizeVariants ? (item.size_variants.find((v: { name: string }) => v.name === pickSize)?.price ?? item.price) : item.price;
  const unit = sizePrice + addons.filter(a => picked.includes(a.name)).reduce((s, a) => s + Number(a.price), 0);
  const addPicked = () => {
    onAdd(item, hasSizeVariants ? item.size_variants.find((v: { name: string }) => v.name === pickSize) : undefined,
      { addons: addons.filter(a => picked.includes(a.name)), note, qty: pickQty });
    setDetailOpen(false);
    setPicked([]); setNote(""); setPickQty(1);
  };

  const price = (() => {
    if (!hasSizeVariants) return formatINR(item.price);
    const prices = item.size_variants.map((v: { price: number }) => v.price);
    const min = Math.min(...prices), max = Math.max(...prices);
    return min === max ? formatINR(min) : `${formatINR(min)} – ${formatINR(max)}`;
  })();

  const control = !item.is_available ? (
    <span className="text-xs text-menu-muted">Unavailable</span>
  ) : !ordersEnabled ? null : hasAddons ? (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={() => setDetailOpen(true)}
      aria-label={`Add ${item.name}, choose extras`}
      className="h-8 sm:h-9 px-3 rounded-full bg-menu-card border border-menu-line text-menu-accent shadow-sm hover:border-menu-accent/50 flex items-center justify-center gap-1 text-[11px] sm:text-xs font-bold uppercase tracking-wider transition"
    >
      {cartQty > 0 ? <span className="tabular-nums font-bold">{cartQty} in cart</span> : <><span>ADD</span><Plus className="h-3.5 w-3.5" strokeWidth={2.5} /></>}
    </motion.button>
  ) : hasSizeVariants ? (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={() => setShowSizes(s => !s)}
      aria-expanded={showSizes}
      aria-label="Choose size"
      className="h-8 sm:h-9 px-3 rounded-full bg-menu-card border border-menu-line text-menu-accent shadow-sm hover:border-menu-accent/50 flex items-center justify-center gap-1 text-[11px] sm:text-xs font-bold uppercase tracking-wider transition"
    >
      {cartQty > 0 ? (
        <span className="tabular-nums font-bold">{cartQty} in cart</span>
      ) : (
        <>
          <span>ADD</span>
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </>
      )}
    </motion.button>
  ) : (
    <QtyPill qty={cartQty} onMinus={() => onUpdate(item.id, -1)} onPlus={() => onAdd(item)} />
  );

  const sizeRows = hasSizeVariants && (
    <div className="divide-y divide-menu-line/70">
      {item.size_variants.map((size: { name: string; price: number }) => {
        const qty = getCartQtyBySize ? getCartQtyBySize(item.id, size.name) : 0;
        return (
          <div key={size.name} className="px-4 h-12 sm:h-14 flex items-center justify-between text-[14px]">
            <span>{size.name} <span className="ml-2 text-menu-accent font-semibold tabular-nums">{formatINR(size.price)}</span></span>
            {item.is_available && ordersEnabled && <QtyPill qty={qty} onMinus={() => onUpdate(item.id, -1, size.name)} onPlus={() => onAdd(item, size)} small />}
          </div>
        );
      })}
    </div>
  );

  return (
    <article
      data-reveal
      className="rounded-[20px] bg-menu-card border border-menu-line/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-md transition-shadow flex flex-col justify-between"
    >
      <div className="flex items-start justify-between gap-3.5 sm:gap-4">
        {/* Left: Dish Information */}
        <div className="flex-1 min-w-0 pr-1">
          {(item.is_veg != null || item.is_bestseller || item.is_chef_special) && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <VegMark isVeg={item.is_veg} className="h-3.5 w-3.5" />
              {item.is_chef_special && <ChefPickBadge />}
              {item.is_bestseller && <BestsellerBadge />}
            </div>
          )}
          <h3 className="font-display text-[17px] sm:text-[19px] font-normal leading-snug text-menu-ink">
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="text-left hover:text-menu-accent-2 transition-colors line-clamp-2"
            >
              {item.name}
            </button>
          </h3>
          <p className="mt-1 flex items-baseline gap-2.5">
            <span className="text-[15px] sm:text-[16px] font-semibold text-menu-accent tabular-nums">{price}</span>
            {item.prep_minutes > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-menu-muted" title="Time in the kitchen">
                <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />{item.prep_minutes} min
              </span>
            )}
          </p>
          {item.description && (
            <p className={`mt-1.5 text-[13px] leading-relaxed text-menu-muted ${isExpanded ? "" : "line-clamp-2"}`}>
              {item.description}
            </p>
          )}
          {hasLongDescription && (
            <button
              type="button"
              onClick={() => setIsExpanded(e => !e)}
              className="mt-1 text-xs font-medium text-menu-accent hover:underline"
            >
              {isExpanded ? "Less" : "More"}
            </button>
          )}
        </div>

        {/* Right: Square Dish Photo & Order Control */}
        {item.image_url ? (
          <div className="relative flex flex-col items-center flex-shrink-0">
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              aria-label={`View ${item.name}`}
              className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-menu-tint ring-1 ring-menu-line/80 shadow-[0_2px_8px_rgba(0,0,0,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-menu-accent group"
            >
              <DishPhoto
                data-reveal-img
                url={item.image_url}
                widths={[320, 480, 640]}
                sizes="(min-width: 640px) 112px, 96px"
                alt={item.name}
                className="group-hover:scale-105 transition-transform duration-300"
              />
            </button>
            <div className="-mt-3.5 relative z-10">
              {control}
            </div>
          </div>
        ) : (
          <div className="self-end flex-shrink-0 mt-auto pt-2">
            {control}
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {showSizes && hasSizeVariants && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="mt-3 overflow-hidden border-t border-menu-line/70 pt-2"
          >
            {sizeRows}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dish detail: whole photo with full aspect ratio */}
      <Drawer open={detailOpen} onOpenChange={setDetailOpen}>
        <DrawerContent className="max-h-[92dvh] bg-menu-bg border-menu-line text-menu-ink">
          <div className="mx-auto w-full max-w-lg overflow-y-auto px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {item.image_url && (
              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-menu-tint shadow-md">
                <img
                  src={sizedImage(item.image_url, 800)}
                  srcSet={[480, 800, 1200].map(w => `${sizedImage(item.image_url, w)} ${w}w`).join(", ")}
                  sizes="(min-width: 640px) 512px, 100vw"
                  alt={item.name}
                  referrerPolicy="no-referrer"
                  crossOrigin="anonymous"
                  onError={(e) => { e.currentTarget.src = "/placeholder.svg"; e.currentTarget.removeAttribute("srcset"); }}
                  className="w-full h-full object-cover object-center"
                />
              </div>
            )}
            {(item.is_veg != null || item.is_bestseller || item.is_chef_special || item.prep_minutes > 0) && (
              <div className="mt-4 flex items-center gap-2">
                <VegMark isVeg={item.is_veg} className="h-4 w-4" />
                {item.is_chef_special && <ChefPickBadge />}
                {item.is_bestseller && <BestsellerBadge />}
                {item.prep_minutes > 0 && <span className="inline-flex items-center gap-1 text-xs text-menu-muted"><Clock className="h-3 w-3" strokeWidth={2} />{item.prep_minutes} min</span>}
              </div>
            )}
            <DrawerTitle className="mt-2 font-display text-[26px] sm:text-[28px] font-semibold leading-tight tracking-tight text-menu-ink">{item.name}</DrawerTitle>
            <DrawerDescription className={item.description ? "mt-2 text-[14px] sm:text-[15px] leading-relaxed text-menu-muted" : "sr-only"}>
              {item.description || item.name}
            </DrawerDescription>
            {hasAddons && item.is_available && ordersEnabled ? (
              <div className="mt-5 space-y-5">
                {hasSizeVariants && (
                  <fieldset>
                    <legend className="text-sm font-medium mb-2">Size</legend>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size">
                      {item.size_variants.map((v: { name: string; price: number }) => (
                        <button key={v.name} type="button" role="radio" aria-checked={pickSize === v.name} onClick={() => setPickSize(v.name)}
                          className={`h-10 px-4 rounded-full text-[13px] font-medium transition-colors ${pickSize === v.name ? "bg-menu-ink text-menu-bg" : "bg-menu-ink/[0.05] text-menu-ink/80 hover:bg-menu-ink/[0.09]"}`}>
                          {v.name} · {formatINR(v.price)}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
                <fieldset>
                  <legend className="text-sm font-medium mb-2">Add-ons</legend>
                  <div className="rounded-2xl border border-menu-line bg-menu-card divide-y divide-menu-line">
                    {addons.map(a => {
                      const on = picked.includes(a.name);
                      return (
                        <label key={a.name} className="px-4 h-12 flex items-center justify-between gap-3 text-[14px] cursor-pointer">
                          <span className="flex items-center gap-3">
                            <input type="checkbox" checked={on} onChange={() => setPicked(p => (on ? p.filter(x => x !== a.name) : [...p, a.name]))}
                              className="h-[18px] w-[18px] rounded accent-[rgb(var(--menu-accent))]" />
                            {a.name}
                          </span>
                          <span className="tabular-nums text-menu-muted">+{formatINR(a.price)}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <div>
                  <label htmlFor={`note-${item.id}`} className="block text-sm font-medium mb-2">Note for the kitchen <span className="font-normal text-menu-muted">(optional)</span></label>
                  <input id={`note-${item.id}`} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. less spicy" className={inputClass} />
                </div>
                <div className="flex items-center gap-3">
                  <Stepper value={pickQty} min={1} max={20} onChange={setPickQty} label={`${item.name} quantity`} />
                  <PrimaryButton onClick={addPicked} className="flex-1">Add · {formatINR(unit * pickQty)}</PrimaryButton>
                </div>
              </div>
            ) : hasSizeVariants ? (
              <div className="mt-5 rounded-2xl border border-menu-line bg-menu-card overflow-hidden">{sizeRows}</div>
            ) : (
              <div className="mt-5 flex items-center justify-between gap-3">
                <p className="text-[22px] font-bold text-menu-accent tabular-nums">{price}</p>
                {control}
              </div>
            )}
            {hasSizeVariants && !item.is_available && <p className="mt-3 text-sm text-menu-muted">Unavailable right now</p>}
          </div>
        </DrawerContent>
      </Drawer>
    </article>
  );
};

const StatusDot = ({ status }: { status: OrderStatus }) => {
  const live = STATUS_META[status].step >= 0 && STATUS_META[status].step < 4;
  return (
    <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
      {live && <span className={`absolute inline-flex h-full w-full rounded-full ${STATUS_META[status].dot} opacity-60 animate-ping`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${STATUS_META[status].dot}`} />
    </span>
  );
};

const OrderProgress = ({ step }: { step: number }) => {
  const fill = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!fill.current) return;
    const to = `${(step / (STEPS.length - 1)) * 100}%`;
    if (prefersReducedMotion()) { fill.current.style.width = to; return; }
    const t = gsap.fromTo(fill.current, { width: "0%" }, { width: to, duration: 1.1, ease: "power3.inOut", delay: 0.15 });
    return () => { t.kill(); };
  }, [step]);
  return (
    <div className="mt-7">
      <div className="relative h-[3px] rounded-full bg-menu-line">
        <div ref={fill} className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-menu-accent to-menu-accent-2" style={{ width: 0 }} />
      </div>
      <div className="mt-3 grid grid-cols-5 text-[11px]">
        {STEPS.map((s, i) => (
          <span key={s} className={`${i === 0 ? "text-left" : i === STEPS.length - 1 ? "text-right" : "text-center"} ${i <= step ? "text-menu-ink font-medium" : "text-menu-muted"}`}>{s}</span>
        ))}
      </div>
    </div>
  );
};

const OrderBlock = ({ order, formatINR, showStatus, onChange }: { order: any; formatINR: (n: number) => string; showStatus?: boolean; onChange?: (o: any) => void }) => {
  const items: { name: string; price: number; quantity?: number; selectedSize?: string | null; options?: string | null }[] = order.items?.items || [];
  const st = (order.status in STATUS_META ? order.status : "pending") as OrderStatus;
  const voided = st === "rejected" || st === "cancelled";
  return (
    <div className="py-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-menu-muted tabular-nums">#{String(order.order_number).replace(/^ORD0*/, "")}</span>
        {onChange && st === "pending" && <button onClick={() => onChange(order)} className="text-xs font-medium text-menu-accent-2 dark:text-menu-accent hover:underline underline-offset-4">Change</button>}
        {showStatus && (
          <span className="flex items-center gap-1.5 text-xs text-menu-ink/80">
            <StatusDot status={st} />
            {STEPS[STATUS_META[st].step] ?? STATUS_META[st].label}
          </span>
        )}
      </div>
      <div className={`space-y-1.5 ${voided ? "opacity-50 line-through" : ""}`}>
        {items.map((it, i) => (
          <div key={i} className="flex justify-between gap-4 text-[14px]">
            <span className="min-w-0">
              <span className="block truncate">{it.name}{(it.quantity || 1) > 1 && <span className="text-menu-muted"> × {it.quantity}</span>}</span>
              {(it.selectedSize || it.options) && <span className="block text-xs text-menu-muted truncate">{[it.selectedSize, it.options].filter(Boolean).join(" · ")}</span>}
            </span>
            <span className="tabular-nums text-menu-ink/80">{formatINR(it.price * (it.quantity || 1))}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
const StarRating = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="my-7 text-center">
      <div className="flex justify-center gap-2" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map(n => (
          <motion.button
            key={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            whileTap={{ scale: 0.85 }}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            className="p-1"
          >
            <Star className={`h-9 w-9 transition-colors duration-200 ${n <= shown ? "text-menu-accent fill-menu-accent" : "text-menu-line"}`} strokeWidth={1.25} />
          </motion.button>
        ))}
      </div>
      <p className="mt-2 h-5 text-sm text-menu-muted">{RATING_WORDS[shown]}</p>
    </div>
  );
};

const GoogleG = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
);

const ZenviqLogo = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg viewBox="0 0 512 512" fill="none" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="512" height="512" rx="225" fill="white" />
    <path d="M130.005 109.662C162.062 108.209 204.898 109.62 237.91 109.487C268.172 109.213 298.436 109.132 328.699 109.241C342.949 109.28 357.258 109.549 371.877 109.579C388.51 107.551 400.365 121.407 399.995 135.865C399.594 151.544 377.536 176.622 368.355 190.078C356.2 207.894 344.189 225.597 331.411 242.635C326.559 248.081 322.223 255.133 316.799 261.329C319.19 249.628 320.139 221.629 314.943 210.3C310.78 201.226 300.155 197.618 290.755 194.466C296.325 185.33 311.989 166.759 320.408 159.843C311.457 160.623 296.709 160.547 287.348 160.674C268.222 160.946 249.093 161.123 229.965 161.207L169.962 161.278C160.465 161.284 130.124 162.379 123.974 158.936C104.115 147.814 105.841 115.678 130.005 109.662Z" fill="#122940" />
    <path d="M264.035 217.284C273.931 216.628 285.503 216.738 295.55 216.641C296.039 231.81 298.258 323.504 293.564 330.533C288.18 334.381 276.95 333.836 270.049 333.799C259.367 325.64 254.231 312.774 250.788 300.998C218.859 322.145 175.582 391.35 141.914 400.072C117.082 402.554 97.705 378.469 116.575 360.688C138.947 339.606 159.71 317.073 179.566 294.086C188.176 284.118 197.134 276.233 205.379 265.529C195.433 260.613 160.624 244.249 172.049 227.835C175.114 223.432 183.054 222.375 188.77 222.213C213.934 221.501 238.946 219.316 264.035 217.284Z" fill="#26BCBC" />
    <path d="M234.637 349.098C245.053 348.449 265.477 349.618 276.838 349.8C303.797 350.259 330.758 350.453 357.721 350.385C369.656 350.408 385.738 349.166 394.172 356.839C399.992 362.187 403.17 369.397 402.993 376.858C402.387 405.546 374.162 403.268 351.521 402.729C318.403 402.007 285.112 402.633 252.017 402.546C231.521 402.493 201.048 403.343 181.414 399.834C192.399 387.029 219.202 356.617 234.637 349.098Z" fill="#122940" />
  </svg>
);

export default CustomerMenu;
