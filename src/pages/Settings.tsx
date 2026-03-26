import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { useFavoriteStops } from "@/hooks/useFavoriteStops";

const Settings = () => {
  const navigate = useNavigate();
  const { favorites, removeFavorite, reorderFavorites } = useFavoriteStops();

  const [walkSpeed, setWalkSpeed] = useState(
    parseFloat(localStorage.getItem("walkSpeed") || "4")
  );
  const [runSpeed, setRunSpeed] = useState(
    parseFloat(localStorage.getItem("runSpeed") || "9")
  );
  const [bufferMinutes, setBufferMinutes] = useState(
    parseFloat(localStorage.getItem("bufferMinutes") || "5")
  );

  const handleSave = () => {
    localStorage.setItem("walkSpeed", walkSpeed.toString());
    localStorage.setItem("runSpeed", runSpeed.toString());
    localStorage.setItem("bufferMinutes", bufferMinutes.toString());
    navigate("/");
  };

  const walkRadius = ((walkSpeed / 3.6) * bufferMinutes * 60).toFixed(0);
  const runRadius = ((runSpeed / 3.6) * bufferMinutes * 60).toFixed(0);

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="max-w-md mx-auto px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="mb-6 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to map
        </Button>

        <h1 className="text-2xl font-bold tracking-tight mb-8">Settings</h1>

        <div className="space-y-10">
          {/* Buffer time first — it controls what the circles mean */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <label className="text-sm font-medium">Buffer time</label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {bufferMinutes} min
              </span>
            </div>
            <Slider
              value={[bufferMinutes]}
              onValueChange={([v]) => setBufferMinutes(v)}
              min={1}
              max={15}
              step={1}
            />
            <p className="text-xs text-muted-foreground mt-2">
              The circles on the map show the distance you can cover in this time.
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-3">
              <label className="text-sm font-medium">Walk speed</label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {walkSpeed} km/h → {walkRadius} m in {bufferMinutes} min
              </span>
            </div>
            <Slider
              value={[walkSpeed]}
              onValueChange={([v]) => setWalkSpeed(v)}
              min={1}
              max={10}
              step={0.5}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>1 km/h</span>
              <span>10 km/h</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-3">
              <label className="text-sm font-medium">Run speed</label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {runSpeed} km/h → {runRadius} m in {bufferMinutes} min
              </span>
            </div>
            <Slider
              value={[runSpeed]}
              onValueChange={([v]) => setRunSpeed(v)}
              min={3}
              max={20}
              step={0.5}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>3 km/h</span>
              <span>20 km/h</span>
            </div>
          </div>

          {/* Favorite stops management */}
          {favorites.length > 0 && (
            <div>
              <label className="text-sm font-medium block mb-3">Favorite Stops</label>
              <div className="border rounded-lg divide-y">
                {favorites.map((fav, i) => (
                  <div key={fav.stop_id} className="flex items-center px-3 py-2.5 gap-2">
                    <span className="text-sm flex-1 truncate">{fav.stop_name}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={i === 0}
                        onClick={() => reorderFavorites(i, i - 1)}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={i === favorites.length - 1}
                        onClick={() => reorderFavorites(i, i + 1)}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => removeFavorite(fav.stop_id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleSave} className="w-full mt-4">
            Save & return to map
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
