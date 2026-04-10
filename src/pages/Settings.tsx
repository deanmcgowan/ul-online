import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import SavedPlacesManager from "@/components/SavedPlacesManager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Trash2, ChevronUp, ChevronDown, Globe2, MapPinned, Route } from "lucide-react";
import { useFavoriteStops } from "@/hooks/useFavoriteStops";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { getStrings, resolveAppLanguage } from "@/lib/i18n";
import type { AppPreferences, LanguagePreference } from "@/lib/preferences";

const Settings = () => {
  const navigate = useNavigate();
  const { preferences, updatePreferences } = useAppPreferences();
  const { favorites, removeFavorite, reorderFavorites } = useFavoriteStops();
  const [draft, setDraft] = useState(preferences);

  const strings = useMemo(
    () => getStrings(resolveAppLanguage(draft.language)),
    [draft.language],
  );

  const systemLanguageLabel = resolveAppLanguage("system") === "sv-SE"
    ? strings.swedish
    : strings.britishEnglish;

  const updateDraft = <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = () => {
    updatePreferences(draft);
    navigate("/");
  };

  const walkRadius = ((draft.walkSpeed / 3.6) * draft.bufferMinutes * 60).toFixed(0);
  const maxWalkDistanceLabel = draft.maxWalkDistanceMeters >= 1000
    ? `${(draft.maxWalkDistanceMeters / 1000).toFixed(1)} km`
    : `${draft.maxWalkDistanceMeters} m`;

  const languageOptions: Array<{ value: LanguagePreference; label: string }> = [
    { value: "system", label: `${strings.systemDefault} (${systemLanguageLabel})` },
    { value: "en-GB", label: strings.britishEnglish },
    { value: "sv-SE", label: strings.swedish },
  ];

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.12),transparent_35%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.55))]">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="mb-4 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {strings.backToMap}
        </Button>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{strings.settings}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {strings.settingsDescription}
            </p>
          </div>
        </div>

        <Tabs defaultValue="journey" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-background/80 p-1 backdrop-blur-sm">
            <TabsTrigger value="journey" className="gap-2 py-2.5">
              <Route className="h-4 w-4" />
              {strings.journeyTab}
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-2 py-2.5">
              <MapPinned className="h-4 w-4" />
              {strings.mapTab}
            </TabsTrigger>
            <TabsTrigger value="app" className="gap-2 py-2.5">
              <Globe2 className="h-4 w-4" />
              {strings.appTab}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="journey">
            <Card className="border-white/50 bg-background/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>{strings.journeyCardTitle}</CardTitle>
                <CardDescription>{strings.journeyCardDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Reach section — buffer & walk speed work together */}
                <div className="space-y-5">
                  <div>
                    <div className="mb-3 flex items-baseline justify-between">
                      <label className="text-sm font-medium">{strings.bufferTime}</label>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {draft.bufferMinutes} min
                      </span>
                    </div>
                    <Slider
                      value={[draft.bufferMinutes]}
                      onValueChange={([value]) => updateDraft("bufferMinutes", value)}
                      min={1}
                      max={15}
                      step={1}
                    />
                  </div>

                  <div>
                    <div className="mb-3 flex items-baseline justify-between">
                      <label className="text-sm font-medium">{strings.walkSpeed}</label>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {draft.walkSpeed} km/h
                      </span>
                    </div>
                    <Slider
                      value={[draft.walkSpeed]}
                      onValueChange={([value]) => updateDraft("walkSpeed", value)}
                      min={1}
                      max={10}
                      step={0.5}
                    />
                  </div>

                  <div className="rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                    {strings.bufferTimeHint} <span className="font-medium text-foreground">{walkRadius} m</span>.
                  </div>
                </div>

                <Separator />

                {/* Stop filter */}
                <div>
                  <div className="mb-3 flex items-baseline justify-between">
                    <label className="text-sm font-medium">{strings.maxWalkDistance}</label>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {maxWalkDistanceLabel}
                    </span>
                  </div>
                  <Slider
                    value={[draft.maxWalkDistanceMeters]}
                    onValueChange={([value]) => updateDraft("maxWalkDistanceMeters", value)}
                    min={200}
                    max={2000}
                    step={100}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">{strings.maxWalkDistanceHint}</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="map">
            <Card className="border-white/50 bg-background/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>{strings.mapCardTitle}</CardTitle>
                <CardDescription>{strings.mapCardDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                <div>
                  <div className="mb-3 flex items-baseline justify-between">
                    <label className="text-sm font-medium">{strings.stopVisibilityZoom}</label>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {strings.stopVisibilityValue} {draft.stopVisibilityZoom}
                    </span>
                  </div>
                  <Slider
                    value={[draft.stopVisibilityZoom]}
                    onValueChange={([value]) => updateDraft("stopVisibilityZoom", value)}
                    min={10}
                    max={17}
                    step={1}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">{strings.stopVisibilityHint}</p>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-4">
                  <div>
                    <label htmlFor="high-accuracy-location" className="text-sm font-medium cursor-pointer">
                      {strings.highAccuracyLocation}
                    </label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {strings.highAccuracyHint}
                    </p>
                  </div>
                  <Switch
                    id="high-accuracy-location"
                    checked={draft.highAccuracyLocation}
                    onCheckedChange={(checked) => updateDraft("highAccuracyLocation", checked)}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="app">
            <Card className="border-white/50 bg-background/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>{strings.appCardTitle}</CardTitle>
                <CardDescription>{strings.appCardDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-0">
                {/* Language */}
                <div className="space-y-2 pb-6">
                  <label className="text-sm font-medium">{strings.language}</label>
                  <Select
                    value={draft.language}
                    onValueChange={(value) => updateDraft("language", value as LanguagePreference)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={strings.language} />
                    </SelectTrigger>
                    <SelectContent>
                      {languageOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{strings.languageHint}</p>
                </div>

                <Separator />

                {/* Saved places */}
                <div className="py-6">
                  <SavedPlacesManager />
                </div>

                <Separator />

                {/* Favourite stops */}
                <div className="pt-6">
                  <label className="mb-3 block text-sm font-medium">{strings.favouriteStops}</label>
                  {favorites.length > 0 ? (
                    <div className="overflow-hidden rounded-xl border bg-muted/20">
                      {favorites.map((fav, index) => (
                        <div key={fav.stop_id} className="flex items-center gap-2 border-b px-3 py-2.5 last:border-b-0">
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{fav.stop_name}</span>
                            <span className="block truncate text-xs text-muted-foreground">#{fav.stop_id}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={index === 0}
                              onClick={() => reorderFavorites(index, index - 1)}
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={index === favorites.length - 1}
                              onClick={() => reorderFavorites(index, index + 1)}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => removeFavorite(fav.stop_id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                      {strings.noFavouriteStops}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="sticky bottom-0 mt-6 pb-4 pt-4">
          <div className="rounded-2xl border bg-background/90 p-3 shadow-lg backdrop-blur-sm">
            <Button onClick={handleSave} className="h-11 w-full">
              {strings.saveAndReturn}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
