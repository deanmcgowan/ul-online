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
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [lastRefresh, intervalMs]);

  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * progress;

  return (
    <div className="flex items-center justify-center w-8 h-8 relative">
      <svg width="28" height="28" className="-rotate-90">
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="2"
        />
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 200ms linear" }}
        />
      </svg>
      <Hourglass className="absolute h-3 w-3 text-muted-foreground" />
    </div>
  );
};

export default RefreshTimer;
