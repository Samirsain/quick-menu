import { cn } from "@/lib/utils";
import { Link, LinkProps } from "react-router-dom";
import React, { useState, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";

interface Links {
  label: string;
  href: string;
  icon: React.JSX.Element | React.ReactNode;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(
  undefined
);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export const SidebarProvider = ({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  const [openState, setOpenState] = useState(false);

  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const Sidebar = ({
  children,
  open,
  setOpen,
  animate,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  );
};

// mobileTitle: text in the phone top bar (the current page), mobileActions: buttons on its right
export const SidebarBody = ({ mobileTitle, mobileActions, ...props }: React.ComponentProps<typeof motion.div> & { mobileTitle?: string; mobileActions?: React.ReactNode }) => {
  return (
    <>
      <DesktopSidebar {...props} />
      <MobileSidebar {...props} title={mobileTitle} actions={mobileActions} />
    </>
  );
};

export const DesktopSidebar = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof motion.div>) => {
  const { open, setOpen, animate } = useSidebar();
  return (
    <motion.div
      className={cn(
        "h-full px-4 py-4 hidden md:flex md:flex-col bg-background w-[260px] flex-shrink-0",
        className
      )}
      animate={{
        width: animate ? (open ? "300px" : "60px") : "260px",
      }}
      onMouseEnter={() => animate && setOpen(true)}
      onMouseLeave={() => animate && setOpen(false)}
      {...props}
    >
      {children}
    </motion.div>
  );
};

export const MobileSidebar = ({
  className,
  children,
  title = "Dashboard",
  actions,
  ...props
}: any) => {
  const { open, setOpen } = useSidebar();
  return (
    <>
      <div
        className={cn(
          "min-h-14 px-4 pt-[env(safe-area-inset-top)] flex flex-row md:hidden items-center justify-between gap-2 bg-background/85 backdrop-blur-xl border-b border-border/80 w-full sticky top-0 z-50"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)} className="-ml-2 h-10 w-10 flex items-center justify-center rounded-full text-foreground active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Menu className="h-6 w-6" />
          </button>
          <span className="text-foreground font-semibold text-base truncate">{title}</span>
        </div>
        {actions && <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>}
        {/* Portal: this header has backdrop-blur, which makes it the containing block for `fixed` children,
            so without the portal the drawer and backdrop were only as tall as the header and the menu showed through the page */}
        {createPortal(<AnimatePresence>
          {open && (
            <>
              {/* Backdrop overlay */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-menu-hero/50 z-[99]"
                onClick={() => setOpen(false)}
              />
              {/* Sidebar panel */}
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "fixed h-full w-[280px] max-w-[85vw] inset-y-0 left-0 bg-background border-r border-border p-6 pt-[max(1.5rem,env(safe-area-inset-top))] z-[100] flex flex-col justify-between",
                  className
                )}
              >
                <button
                  type="button"
                  aria-label="Close menu"
                  className="absolute right-4 top-4 z-50 h-10 w-10 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-5 w-5" />
                </button>
                {children}
              </motion.div>
            </>
          )}
        </AnimatePresence>, document.body)}
      </div>
    </>
  );
};

export const SidebarLink = ({
  link,
  className,
  ...props
}: {
  link: Links;
  className?: string;
  props?: LinkProps;
}) => {
  const { open, animate } = useSidebar();
  return (
    <Link
      to={link.href}
      className={cn(
        "flex items-center justify-start gap-2 group/sidebar py-2",
        className
      )}
      {...props}
    >
      {link.icon}

      <motion.span
        animate={{
          display: animate ? (open ? "inline-block" : "none") : "inline-block",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="text-sm group-hover/sidebar:translate-x-0.5 transition duration-150 whitespace-pre inline-block !p-0 !m-0"
      >
        {link.label}
      </motion.span>
    </Link>
  );
};
