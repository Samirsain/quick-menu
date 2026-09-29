import { useEffect, useState, type ReactNode } from "react";
import { Download, Share, SquarePlus, MoreVertical } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { canPromptInstall, isIOS, isStandalone, onInstallStateChange, promptInstall } from "@/lib/pwa";

/**
 * "Install app" button. Hidden inside the installed app.
 * Chrome/Edge/Android: opens the browser's one-tap install dialog.
 * iPhone (no install API) and other browsers: shows how to add it to the home screen.
 */
export const InstallAppButton = ({ className = "", children }: { className?: string; children?: ReactNode }) => {
  const { toast } = useToast();
  const [, rerender] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => onInstallStateChange(() => rerender((n) => n + 1)), []);

  if (isStandalone()) return null;

  const install = async () => {
    if (canPromptInstall()) {
      const installed = await promptInstall();
      if (installed) toast({ title: "QuickMenu installed", description: "Open it from your home screen." });
    } else {
      setHelpOpen(true);
    }
  };

  const ios = isIOS();
  return (
    <>
      <button type="button" onClick={install} className={className}>
        {children ?? <><Download className="h-4 w-4" /> Install app</>}
      </button>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Install QuickMenu</DialogTitle>
            <DialogDescription>
              {ios ? "Add it to your home screen to use it like an app." : "Add it to your home screen or desktop to use it like an app."}
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            {(ios
              ? [
                  [<Share key="i" className="h-5 w-5" />, <>Open this page in <b>Safari</b> and tap the <b>Share</b> button</>],
                  [<SquarePlus key="i" className="h-5 w-5" />, <>Scroll down and tap <b>Add to Home Screen</b></>],
                  [<Download key="i" className="h-5 w-5" />, <>Tap <b>Add</b>. QuickMenu appears on your home screen</>],
                ]
              : [
                  [<MoreVertical key="i" className="h-5 w-5" />, <>Open your browser menu (<b>⋮</b> or <b>⋯</b>)</>],
                  [<Download key="i" className="h-5 w-5" />, <>Tap <b>Install app</b> or <b>Add to Home screen</b></>],
                  [<SquarePlus key="i" className="h-5 w-5" />, <>Open QuickMenu from your home screen or app list</>],
                ]
            ).map(([icon, text], i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#B0522C]/10 text-[#B0522C]">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
};
