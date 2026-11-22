import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, Save, Upload, X, Bell, BellOff, BellRing, 
  Store, ImageIcon, CheckCircle2, AlertCircle, Settings, ShoppingCart, HandHelping,
  Sun, Moon, Monitor, Building2, Hotel
} from "lucide-react";
import { uploadImage, deleteImage, isHostedImage, sizedImage } from "@/lib/imageUpload";
import { motion } from "framer-motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Same rule as the DB check constraint on restaurants.upi_id
const UPI_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;

interface RestaurantProfileProps {
  restaurantId: string;
}

const RestaurantProfile = ({ restaurantId }: RestaurantProfileProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<null | "logo" | "cover">(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [upiId, setUpiId] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [originalLogoUrl, setOriginalLogoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [originalCoverUrl, setOriginalCoverUrl] = useState<string | null>(null);
  
  // Feature toggles
  const [ordersEnabled, setOrdersEnabled] = useState(true);
  const [waiterCallEnabled, setWaiterCallEnabled] = useState(true);
  const [featureSaving, setFeatureSaving] = useState(false);
  
  // Notification states
  const [notificationSupported, setNotificationSupported] = useState(true);
  const [notificationSubscribed, setNotificationSubscribed] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [isProductionDomain, setIsProductionDomain] = useState(false);
  const [oneSignalReady, setOneSignalReady] = useState(false);
  
  // Theme state - dashboard only
  const [dashboardTheme, setDashboardTheme] = useState<'light' | 'dark' | 'system'>(() => {
    const saved = localStorage.getItem('dashboard-theme');
    return (saved as 'light' | 'dark' | 'system') || 'light';
  });
  // The header toggle can change the theme while this page is open
  useEffect(() => {
    const sync = () => setDashboardTheme((localStorage.getItem('dashboard-theme') as 'light' | 'dark' | 'system') || 'light');
    window.addEventListener('dashboard-theme', sync);
    return () => window.removeEventListener('dashboard-theme', sync);
  }, []);
  
  // Business type state
  const [businessType, setBusinessType] = useState<'restaurant' | 'hotel'>('restaurant');
  const [businessTypeSaving, setBusinessTypeSaving] = useState(false);
  const [showBusinessTypeDialog, setShowBusinessTypeDialog] = useState(false);
  const [pendingBusinessType, setPendingBusinessType] = useState<'restaurant' | 'hotel' | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    fetchRestaurantData();
    initializeNotifications();
  }, [restaurantId]);

  // Apply dashboard theme
  useEffect(() => {
    const applyTheme = (theme: 'light' | 'dark' | 'system') => {
      const root = document.documentElement;
      
      if (theme === 'system') {
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', systemDark);
      } else {
        root.classList.toggle('dark', theme === 'dark');
      }
      
      localStorage.setItem('dashboard-theme', theme);
      window.dispatchEvent(new Event('dashboard-theme')); // keeps the header toggle in sync
    };
    
    applyTheme(dashboardTheme);
    
    // Listen for system theme changes if using system preference
    if (dashboardTheme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.classList.toggle('dark', e.matches);
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [dashboardTheme]);

  const handleThemeChange = (theme: 'light' | 'dark' | 'system') => {
    setDashboardTheme(theme);
    toast({
      title: "Theme Updated",
      description: `Dashboard theme set to ${theme}`,
    });
  };

  const handleBusinessTypeChange = async (type: 'restaurant' | 'hotel') => {
    // If clicking the same type, do nothing
    if (type === businessType) return;
    
    // Show confirmation dialog
    setPendingBusinessType(type);
    setShowBusinessTypeDialog(true);
  };

  const confirmBusinessTypeChange = async () => {
    if (!pendingBusinessType) return;
    
    // Check if user typed "CONFIRM"
    if (confirmText.toUpperCase() !== "CONFIRM") {
      toast({
        title: "Invalid Confirmation",
        description: 'Please type "CONFIRM" to proceed',
        variant: "destructive",
      });
      return;
    }

    try {
      setBusinessTypeSaving(true);
      
      const { error } = await supabase
        .from("restaurants")
        .update({ business_type: pendingBusinessType })
        .eq("id", restaurantId);

      if (error) throw error;

      setBusinessType(pendingBusinessType);
      
      toast({
        title: "Business type updated",
        description: `Changed to ${pendingBusinessType === 'hotel' ? 'Hotel' : 'Restaurant'} mode. Page will reload to apply changes.`,
        duration: 3000,
      });

      // Close dialog and reset
      setShowBusinessTypeDialog(false);
      setConfirmText("");
      setPendingBusinessType(null);

      // Reload page to apply changes throughout the app
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to update business type",
        variant: "destructive",
      });
    } finally {
      setBusinessTypeSaving(false);
    }
  };

  const cancelBusinessTypeChange = () => {
    setShowBusinessTypeDialog(false);
    setConfirmText("");
    setPendingBusinessType(null);
  };

  const fetchRestaurantData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("restaurants")
        .select("name, description, logo_url, cover_url, orders_enabled, waiter_call_enabled, business_type, upi_id")
        .eq("id", restaurantId)
        .single();

      if (error) throw error;

      setName(data.name || "");
      setDescription(data.description || "");
      setUpiId(data.upi_id || "");
      setLogoUrl(data.logo_url || null);
      setOriginalLogoUrl(data.logo_url || null);
      setCoverUrl(data.cover_url || null);
      setOriginalCoverUrl(data.cover_url || null);
      setOrdersEnabled(data.orders_enabled ?? true);
      setWaiterCallEnabled(data.waiter_call_enabled ?? true);
      const type = data.business_type as 'restaurant' | 'hotel';
      setBusinessType(type || 'restaurant');
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load restaurant profile",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const initializeNotifications = async () => {
    // Check if on production domain
    const isProd = !!(window as unknown as { __QM_PUSH_ON__?: boolean }).__QM_PUSH_ON__; // set in index.html: the live site, not localhost
    setIsProductionDomain(isProd);
    
    // Check browser support
    if (!("Notification" in window)) {
      setNotificationSupported(false);
      return;
    }

    // Wait for OneSignal to be ready
    if (isProd && (window as any).OneSignalDeferred) {
      try {
        await new Promise<void>((resolve) => {
          (window as any).OneSignalDeferred.push(async function (OneSignal: any) {
            try {
              setOneSignalReady(true);
              
              // Check current subscription status
              const subscribed = await OneSignal.User.PushSubscription.optedIn;
              setNotificationSubscribed(subscribed === true);
              
              // Tag with restaurant_id
              if (restaurantId) {
                await OneSignal.User.addTag("restaurant_id", restaurantId);
              }
            } catch (error) {
              console.error("OneSignal init error:", error);
            }
            resolve();
          });
        });
      } catch (error) {
        console.error("OneSignal setup error:", error);
      }
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    if (!isProductionDomain) {
      toast({
        title: "Not available here",
        description: "Push notifications only work on your live site, not on localhost.",
        variant: "destructive",
      });
      return;
    }

    if (!(window as any).OneSignalDeferred) {
      toast({
        title: "Please refresh",
        description: "OneSignal is not loaded. Refresh the page.",
        variant: "destructive",
      });
      return;
    }

    setNotificationLoading(true);

    try {
      await new Promise<void>((resolve, reject) => {
        (window as any).OneSignalDeferred.push(async function (OneSignal: any) {
          try {
            if (enabled) {
              // Tag with restaurant_id first
              await OneSignal.User.addTag("restaurant_id", restaurantId);
              console.log("Tagged with restaurant_id:", restaurantId);
              
              // Request permission using the slidedown prompt
              const permission = await OneSignal.Notifications.requestPermission();
              console.log("Permission result:", permission);
              
              if (permission) {
                // Opt in to push notifications
                await OneSignal.User.PushSubscription.optIn();
                setNotificationSubscribed(true);
                toast({
                  title: "Notifications on",
                  description: "You'll receive alerts when new orders come in",
                });
              } else {
                toast({
                  title: "Permission denied",
                  description: "Please allow notifications in your browser settings",
                  variant: "destructive",
                });
              }
            } else {
              // Opt out of push notifications
              await OneSignal.User.PushSubscription.optOut();
              setNotificationSubscribed(false);
              toast({
                title: "Notifications disabled",
                description: "You won't receive push notifications",
              });
            }
            resolve();
          } catch (error) {
            console.error("Notification toggle error:", error);
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error("Error:", error);
      toast({
        title: "Error",
        description: "Failed to update notification settings. Try refreshing.",
        variant: "destructive",
      });
    } finally {
      setNotificationLoading(false);
    }
  };

  const handleImageUpload = (kind: "logo" | "cover") => async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        toast({ title: "Invalid file", description: "Please upload an image", variant: "destructive" });
        return;
      }

      // Checked before compression, which shrinks phone photos to well under the 5MB upload cap
      if (file.size > 25 * 1024 * 1024) {
        toast({ title: "File too large", description: "Max 25MB allowed", variant: "destructive" });
        return;
      }

      setUploading(kind);
      
      const { compressImage } = await import("@/lib/imageOptimization");
      const compressedFile = await compressImage(file, kind);

      const result = await uploadImage(
        compressedFile,
        kind === "logo" ? "restaurant-logos" : "restaurant-covers",
        (progress) => setUploadProgress(progress)
      );

      if (!result.success || !result.publicUrl) {
        throw new Error(result.error || "Upload failed");
      }

      (kind === "logo" ? setLogoUrl : setCoverUrl)(result.publicUrl);
      toast({ title: kind === "logo" ? "Logo uploaded!" : "Cover photo uploaded!", description: "Don't forget to save" });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setUploading(null);
      setUploadProgress(0);
      event.target.value = ""; // lets the same file be picked again after removing it
    }
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
    toast({ title: "Logo removed", description: "Save to confirm" });
  };

  const handleSave = async () => {
    const upi = upiId.trim();
    if (upi && !UPI_RE.test(upi)) {
      toast({ title: "Invalid UPI ID", description: "Should look like yourcafe@okaxis", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const { error } = await supabase
        .from("restaurants")
        .update({
          name: name.trim(),
          description: description.trim(),
          logo_url: logoUrl,
          cover_url: coverUrl,
          upi_id: upi || null,
        })
        .eq("id", restaurantId);

      if (error) throw error;

      if (originalLogoUrl && originalLogoUrl !== logoUrl && isHostedImage(originalLogoUrl)) {
        deleteImage(originalLogoUrl);
      }

      if (originalCoverUrl && originalCoverUrl !== coverUrl && isHostedImage(originalCoverUrl)) {
        deleteImage(originalCoverUrl);
      }

      setOriginalLogoUrl(logoUrl);
      setOriginalCoverUrl(coverUrl);
      toast({ title: "Saved!", description: "Settings updated successfully" });
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleFeatureToggle = async (feature: 'orders' | 'waiter_call', enabled: boolean) => {
    try {
      setFeatureSaving(true);
      
      const updateData = feature === 'orders' 
        ? { orders_enabled: enabled }
        : { waiter_call_enabled: enabled };

      const { error } = await supabase
        .from("restaurants")
        .update(updateData)
        .eq("id", restaurantId);

      if (error) throw error;

      if (feature === 'orders') {
        setOrdersEnabled(enabled);
      } else {
        setWaiterCallEnabled(enabled);
      }

      toast({
        title: enabled ? "Feature Enabled" : "Feature Disabled",
        description: `${feature === 'orders' ? 'Online ordering' : 'Waiter call'} is now ${enabled ? 'enabled' : 'disabled'}`,
      });
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to update setting", variant: "destructive" });
    } finally {
      setFeatureSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Restaurant Info Card */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
              <Store className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl font-semibold tracking-normal">Restaurant settings</CardTitle>
              <CardDescription className="text-sm">
                Customize how customers see your restaurant
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Logo Section */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="relative flex-shrink-0">
              {logoUrl ? (
                <div className="relative">
                  <img 
                    src={logoUrl} 
                    alt="Logo" 
                    className="w-24 h-24 object-cover rounded-2xl border-2 border-border"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                    onClick={handleRemoveLogo}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="w-24 h-24 bg-muted rounded-2xl border-2 border-dashed border-border flex items-center justify-center">
                  <ImageIcon className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="flex-1 w-full">
              <Label className="text-sm font-medium mb-2 block">Restaurant Logo</Label>
              <div className="relative">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload("logo")}
                  disabled={!!uploading}
                  className="cursor-pointer h-auto py-2 file:mr-3 file:h-9 file:rounded-full file:border-0 file:bg-primary/10 file:px-4 file:text-sm file:font-medium file:text-primary"
                />
              </div>
              {uploading === "logo" && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-xs text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Uploading... {uploadProgress}%
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                    <div 
                      className="bg-primary h-1.5 rounded-full transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">Square image, up to 25MB</p>
            </div>
          </div>

          {/* Cover photo: shown behind the restaurant name on the public menu */}
          <div className="space-y-2">
            <Label className="text-sm font-medium block">Cover Photo</Label>
            <div className="relative aspect-[16/7] w-full overflow-hidden rounded-2xl border-2 border-border bg-muted">
              <img
                src={coverUrl ? sizedImage(coverUrl, 1200) : "/menu-cover.jpg"}
                alt="Cover"
                className="absolute inset-0 h-full w-full object-cover"
              />
              {/* Same shade as the menu, so the preview matches what guests see */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/30 to-black/85" />
              <span className="absolute left-4 bottom-3 text-white font-semibold text-lg drop-shadow">{name || "Your restaurant"}</span>
              {coverUrl ? (
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7 rounded-full"
                  onClick={() => { setCoverUrl(null); toast({ title: "Cover removed", description: "Save to confirm" }); }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <span className="absolute top-2 right-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white">Default cover</span>
              )}
            </div>
            <Input
              type="file"
              accept="image/*"
              onChange={handleImageUpload("cover")}
              disabled={!!uploading}
              className="cursor-pointer h-auto py-2 file:mr-3 file:h-9 file:rounded-full file:border-0 file:bg-primary/10 file:px-4 file:text-sm file:font-medium file:text-primary"
            />
            {uploading === "cover" && (
              <div className="flex items-center gap-2 text-xs text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading... {uploadProgress}%
              </div>
            )}
            <p className="text-xs text-muted-foreground">Landscape photo works best (at least 1600px wide), up to 25MB. It fits every screen automatically.</p>
          </div>

          {/* Name Input */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium">Restaurant Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your restaurant name"
              maxLength={100}
              className="h-11 rounded-xl"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-medium">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your restaurant, cuisine type, specialties..."
              rows={4}
              maxLength={500}
              className="resize-none rounded-xl"
            />
            <p className="text-xs text-muted-foreground text-right">{description.length}/500</p>
          </div>

          {/* UPI */}
          <div className="space-y-2">
            <Label htmlFor="upi" className="text-sm font-medium">UPI ID for bill payment</Label>
            <Input
              id="upi"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="yourcafe@okaxis"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={100}
              className="h-11 rounded-xl"
            />
            <p className="text-xs text-muted-foreground">
              Customers get a "Pay with UPI" button with the bill amount filled in. Use a business/merchant UPI ID, since some apps limit payment links to personal IDs. Leave empty to hide.
            </p>
          </div>

          {/* Save Button */}
          <Button 
            onClick={handleSave} 
            disabled={saving} 
            className="w-full h-11 rounded-xl  font-medium"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Feature Settings Card */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
              <Settings className="h-6 w-6 text-accent-foreground" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">Feature Settings</CardTitle>
              <CardDescription className="text-sm">
                Control which features are available to customers
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-0 space-y-4">
            <>
              {/* Online Ordering Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-muted/40">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg ${ordersEnabled ? 'bg-accent' : 'bg-muted'}`}>
                    <ShoppingCart className={`h-5 w-5 ${ordersEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div>
                    <p className="font-medium">Online Ordering</p>
                    <p className="text-sm text-muted-foreground">
                      {ordersEnabled ? 'Customers can place orders' : 'Ordering disabled'}
                    </p>
                  </div>
                </div>
                {featureSaving ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <Switch
                    checked={ordersEnabled}
                    onCheckedChange={(checked) => handleFeatureToggle('orders', checked)}
                    disabled={featureSaving}
                  />
                )}
              </div>

              {/* Waiter Call Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-muted/40">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg ${waiterCallEnabled ? 'bg-accent' : 'bg-muted'}`}>
                    <HandHelping className={`h-5 w-5 ${waiterCallEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div>
                    <p className="font-medium">Waiter Call</p>
                    <p className="text-sm text-muted-foreground">
                      {waiterCallEnabled ? 'Customers can request assistance' : 'Waiter call disabled'}
                    </p>
                  </div>
                </div>
                {featureSaving ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <Switch
                    checked={waiterCallEnabled}
                    onCheckedChange={(checked) => handleFeatureToggle('waiter_call', checked)}
                    disabled={featureSaving}
                  />
                )}
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Changes take effect immediately for new customers
              </p>
            </>
        </CardContent>
      </Card>

      {/* Push Notifications Card */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              notificationSubscribed 
                ? 'bg-accent' 
                : 'bg-muted'
            }`}>
              {notificationSubscribed ? (
                <BellRing className="h-6 w-6 text-primary" />
              ) : (
                <Bell className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">Push Notifications</CardTitle>
              <CardDescription className="text-sm">
                Get instant alerts for new orders
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-0 space-y-4">
          {/* Status Banner */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-xl ${
              notificationSubscribed 
                ? 'bg-accent/50 border border-primary/20' 
                : 'bg-muted/40 border border-border'
            }`}
          >
            <div className="flex items-center gap-3">
              {notificationSubscribed ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Push Notifications Active</p>
                    <p className="text-sm text-muted-foreground">You'll receive order alerts on this device</p>
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Push Notifications Off</p>
                    <p className="text-sm text-muted-foreground">Enable to get instant order alerts</p>
                  </div>
                </>
              )}
            </div>
          </motion.div>

          {/* Toggle Switch */}
          {isProductionDomain && notificationSupported && (
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/40">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="font-medium">Order Push Notifications</p>
                  <p className="text-sm text-muted-foreground">Browser push alerts for new orders</p>
                </div>
              </div>
              {notificationLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Switch
                  checked={notificationSubscribed}
                  onCheckedChange={handleNotificationToggle}
                  disabled={notificationLoading}
                />
              )}
            </div>
          )}

          {/* Enable Button for easier access */}
          {isProductionDomain && notificationSupported && !notificationSubscribed && (
            <Button 
              onClick={() => handleNotificationToggle(true)}
              disabled={notificationLoading}
              className="w-full h-11 rounded-xl "
            >
              {notificationLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enabling...
                </>
              ) : (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  Enable Push Notifications
                </>
              )}
            </Button>
          )}

          {/* Not on production domain warning */}
          {!isProductionDomain && (
            <div className="p-4 rounded-xl bg-muted/40 border border-border">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-sm text-foreground/80">
                  Push notifications work on your live site, not on {window.location.hostname}.
                </p>
              </div>
            </div>
          )}

          {/* Browser not supported warning */}
          {!notificationSupported && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/25">
              <div className="flex items-start gap-3">
                <BellOff className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-sm text-destructive">
                  Your browser doesn't support push notifications. Try Chrome, Firefox, or Edge.
                </p>
              </div>
            </div>
          )}

          {/* How it works - Collapsible */}
          <details className="group">
            <summary className="flex items-center justify-between cursor-pointer p-4 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors">
              <span className="font-medium">How push notifications work</span>
              <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="mt-3 space-y-3 pl-3">
              {[
                { step: "1", text: "Customer places an order via QR menu" },
                { step: "2", text: "You get instant push notification on this device" },
                { step: "3", text: "Tap notification to view order in dashboard" },
              ].map((item) => (
                <div key={item.step} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-semibold text-accent-foreground tabular-nums">{item.step}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.text}</p>
                </div>
              ))}
            </div>
          </details>

          {/* Note about in-app notifications */}
          <p className="text-sm text-muted-foreground text-center">
            In-app order notifications always work. Push notifications are for when you're not on the dashboard.
          </p>
        </CardContent>
      </Card>

      {/* Theme Settings Card */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
              {dashboardTheme === 'dark' ? (
                <Moon className="h-6 w-6 text-primary" />
              ) : dashboardTheme === 'light' ? (
                <Sun className="h-6 w-6 text-primary" />
              ) : (
                <Monitor className="h-6 w-6 text-primary" />
              )}
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">Appearance</CardTitle>
              <CardDescription className="text-sm">
                Customize dashboard theme (doesn't affect customer menu)
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-0 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {/* Light Mode */}
            <button
              onClick={() => handleThemeChange('light')}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                dashboardTheme === 'light'
                  ? 'border-primary bg-accent/40'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                dashboardTheme === 'light' ? 'bg-accent' : 'bg-muted'
              }`}>
                <Sun className={`h-5 w-5 ${dashboardTheme === 'light' ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <span className={`text-sm font-medium ${dashboardTheme === 'light' ? 'text-primary' : ''}`}>Light</span>
            </button>

            {/* Dark Mode */}
            <button
              onClick={() => handleThemeChange('dark')}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                dashboardTheme === 'dark'
                  ? 'border-primary bg-accent/40'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                dashboardTheme === 'dark' ? 'bg-accent' : 'bg-muted'
              }`}>
                <Moon className={`h-5 w-5 ${dashboardTheme === 'dark' ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <span className={`text-sm font-medium ${dashboardTheme === 'dark' ? 'text-primary' : ''}`}>Dark</span>
            </button>

            {/* System Mode */}
            <button
              onClick={() => handleThemeChange('system')}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                dashboardTheme === 'system'
                  ? 'border-primary bg-accent/40'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                dashboardTheme === 'system' ? 'bg-accent' : 'bg-muted'
              }`}>
                <Monitor className={`h-5 w-5 ${dashboardTheme === 'system' ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <span className={`text-sm font-medium ${dashboardTheme === 'system' ? 'text-primary' : ''}`}>System</span>
            </button>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            This setting only affects the dashboard. Customer menu has its own theme.
          </p>
        </CardContent>
      </Card>

      {/* Business Type Card */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
              {businessType === 'hotel' ? (
                <Hotel className="h-6 w-6 text-primary" />
              ) : (
                <Building2 className="h-6 w-6 text-primary" />
              )}
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">Business Type</CardTitle>
              <CardDescription className="text-sm">
                Choose Restaurant or Hotel mode
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Restaurant Option */}
            <button
              onClick={() => handleBusinessTypeChange('restaurant')}
              disabled={businessTypeSaving}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                businessType === 'restaurant'
                  ? 'border-primary bg-accent/40'
                  : 'border-border hover:border-primary/40'
              } ${businessTypeSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                businessType === 'restaurant' ? 'bg-accent' : 'bg-muted'
              }`}>
                <Building2 className={`h-5 w-5 ${businessType === 'restaurant' ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <div className="text-center">
                <span className={`text-sm font-medium block ${businessType === 'restaurant' ? 'text-primary' : ''}`}>Restaurant</span>
                <span className="text-xs text-muted-foreground">Table Number</span>
              </div>
            </button>

            {/* Hotel Option */}
            <button
              onClick={() => handleBusinessTypeChange('hotel')}
              disabled={businessTypeSaving}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                businessType === 'hotel'
                  ? 'border-primary bg-accent/40'
                  : 'border-border hover:border-primary/40'
              } ${businessTypeSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                businessType === 'hotel' ? 'bg-accent' : 'bg-muted'
              }`}>
                <Hotel className={`h-5 w-5 ${businessType === 'hotel' ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <div className="text-center">
                <span className={`text-sm font-medium block ${businessType === 'hotel' ? 'text-primary' : ''}`}>Hotel</span>
                <span className="text-xs text-muted-foreground">Room Number</span>
              </div>
            </button>
          </div>

          {businessTypeSaving && (
            <div className="flex items-center justify-center gap-2 text-sm text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Saving and reloading...</span>
            </div>
          )}

          <p className="text-sm text-muted-foreground text-center">
            Changes "Table Number" to "Room Number" throughout the app
          </p>
        </CardContent>
      </Card>

      {/* Business Type Confirmation Dialog */}
      <AlertDialog open={showBusinessTypeDialog} onOpenChange={setShowBusinessTypeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-primary" />
              Confirm Business Type Change
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>
                You are about to change your business type from{" "}
                <strong>{businessType === 'restaurant' ? 'Restaurant' : 'Hotel'}</strong> to{" "}
                <strong>{pendingBusinessType === 'restaurant' ? 'Restaurant' : 'Hotel'}</strong>.
              </p>
              <p className="text-accent-foreground font-medium">
                This will change all "{businessType === 'restaurant' ? 'Table' : 'Room'}" labels to "{pendingBusinessType === 'restaurant' ? 'Table' : 'Room'}" throughout your dashboard and customer menu.
              </p>
              <div className="space-y-2">
                <Label htmlFor="confirm-text" className="text-sm font-medium">
                  Type <span className="font-bold text-primary">CONFIRM</span> to proceed:
                </Label>
                <Input
                  id="confirm-text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type CONFIRM"
                  className="font-mono"
                  autoComplete="off"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelBusinessTypeChange} disabled={businessTypeSaving}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBusinessTypeChange}
              disabled={businessTypeSaving || confirmText.toUpperCase() !== "CONFIRM"}
              className="bg-primary hover:bg-primary/90"
            >
              {businessTypeSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Changing...
                </>
              ) : (
                "Confirm Change"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RestaurantProfile;
