import { useRef, useCallback, useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function BottomSheet({ open, onClose, children }: BottomSheetProps) {
  const isMobile = useIsMobile();
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const dragging = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    currentY.current = 0;
    dragging.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - startY.current;
    const scrollTop = scrollRef.current?.scrollTop ?? 0;

    if (!dragging.current && dy > 8 && scrollTop <= 0) {
      dragging.current = true;
      if (sheetRef.current) sheetRef.current.style.transition = "none";
    }

    if (dragging.current) {
      currentY.current = Math.max(0, dy);
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${currentY.current}px)`;
      }
      e.preventDefault();
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (sheetRef.current) {
      sheetRef.current.style.transition = "";
    }

    if (dragging.current && currentY.current > 100) {
      onClose();
    } else if (sheetRef.current) {
      sheetRef.current.style.transform = "";
    }

    dragging.current = false;
    currentY.current = 0;
  }, [onClose]);

  // Escape key to dismiss
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (isMobile) {
    // Mobile: bottom sheet slides up from bottom
    return (
      <div
        className={`fixed bottom-0 left-0 right-0 z-30 transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full pointer-events-none"
        }`}
      >
        <div
          ref={sheetRef}
          className="bg-background rounded-t-2xl shadow-2xl border border-b-0 max-h-[45dvh] flex flex-col"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>

          <button
            className="absolute top-2 right-3 text-muted-foreground hover:text-foreground p-1 rounded-full"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div
            ref={scrollRef}
            className="overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex-1 min-h-0"
          >
            {children}
          </div>
        </div>
      </div>
    );
  }

  // Desktop: side panel slides in from the left
  return (
    <div
      className={`fixed top-4 left-4 bottom-4 z-30 w-[22rem] transition-transform duration-300 ease-out ${
        open ? "translate-x-0" : "-translate-x-[calc(100%+2rem)] pointer-events-none"
      }`}
    >
      <div className="bg-background rounded-xl shadow-2xl border h-full flex flex-col">
        <div className="flex items-center justify-end px-3 pt-3 pb-1 shrink-0">
          <button
            className="text-muted-foreground hover:text-foreground p-1 rounded-full"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="overflow-y-auto px-4 pb-4 flex-1 min-h-0"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
