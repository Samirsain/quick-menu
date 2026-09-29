import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Leaf, QrCode, BellRing, ListChecks } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;
const rise = (delay: number) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: EASE, delay },
});

// The three beats the demo video walks through
const STEPS = [
  { icon: QrCode, title: "Scan", body: "Guests open your menu from the QR code on the table. No app to download." },
  { icon: BellRing, title: "Order", body: "Orders land on the kitchen screen instantly, with a bell." },
  { icon: ListChecks, title: "Eat", body: "Guests watch their order go from Sent to Ready on their phone." },
];

const Landing = () => (
  <div className="min-h-screen bg-menu-bg text-menu-ink antialiased relative overflow-x-clip">
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(60%_60%_at_50%_0%,rgb(var(--menu-tint))_0%,transparent_70%)]" />
    {/* Nav */}
    <header className="relative max-w-6xl mx-auto px-4 lg:px-8 h-20 flex items-center gap-6">
      <Link to="/" className="flex items-center gap-2.5 mr-auto">
        <span className="h-10 w-10 rounded-full bg-menu-tint text-menu-accent flex items-center justify-center">
          <Leaf className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="font-display text-[24px] tracking-tight">QuickMenu</span>
      </Link>
      <nav className="hidden sm:flex items-center gap-6 text-[15px] text-menu-ink/70">
        <Link to="/pricing" className="hover:text-menu-ink transition-colors">Pricing</Link>
        <Link to="/about" className="hover:text-menu-ink transition-colors">About</Link>
      </nav>
      <Link to="/auth" className="text-[15px] font-medium text-menu-accent-2 hover:underline underline-offset-4">Log in</Link>
    </header>

    {/* Hero */}
    <main className="relative">

      <section className="relative max-w-6xl mx-auto px-4 lg:px-8 pt-10 sm:pt-16 text-center">
        <motion.p {...rise(0)} className="text-[12px] font-semibold uppercase tracking-[0.24em] text-menu-accent">
          QR menu &amp; ordering for restaurants
        </motion.p>
        <motion.h1 {...rise(0.08)} className="mt-5 font-display font-medium text-[56px] sm:text-[88px] lg:text-[112px] leading-[0.95] tracking-[-0.03em]">
          Scan<span className="text-menu-accent">.</span> Order<span className="text-menu-accent">.</span> Eat<span className="text-menu-accent">.</span>
        </motion.h1>
        <motion.p {...rise(0.16)} className="mt-6 mx-auto max-w-2xl text-[17px] sm:text-[20px] leading-relaxed text-menu-muted">
          Your whole menu, one scan away. Guests order from the table, the kitchen gets it instantly, and everyone sees every step.
        </motion.p>
        <motion.div {...rise(0.24)} className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/auth"
            className="h-14 px-8 rounded-2xl bg-gradient-to-r from-menu-accent to-menu-accent-2 text-[#FBF4EA] text-[16px] font-semibold flex items-center gap-2 shadow-[0_18px_40px_-16px_rgba(138,58,30,0.75)] hover:brightness-105 active:scale-[0.99] transition"
          >
            Get started <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </Link>
          <Link
            to="/pricing"
            className="h-14 px-8 rounded-2xl border border-menu-line bg-menu-card text-[16px] font-semibold flex items-center hover:border-menu-accent/40 transition-colors"
          >
            See pricing
          </Link>
        </motion.div>
        <motion.p {...rise(0.3)} className="mt-5 text-[13px] text-menu-muted">Plans from ₹599/month · Set up in under 5 minutes</motion.p>

        {/* Demo video */}
        <motion.div
          initial={{ opacity: 0, y: 48, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1, ease: EASE, delay: 0.35 }}
          className="mt-14 sm:mt-16 mx-auto max-w-5xl rounded-[20px] sm:rounded-[28px] overflow-hidden border border-menu-line bg-menu-card shadow-[0_40px_100px_-40px_rgba(43,29,20,0.55)]"
        >
          {/* Muted so browsers allow autoplay; the controls let visitors turn the music on */}
          <video
            src="/quickmenu-demo.mp4"
            poster="/quickmenu-demo.jpg"
            className="block w-full aspect-video"
            autoPlay
            muted
            loop
            playsInline
            controls
            preload="metadata"
            aria-label="QuickMenu demo: a guest scans the table QR code, orders, the kitchen accepts it, and the guest sees it ready"
          />
        </motion.div>
      </section>

      {/* The three beats */}
      <section className="relative max-w-5xl mx-auto px-4 lg:px-8 mt-16 sm:mt-20 grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, ease: EASE, delay: i * 0.08 }}
            className="rounded-[20px] bg-menu-card border border-menu-line/70 p-6 text-left"
          >
            <span className="h-11 w-11 rounded-full bg-menu-tint text-menu-accent flex items-center justify-center">
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h2 className="mt-4 font-display text-[24px]">{title}</h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-menu-muted">{body}</p>
          </motion.div>
        ))}
      </section>
    </main>

    {/* Footer: policy links must stay reachable from the home page (Razorpay verification) */}
    <footer className="mt-20 sm:mt-24 border-t border-menu-line">
      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-8 flex flex-col sm:flex-row items-center gap-4 text-[13px] text-menu-muted">
        <span>© {new Date().getFullYear()} QuickMenu</span>
        <nav className="sm:ml-auto flex flex-wrap justify-center gap-x-5 gap-y-2">
          {[["/terms", "Terms"], ["/privacy-policy", "Privacy"], ["/refund-policy", "Refunds"], ["/shipping-policy", "Shipping"], ["/contact", "Contact"]].map(([to, label]) => (
            <Link key={to} to={to} className="hover:text-menu-ink transition-colors">{label}</Link>
          ))}
        </nav>
      </div>
    </footer>
  </div>
);

export default Landing;
