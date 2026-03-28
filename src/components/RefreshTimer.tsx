import { useState, useEffect } from "react";
import { Hourglass } from "lucide-react";

interface RefreshTimerProps {
  intervalMs: number;
  lastRefresh: number;
}

const RefreshTimer = ({ intervalMs, lastRefresh }: RefreshTimerProps) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - lastRefresh;
      setProgress(Math.min(elapsed / intervalMs, 1));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [lastRefresh, intervalMs]);

  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * progress;

  return (
    <div className="flex items-center justify-center w-11 h-11 rounded-full bg-background/70 backdrop-blur-sm shadow-md">
      <svg width="36" height="36" className="-rotate-90">
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="2.5"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
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
