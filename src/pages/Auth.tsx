import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Eye, EyeOff, Loader2, ArrowRight, Check
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { isRateLimited, RATE_LIMITS, getClientFingerprint, isBlocked, sanitizeInput } from "@/lib/security";

const authSchema = z.object({
  email: z.string().email("Please enter a valid email address").max(254, "Email too long"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password too long"),
  name: z.string().min(2, "Restaurant name must be at least 2 characters").max(100, "Restaurant name too long").optional(),
});

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"signin" | "signup">(searchParams.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantDescription, setRestaurantDescription] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) navigate("/dashboard");
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetEmailSent(true);
      toast({ title: "Email Sent!", description: "Check your email for the reset link" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateLimitKey = `auth_${getClientFingerprint()}`;
    const blockStatus = isBlocked(rateLimitKey);
    if (blockStatus.blocked) {
      toast({ title: "Too many attempts", description: `Please wait ${Math.ceil(blockStatus.remainingMs / 60000)} minute(s)`, variant: "destructive" });
      return;
    }
    if (isRateLimited(rateLimitKey, RATE_LIMITS.auth)) {
      toast({ title: "Too many attempts", description: "Please wait a few minutes", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      // Only validate email format for sign-in, let Supabase handle password
      if (!email.trim()) {
        throw new Error("Please enter your email");
      }
      if (!password) {
        throw new Error("Please enter your password");
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
      if (data.user) {
        toast({ title: "Welcome back!", description: "Signed in successfully" });
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Free for every restaurant: create the account directly. The on_auth_user_created
  // trigger creates the restaurant row from the name in the user metadata.
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateLimitKey = `registration_${getClientFingerprint()}`;
    if (isBlocked(rateLimitKey).blocked || isRateLimited(rateLimitKey, { maxRequests: 3, windowMs: 600000, blockDurationMs: 1800000 })) {
      toast({ title: "Too many attempts", description: "Please wait before trying again", variant: "destructive" });
      return;
    }
    try {
      authSchema.parse({ email, password, name: restaurantName });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast({ title: "Validation Error", description: error.errors[0].message, variant: "destructive" });
      }
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { name: sanitizeInput(restaurantName), description: sanitizeInput(restaurantDescription) },
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) throw error;
      if (data.session) {
        toast({ title: "Account created!", description: "Welcome to QuickMenu" });
        navigate("/dashboard");
      } else {
        // Email confirmation is on: the user signs in after clicking the link
        toast({ title: "Check your email", description: "Click the link we sent to confirm your account, then sign in." });
        setActiveTab("signin");
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Logo component
  const Logo = () => (
    <img src="/icons/icon-192.png" alt="QuickMenu" className="w-16 h-16 rounded-2xl mx-auto mb-4 shadow-md" />
  );

  if (showForgotPassword) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50/50 via-white to-orange-50/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl border-0 bg-white/80 backdrop-blur">
          <CardContent className="p-8">
            <Logo />
            <h1 className="text-2xl font-bold text-center text-gray-900">QuickMenu</h1>
            <p className="text-gray-500 text-center mt-1 mb-6">Reset your password</p>

            {resetEmailSent ? (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 rounded-xl text-center">
                  <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-green-800 font-medium">Reset email sent!</p>
                  <p className="text-green-600 text-sm">Check your inbox for the reset link</p>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => { setShowForgotPassword(false); setResetEmailSent(false); }} 
                  className="w-full rounded-full h-11"
                >
                  Back to Sign In
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-gray-700 font-medium">Email</Label>
                  <Input 
                    type="email" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    placeholder="you@restaurant.com"
                    className="h-12 rounded-xl border-gray-200 focus:border-orange-500 focus:ring-orange-500"
                    required 
                  />
                </div>
                <Button 
                  type="submit" 
                  disabled={loading}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-full h-11"
                >
                  {loading ? "Sending..." : "Send Reset Link"}
                </Button>
                <button 
                  type="button" 
                  onClick={() => setShowForgotPassword(false)} 
                  className="w-full text-center text-gray-500 hover:text-orange-500 text-sm"
                >
                  ← Back to Sign In
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main auth screen (Sign In / Sign Up)
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50/50 via-white to-orange-50/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl border-0 bg-white/80 backdrop-blur">
        <CardContent className="p-8">
          <Logo />
          <h1 className="text-2xl font-bold text-center text-gray-900">QuickMenu</h1>
          <p className="text-gray-500 text-center mt-1 mb-6">Create your digital menu</p>

          {/* Tabs */}
          <div className="flex bg-gray-100 rounded-full p-1 mb-6">
            <button
              onClick={() => setActiveTab("signin")}
              className={`flex-1 py-2.5 rounded-full text-sm font-medium transition-all ${
                activeTab === "signin" 
                  ? "bg-white text-gray-900 shadow-sm" 
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => setActiveTab("signup")}
              className={`flex-1 py-2.5 rounded-full text-sm font-medium transition-all ${
                activeTab === "signup" 
                  ? "bg-white text-gray-900 shadow-sm" 
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Sign Up
            </button>
          </div>

          {activeTab === "signup" ? (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-gray-700 font-medium">Restaurant Name *</Label>
                <Input 
                  value={restaurantName} 
                  onChange={(e) => setRestaurantName(e.target.value)} 
                  placeholder="Your Restaurant"
                  className="h-12 rounded-xl border-gray-200 focus:border-orange-500 focus:ring-orange-500"
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700 font-medium">Description</Label>
                <Input 
                  value={restaurantDescription} 
                  onChange={(e) => setRestaurantDescription(e.target.value)} 
                  placeholder="Fine dining experience... (optional)"
                  className="h-12 rounded-xl border-gray-200 focus:border-orange-500 focus:ring-orange-500"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700 font-medium">Email *</Label>
                <Input 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  placeholder="you@restaurant.com"
                  className="h-12 rounded-xl border-gray-200 focus:border-orange-500 focus:ring-orange-500"
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700 font-medium">Password *</Label>
                <div className="relative">
                  <Input 
                    type={showPassword ? "text" : "password"} 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    placeholder="Min 8 characters"
                    className="h-12 rounded-xl border-gray-200 focus:border-orange-500 focus:ring-orange-500 pr-12"
                    required 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)} 
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <Button 
                type="submit" 
                disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-full h-12 text-base font-medium"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create free account <ArrowRight className="h-4 w-4 ml-2" /></>}
              </Button>
              <p className="text-center text-sm text-gray-500">
                By signing up, you agree to our{" "}
                <Link to="/terms" className="text-orange-500 hover:underline">Terms</Link>
                {" "}and{" "}
                <Link to="/privacy-policy" className="text-orange-500 hover:underline">Privacy Policy</Link>
              </p>
            </form>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-gray-700 font-medium">Email</Label>
                <Input 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  placeholder="you@restaurant.com"
                  className="h-12 rounded-xl border-gray-200 focus:border-orange-500 focus:ring-orange-500"
                  required 
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-gray-700 font-medium">Password</Label>
                  <button 
                    type="button" 
                    onClick={() => setShowForgotPassword(true)} 
                    className="text-sm text-orange-500 hover:text-orange-600 font-medium"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input 
                    type={showPassword ? "text" : "password"} 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    className="h-12 rounded-xl border-gray-200 focus:border-orange-500 focus:ring-orange-500 pr-12"
                    required 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)} 
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <Button 
                type="submit" 
                disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-full h-12 text-base font-medium"
              >
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Signing in...</> : "Sign In"}
              </Button>
            </form>
          )}

          <Link to="/" className="block text-center mt-6 text-gray-500 hover:text-orange-500 text-sm">
            ← Back to Home
          </Link>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
