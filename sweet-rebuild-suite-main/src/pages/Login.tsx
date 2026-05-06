import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/utils/utils";
import { useAuth } from "@/contexts/AuthContext";
import { stagger, fadeUp, scaleIn } from "@/utils/animations";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState<string | null>(null);

  // If already logged in, redirect
  if (user) { navigate("/", { replace: true }); return null; }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username || !password) { setError("Please enter username and password."); return; }
    
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    
    if (!result.success) { setError(result.error || "Something went wrong"); return; }
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Ambient orbs */}
      <div className="absolute top-[-30%] left-[-20%] w-[700px] h-[700px] rounded-full bg-primary/6 blur-[200px] pointer-events-none animate-float" />
      <div className="absolute bottom-[-25%] right-[-15%] w-[600px] h-[600px] rounded-full bg-chart-3/5 blur-[180px] pointer-events-none animate-float" style={{ animationDelay: "3s" }} />
      <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] rounded-full bg-chart-2/4 blur-[140px] pointer-events-none animate-float" style={{ animationDelay: "5s" }} />

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="visible"
        className="w-full max-w-[420px] relative z-10"
      >
        {/* Logo & Branding */}
        <motion.div variants={scaleIn} className="text-center mb-10">
          <div className="relative inline-block">
            <div className="w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center mx-auto glow-primary animate-glow-pulse">
              <img src="/logo.png" alt="GST Billing" className="w-full h-full object-contain" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-success flex items-center justify-center">
              <span className="text-success-foreground text-[10px] font-bold">✓</span>
            </div>
          </div>
          <h1 className="text-3xl font-display font-bold gradient-text mt-6">GST Billing</h1>
          <p className="text-[13px] text-muted-foreground mt-2 tracking-wide">Professional Suite</p>
        </motion.div>

        {/* Login Card */}
        <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-8">
          
          <h2 className="text-lg font-display font-semibold text-foreground mb-1">
            Welcome back
          </h2>
          <p className="text-[13px] text-muted-foreground mb-6">
            Sign in to your account to continue
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div className="space-y-2">
              <label className={cn("text-[12px] font-medium transition-colors", focused === "user" ? "text-primary" : "text-muted-foreground")}>
                Username
              </label>
              <div className={cn("relative rounded-xl border transition-all", focused === "user" ? "border-primary/50 ring-2 ring-ring/20" : "border-border")}>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocused("user")} onBlur={() => setFocused(null)}
                  placeholder="Enter your username"
                  className="w-full h-11 px-4 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className={cn("text-[12px] font-medium transition-colors", focused === "pass" ? "text-primary" : "text-muted-foreground")}>
                Password
              </label>
              <div className={cn("relative rounded-xl border transition-all", focused === "pass" ? "border-primary/50 ring-2 ring-ring/20" : "border-border")}>
                <input type={showPw ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused("pass")} onBlur={() => setFocused(null)}
                  placeholder="Enter your password"
                  className="w-full h-11 px-4 pr-11 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[13px] text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3"
              >
                {error}
              </motion.div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading}
              className={cn("premium-btn-primary w-full h-12 text-[14px] font-semibold group", loading && "opacity-70")}>
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</>
              ) : (
                <>Sign In <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-muted-foreground">SECURED BY</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="flex items-center justify-center gap-6">
            {["256-bit SSL", "2FA Ready", "GDPR"].map((badge) => (
              <span key={badge} className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase">{badge}</span>
            ))}
          </div>
        </motion.div>

        <motion.p variants={fadeUp} className="text-center text-[11px] text-muted-foreground mt-8">
          © {new Date().getFullYear()} GST Billing Pro Suite · v2.0
        </motion.p>
      </motion.div>
    </div>
  );
}
