import { useState, useEffect } from "react";
import { Hourglass } from "lucide-react";

interface RefreshTimerProps {
  intervalMs: number;
  lastRefresh: number;
  isActive?: boolean;
  compact?: boolean;
}

const RefreshTimer = ({ intervalMs, lastRefresh, isActive = true, compact = false }: RefreshTimerProps) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - lastRefresh;
      setProgress(Math.min(elapsed / intervalMs, 1));
    };

    tick();

    if (!isActive) {
      return;
    }

    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [isActive, lastRefresh, intervalMs]);

  const radius = compact ? 10 : 14;
  const size = compact ? 28 : 36;
  const half = size / 2;
  const strokeWidth = compact ? 2 : 2.5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * progress;

  if (compact) {
    return (
      <div className="shrink-0 relative flex items-center justify-center w-7 h-7 mr-7">
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={half} cy={half} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} />
          <circle
            cx={half} cy={half} r={radius} fill="none"
            stroke="hsl(var(--primary))" strokeWidth={strokeWidth}
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 500ms linear" }}
          />
        </svg>
        <Hourglass className="absolute h-2.5 w-2.5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center w-11 h-11 rounded-full bg-background/70 backdrop-blur-sm shadow-md">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={half}
          cy={half}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={half}
          cy={half}
          r={radius}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 500ms linear" }}
        />
      </svg>
      <Hourglass className="absolute h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
};

export default RefreshTimer;
