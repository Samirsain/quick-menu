import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { changeAdminPassword } from "@/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LogOut, Search, Shield, Power, PowerOff, BarChart3, Loader2, Key, Eye, EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Restaurant {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  logo_url: string | null;
  user_id: string;
}

const AdminDashboardWithSidebar = () => {
  const { session, logout, requireAuth } = useAdminAuth();
  const [activeTab, setActiveTab] = useState("restaurants");
  const [open, setOpen] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [filteredRestaurants, setFilteredRestaurants] = useState<Restaurant[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    restaurant: Restaurant | null;
    newStatus: boolean;
  }>({ open: false, restaurant: null, newStatus: false });
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const links = [
    {
      label: "Restaurants",
      href: "#restaurants",
      icon: <Shield className="text-neutral-700 dark:text-neutral-200 h-5 w-5 flex-shrink-0" />,
      onClick: () => setActiveTab("restaurants"),
    },
    {
      label: "Analytics",
      href: "#analytics",
      icon: <BarChart3 className="text-neutral-700 dark:text-neutral-200 h-5 w-5 flex-shrink-0" />,
      onClick: () => setActiveTab("analytics"),
    },
  ];

  useEffect(() => {
    if (!requireAuth()) return;
    fetchRestaurants();
    
    const channel = supabase
      .channel(`admin-restaurants-${session?.email}`, {
        config: {
          broadcast: { self: false },
          presence: { key: '' },
        }
      })
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "restaurants",
        },
        () => {
          setTimeout(() => {
            if (!document.hidden) {
              fetchRestaurants();
            }
          }, 500);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let filtered = restaurants;

    if (searchQuery) {
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((r) =>
        statusFilter === "active" ? r.is_active : !r.is_active
      );
    }

    setFilteredRestaurants(filtered);
  }, [restaurants, searchQuery, statusFilter]);

  const fetchRestaurants = async () => {
    try {
      const { data: restaurantsData, error } = await supabase
        .from("restaurants")
        .select("id, name, email, phone, is_active, created_at, logo_url, user_id")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setRestaurants(restaurantsData || []);
    } catch (error) {
      console.error("Error fetching restaurants:", error);
      toast({
        title: "Error",
        description: "Failed to load restaurants",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleStatus = (restaurant: Restaurant) => {
    setConfirmDialog({
      open: true,
      restaurant,
      newStatus: !restaurant.is_active,
    });
  };

  const confirmToggleStatus = async () => {
    const { restaurant, newStatus } = confirmDialog;
    if (!restaurant || !session) return;

    setRestaurants(prev => prev.map(r => 
      r.id === restaurant.id ? { ...r, is_active: newStatus } : r
    ));
    
    setConfirmDialog({ open: false, restaurant: null, newStatus: false });

    try {
      const { error } = await supabase.rpc("toggle_restaurant_status", {
        p_restaurant_id: restaurant.id,
        p_is_active: newStatus,
        p_admin_email: session.email,
      });

      if (error) throw error;

      toast({
        title: "Status updated",
        description: `${restaurant.name} is now ${newStatus ? "active" : "disabled"}`,
      });
    } catch (error) {
      console.error("Error toggling status:", error);
      
      setRestaurants(prev => prev.map(r => 
        r.id === restaurant.id ? { ...r, is_active: !newStatus } : r
      ));
      
      toast({
        title: "Error",
        description: "Failed to update status. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleChangePassword = async () => {
    if (!session?.email) return;
    
    if (newPassword.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "New passwords don't match", variant: "destructive" });
      return;
    }

    setPasswordLoading(true);
    try {
      const result = await changeAdminPassword(session.email, currentPassword, newPassword);
      if (result.success) {
        toast({ title: "Password Changed", description: "Your password has been updated successfully" });
        setPasswordDialog(false);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        toast({ title: "Error", description: result.error || "Failed to change password", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to change password", variant: "destructive" });
    } finally {
      setPasswordLoading(false);
    }
  };

  const stats = {
    total: restaurants.length,
    active: restaurants.filter((r) => r.is_active).length,
    disabled: restaurants.filter((r) => !r.is_active).length,
  };

  return (
    <div
      className={cn(
        "flex flex-col md:flex-row bg-gray-100 dark:bg-neutral-800 w-full flex-1 mx-auto border border-neutral-200 dark:border-neutral-700 overflow-hidden",
        "h-screen"
      )}
    >
      <Sidebar open={open} setOpen={setOpen} animate={false}>
        <SidebarBody className="justify-between gap-10" mobileTitle="Admin Panel">
          <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
            <Logo />
            <div className="mt-6 flex flex-col gap-1">
              {links.map((link, idx) => (
                <div key={idx} onClick={link.onClick}>
                  <SidebarLink link={link} className={cn("rounded-lg px-2 transition-colors", link.href === `#${activeTab}` ? "bg-white dark:bg-neutral-700 shadow-sm font-semibold" : "hover:bg-white/60 dark:hover:bg-neutral-700/50")} />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1 border-t border-neutral-200 dark:border-neutral-700 pt-4">
            <div
              onClick={() => setPasswordDialog(true)}
              className="flex items-center justify-start gap-2 group/sidebar py-2 px-2 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-md transition-colors"
            >
              <Key className="text-neutral-700 dark:text-neutral-200 h-5 w-5 flex-shrink-0" />
              <motion.span
                animate={{
                  display: "inline-block",
                  opacity: 1,
                }}
                className="text-neutral-700 dark:text-neutral-200 text-sm group-hover/sidebar:translate-x-1 transition duration-150 whitespace-pre inline-block !p-0 !m-0"
              >
                Change Password
              </motion.span>
            </div>
            <div
              onClick={logout}
              className="flex items-center justify-start gap-2 group/sidebar py-2 px-2 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 rounded-md transition-colors"
            >
              <LogOut className="text-red-600 dark:text-red-400 h-5 w-5 flex-shrink-0" />
              <motion.span
                animate={{
                  display: "inline-block",
                  opacity: 1,
                }}
                className="text-red-600 dark:text-red-400 text-sm group-hover/sidebar:translate-x-1 transition duration-150 whitespace-pre inline-block !p-0 !m-0"
              >
                Logout
              </motion.span>
            </div>
          </div>
        </SidebarBody>
      </Sidebar>

      <AdminContent 
        activeTab={activeTab}
        restaurants={filteredRestaurants}
        isLoading={isLoading}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        stats={stats}
        handleToggleStatus={handleToggleStatus}
        session={session}
      />

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog({ open: false, restaurant: null, newStatus: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Status Change</DialogTitle>
            <DialogDescription>
              Are you sure you want to {confirmDialog.newStatus ? "enable" : "disable"}{" "}
              <strong>{confirmDialog.restaurant?.name}</strong>?
              {!confirmDialog.newStatus && (
                <div className="mt-2 text-destructive">
                  This will prevent customers from accessing their menu and disable the restaurant owner's dashboard.
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog({ open: false, restaurant: null, newStatus: false })}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog.newStatus ? "default" : "destructive"}
              onClick={confirmToggleStatus}
            >
              {confirmDialog.newStatus ? "Enable" : "Disable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={passwordDialog} onOpenChange={(open) => {
        if (!open) {
          setPasswordDialog(false);
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Change Password
            </DialogTitle>
            <DialogDescription>
              Update your admin password
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Current Password</label>
              <div className="relative">
                <Input
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">New Password</label>
              <div className="relative">
                <Input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min 8 chars)"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Confirm New Password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword} disabled={passwordLoading}>
              {passwordLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Change Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

const Logo = () => {
  return (
    <div className="font-normal flex space-x-2 items-center text-sm text-black py-1 relative z-20">
      <div className="h-8 w-8 bg-gradient-to-br from-primary to-primary/60 rounded-full flex-shrink-0 flex items-center justify-center">
        <Shield className="h-5 w-5 text-white" />
      </div>
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="font-medium text-black dark:text-white whitespace-pre"
      >
        Admin Panel
      </motion.span>
    </div>
  );
};

const AdminContent = ({ 
  activeTab, 
  restaurants, 
  isLoading, 
  searchQuery, 
  setSearchQuery, 
  statusFilter, 
  setStatusFilter, 
  stats, 
  handleToggleStatus,
  session 
}: any) => {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="p-2 md:p-10 rounded-tl-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex flex-col gap-2 flex-1 w-full overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">{session?.email}</p>
        </div>

        {activeTab === "restaurants" && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <Card className="p-4 md:p-6">
                <div className="text-xs md:text-sm text-muted-foreground mb-1">Total</div>
                <div className="text-2xl md:text-3xl font-bold">{stats.total}</div>
              </Card>
              <Card className="p-4 md:p-6">
                <div className="text-xs md:text-sm text-muted-foreground mb-1">Active</div>
                <div className="text-2xl md:text-3xl font-bold text-green-600">{stats.active}</div>
              </Card>
              <Card className="p-4 md:p-6">
                <div className="text-xs md:text-sm text-muted-foreground mb-1">Disabled</div>
                <div className="text-2xl md:text-3xl font-bold text-red-600">{stats.disabled}</div>
              </Card>
            </div>

            {/* Search and Filter */}
            <Card className="p-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={statusFilter === "all" ? "default" : "outline"}
                    onClick={() => setStatusFilter("all")}
                  >
                    All
                  </Button>
                  <Button
                    variant={statusFilter === "active" ? "default" : "outline"}
                    onClick={() => setStatusFilter("active")}
                  >
                    Active
                  </Button>
                  <Button
                    variant={statusFilter === "disabled" ? "default" : "outline"}
                    onClick={() => setStatusFilter("disabled")}
                  >
                    Disabled
                  </Button>
                </div>
              </div>
            </Card>

            {/* Phones: one card per restaurant, so the on/off switch is always visible */}
            <div className="md:hidden space-y-3">
              {isLoading ? (
                <Card className="p-6 text-center text-muted-foreground">Loading...</Card>
              ) : restaurants.length === 0 ? (
                <Card className="p-6 text-center text-muted-foreground">No restaurants found</Card>
              ) : (
                restaurants.map((restaurant: Restaurant) => (
                  <Card key={restaurant.id} className="p-4">
                    <div className="flex items-center gap-3">
                      {restaurant.logo_url ? (
                        <img src={restaurant.logo_url} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">🍽️</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{restaurant.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{restaurant.email}</div>
                        <div className="text-xs text-muted-foreground">{restaurant.phone || "No phone"} · Joined {new Date(restaurant.created_at).toLocaleDateString()}</div>
                      </div>
                      <Switch checked={restaurant.is_active} onCheckedChange={() => handleToggleStatus(restaurant)} aria-label={restaurant.is_active ? "Disable restaurant" : "Enable restaurant"} />
                    </div>
                    <div className="mt-3">
                      <Badge variant={restaurant.is_active ? "default" : "destructive"}>
                        {restaurant.is_active ? <><Power className="h-3 w-3 mr-1" />Active</> : <><PowerOff className="h-3 w-3 mr-1" />Disabled</>}
                      </Badge>
                    </div>
                  </Card>
                ))
              )}
            </div>

            {/* Restaurant Table (tablet and up) */}
            <Card className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Restaurant</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : restaurants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No restaurants found
                      </TableCell>
                    </TableRow>
                  ) : (
                    restaurants.map((restaurant: Restaurant) => {
                      return (
                        <TableRow key={restaurant.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              {restaurant.logo_url ? (
                                <img
                                  src={restaurant.logo_url}
                                  alt={restaurant.name}
                                  className="w-10 h-10 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <span className="text-lg">🍽️</span>
                                </div>
                              )}
                              <div>
                                <div className="font-medium">{restaurant.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {new Date(restaurant.created_at).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{restaurant.email}</div>
                            <div className="text-xs text-muted-foreground">{restaurant.phone || "—"}</div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={restaurant.is_active ? "default" : "destructive"}
                            >
                              {restaurant.is_active ? (
                                <>
                                  <Power className="h-3 w-3 mr-1" />
                                  Active
                                </>
                              ) : (
                                <>
                                  <PowerOff className="h-3 w-3 mr-1" />
                                  Disabled
                                </>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Switch
                                checked={restaurant.is_active}
                                onCheckedChange={() => handleToggleStatus(restaurant)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {activeTab === "analytics" && (
          <div className="space-y-6">
            <Card className="p-6">
              <h2 className="text-2xl font-bold mb-4">Analytics</h2>
              <p className="text-muted-foreground">Analytics dashboard coming soon...</p>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboardWithSidebar;
