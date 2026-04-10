import { useState, useEffect } from "react";
import { Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";

const DISMISSED_KEY = "install-banner-dismissed";

function isIOS(): boolean {
  return /ipad|iphone|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).standalone === true
  );
}

export default function InstallBanner() {
  const { strings } = useAppPreferences();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show on iOS, only when not already installed, only if not previously dismissed
    if (isIOS() && !isInStandaloneMode() && !localStorage.getItem(DISMISSED_KEY)) {
      // Small delay so it doesn't flash on first paint
      const timer = window.setTimeout(() => setVisible(true), 3000);
      return () => window.clearTimeout(timer);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  return (
    <div className="fixed bottom-safe-6 left-safe-4 right-safe-4 z-50 mx-auto max-w-sm rounded-2xl border bg-background/95 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary shrink-0">
          <Share className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{strings.installBannerTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{strings.installBannerDescription}</p>
          <p className="mt-1.5 text-xs text-foreground/80">{strings.installBannerSteps}</p>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7 -mr-1 -mt-1" onClick={dismiss} aria-label={strings.installBannerDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
