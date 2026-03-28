import { useState } from "react";
import { AlertTriangle, ArrowRight, BellRing, Briefcase, ChevronRight, Home, Loader2, MapPin, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import type { CommuteOption, CommutePlan } from "@/hooks/useCommutePlans";
import type { SavedPlace } from "@/lib/savedPlaces";

function formatMinutes(seconds: number, arrivingNow: string) {
  if (seconds <= 60) {
    return arrivingNow;
  }

  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function formatLeaveGuidance(option: CommuteOption, strings: ReturnType<typeof useAppPreferences>["strings"]) {
  if (option.guidance === "leave-now") {
    return strings.leaveNow;
  }

  if (option.guidance === "leave-soon") {
    return strings.leaveSoon;
  }

  return strings.leaveIn(formatMinutes(option.slackSeconds, strings.arrivingNow));
}

function getPlaceIcon(place: SavedPlace) {
  switch (place.kind) {
    case "home":
      return Home;
    case "work":
      return Briefcase;
    default:
      return MapPin;
  }
}

function getConfidenceClasses(confidence: CommuteOption["confidence"]) {
  switch (confidence) {
    case "high":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "medium":
      return "bg-amber-100 text-amber-900 border-amber-200";
    default:
      return "bg-rose-100 text-rose-900 border-rose-200";
  }
}

function getConfidenceLabel(confidence: CommuteOption["confidence"], strings: ReturnType<typeof useAppPreferences>["strings"]) {
  switch (confidence) {
    case "high":
      return strings.highConfidence;
    case "medium":
      return strings.mediumConfidence;
    default:
      return strings.lowConfidence;
  }
}

function getLikelyAlert(plan: CommutePlan | null, strings: ReturnType<typeof useAppPreferences>["strings"]) {
  if (!plan?.bestOption) {
    return null;
  }

  if (plan.bestOption.trafficImpact) {
    return {
      title: strings.commuteTrafficAlertTitle,
      description: strings.commuteTrafficAlertDescription(
        plan.origin.label,
        plan.destination.label,
        plan.bestOption.trafficImpact.label,
      ),
    };
  }

  if (plan.bestOption.confidence === "low") {
    return {
      title: strings.commuteRiskAlertTitle,
      description: plan.fallbackOption
        ? strings.commuteRiskAlertWithFallback(
            plan.origin.label,
            plan.destination.label,
            plan.bestOption.lineNumber,
            plan.fallbackOption.lineNumber,
          )
        : strings.commuteRiskAlert(plan.origin.label, plan.destination.label, plan.bestOption.lineNumber),
    };
  }

  return null;
}

export default function CommuteDashboard({
  plans,
  loading,
  hasEnoughPlaces,
  onOpenSettings,
  onSelectPlan,
  activePlanId,
  offsetTopClassName = "top-4",
}: {
  plans: CommutePlan[];
  loading: boolean;
  hasEnoughPlaces: boolean;
  onOpenSettings: () => void;
  onSelectPlan: (plan: CommutePlan) => void;
  activePlanId: string | null;
  offsetTopClassName?: string;
}) {
  const { strings } = useAppPreferences();
  const [open, setOpen] = useState(false);
  const likelyPlan = plans.find((plan) => plan.activeOrigin && plan.bestOption) ?? plans.find((plan) => plan.bestOption) ?? null;
  const likelyAlert = getLikelyAlert(likelyPlan, strings);
  const compactSummary = likelyPlan?.bestOption
    ? `${strings.line} ${likelyPlan.bestOption.lineNumber} • ${formatLeaveGuidance(likelyPlan.bestOption, strings)}`
    : loading
      ? strings.calculatingCommute
      : strings.noLiveJourney;

  if (!hasEnoughPlaces) {
    return (
      <div className={`absolute right-4 z-20 ${offsetTopClassName}`}>
        <Button
          variant="secondary"
          className="h-auto max-w-[min(15rem,calc(100vw-6rem))] justify-start rounded-full border bg-background/95 px-3 py-2 text-left shadow-lg backdrop-blur-sm"
          onClick={onOpenSettings}
        >
          <MapPin className="mr-2 h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {strings.commuteDashboardTitle}
            </span>
            <span className="block truncate text-sm font-semibold">{strings.addPlacesToStart}</span>
          </span>
        </Button>
      </div>
    );
  }

  return (
    <div className={`absolute right-4 z-20 ${offsetTopClassName}`}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="secondary"
            className="h-auto max-w-[min(18rem,calc(100vw-6rem))] items-start justify-start rounded-2xl border bg-background/95 px-3 py-2.5 text-left shadow-lg backdrop-blur-sm"
          >
            <div className="flex w-full items-start gap-3">
              <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                <Route className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {strings.commuteDashboardTitle}
                  </span>
                  {likelyPlan?.activeOrigin && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{strings.likelyNow}</Badge>}
                  {likelyAlert && <BellRing className="h-3.5 w-3.5 shrink-0 text-amber-700" />}
                </div>
                <div className="mt-1 flex items-start gap-2">
                  {loading && !likelyPlan?.bestOption ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : likelyAlert ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                  ) : null}
                  <span className="line-clamp-2 text-sm font-semibold leading-tight">{compactSummary}</span>
                </div>
                {likelyPlan && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {likelyPlan.origin.label} <ArrowRight className="mx-1 inline h-3 w-3" /> {likelyPlan.destination.label}
                  </p>
                )}
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
          </Button>
        </SheetTrigger>

        <SheetContent side="right" className="w-[min(26rem,calc(100vw-1rem))] overflow-y-auto border-l bg-background/98 p-0 backdrop-blur-sm">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>{strings.commuteDashboardTitle}</SheetTitle>
            <SheetDescription>
              {likelyAlert?.description || strings.commuteDashboardEmptyDescription}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-4">
            {likelyAlert && (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="flex items-start gap-3 p-3">
                  <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <p className="text-sm font-semibold text-amber-950">{likelyAlert.title}</p>
                    <p className="text-xs text-amber-900/80">{likelyAlert.description}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {plans.map((plan) => {
              const OriginIcon = getPlaceIcon(plan.origin);
              const DestinationIcon = getPlaceIcon(plan.destination);
              const isActionable = Boolean(plan.bestOption);
              const isActive = activePlanId === plan.id;

              if (plan.bestOption) {
                return (
                  <button
                    key={plan.id}
                    type="button"
                    className={`w-full rounded-lg border bg-background text-left shadow-sm transition-colors hover:bg-accent/20 ${isActive ? "border-primary ring-1 ring-primary/40" : ""}`}
                    onClick={() => {
                      onSelectPlan(plan);
                    }}
                  >
                    <CardHeader className="space-y-3 pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-sm font-semibold">{strings.commuteDashboardTitle}</CardTitle>
                        <div className="flex items-center gap-2">
                          {plan.activeOrigin && <Badge variant="secondary">{strings.likelyNow}</Badge>}
                          {isActive && <Badge>{strings.showingOnMap}</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <OriginIcon className="h-4 w-4 text-primary" />
                        <span className="truncate">{plan.origin.label}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <DestinationIcon className="h-4 w-4 text-primary" />
                        <span className="truncate">{plan.destination.label}</span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">{strings.bestOption}</p>
                            <p className="text-lg font-semibold">
                              {strings.line} {plan.bestOption.lineNumber}
                            </p>
                          </div>
                          <Badge className={getConfidenceClasses(plan.bestOption.confidence)} variant="outline">
                            {getConfidenceLabel(plan.bestOption.confidence, strings)}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium text-foreground">{formatLeaveGuidance(plan.bestOption, strings)}</p>
                        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                          <div>
                            <p className="font-medium text-foreground">{strings.walkToStop}</p>
                            <p>{formatMinutes(plan.bestOption.walkSeconds, strings.arrivingNow)}</p>
                            <p>{plan.bestOption.originStop.stop_name}</p>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{strings.vehicleToStop}</p>
                            <p>{formatMinutes(plan.bestOption.vehicleEtaSeconds, strings.arrivingNow)}</p>
                            <p>{strings.boardAt(plan.bestOption.originStop.stop_name)}</p>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {strings.getOffAt(plan.bestOption.destinationStop.stop_name)} • {strings.aboutStops(plan.bestOption.stopCount)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {strings.walkFromStop} {formatMinutes(plan.bestOption.destinationWalkSeconds, strings.arrivingNow)} • {plan.bestOption.destinationStop.stop_name}
                        </p>
                      </div>

                      {plan.fallbackOption && (
                        <div className="rounded-xl border border-dashed bg-background/50 p-3 text-xs">
                          <p className="font-medium text-foreground">{strings.fallbackOption}</p>
                          <p className="mt-1 text-muted-foreground">
                            {strings.line} {plan.fallbackOption.lineNumber} • {formatLeaveGuidance(plan.fallbackOption, strings)}
                          </p>
                        </div>
                      )}

                      {plan.bestOption.trafficImpact && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                            <div>
                              <p className="font-medium">{strings.trafficMayAffect}</p>
                              <p className="mt-1 text-amber-900/80">{plan.bestOption.trafficImpact.label}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className={`w-full rounded-md border px-3 py-2 text-center text-sm font-medium ${isActive ? "bg-primary text-primary-foreground" : "bg-background"}`}>
                        {isActive ? strings.showingOnMap : strings.showBoardingStop}
                      </div>
                    </CardContent>
                  </button>
                );
              }

              return (
                <Card
                  key={plan.id}
                  className={`border bg-background shadow-sm ${isActive ? "border-primary ring-1 ring-primary/40" : ""}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold">{strings.commuteDashboardTitle}</CardTitle>
                      <div className="flex items-center gap-2">
                        {plan.activeOrigin && <Badge variant="secondary">{strings.likelyNow}</Badge>}
                        {isActive && <Badge>{strings.showingOnMap}</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <OriginIcon className="h-4 w-4 text-primary" />
                      <span className="truncate">{plan.origin.label}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <DestinationIcon className="h-4 w-4 text-primary" />
                      <span className="truncate">{plan.destination.label}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {loading && !plan.bestOption && !plan.note ? (
                      <p className="text-sm text-muted-foreground">{strings.calculatingCommute}</p>
                    ) : plan.bestOption ? (
                      <>
                        <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">{strings.bestOption}</p>
                              <p className="text-lg font-semibold">
                                {strings.line} {plan.bestOption.lineNumber}
                              </p>
                            </div>
                            <Badge className={getConfidenceClasses(plan.bestOption.confidence)} variant="outline">
                              {getConfidenceLabel(plan.bestOption.confidence, strings)}
                            </Badge>
                          </div>
                          <p className="text-sm font-medium text-foreground">{formatLeaveGuidance(plan.bestOption, strings)}</p>
                          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                            <div>
                              <p className="font-medium text-foreground">{strings.walkToStop}</p>
                              <p>{formatMinutes(plan.bestOption.walkSeconds, strings.arrivingNow)}</p>
                              <p>{plan.bestOption.originStop.stop_name}</p>
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{strings.vehicleToStop}</p>
                              <p>{formatMinutes(plan.bestOption.vehicleEtaSeconds, strings.arrivingNow)}</p>
                              <p>{strings.boardAt(plan.bestOption.originStop.stop_name)}</p>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {strings.getOffAt(plan.bestOption.destinationStop.stop_name)} • {strings.aboutStops(plan.bestOption.stopCount)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {strings.walkFromStop} {formatMinutes(plan.bestOption.destinationWalkSeconds, strings.arrivingNow)} • {plan.bestOption.destinationStop.stop_name}
                          </p>
                        </div>

                        {plan.fallbackOption && (
                          <div className="rounded-xl border border-dashed bg-background/50 p-3 text-xs">
                            <p className="font-medium text-foreground">{strings.fallbackOption}</p>
                            <p className="mt-1 text-muted-foreground">
                              {strings.line} {plan.fallbackOption.lineNumber} • {formatLeaveGuidance(plan.fallbackOption, strings)}
                            </p>
                          </div>
                        )}

                        {plan.bestOption.trafficImpact && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                              <div>
                                <p className="font-medium">{strings.trafficMayAffect}</p>
                                <p className="mt-1 text-amber-900/80">{plan.bestOption.trafficImpact.label}</p>
                              </div>
                            </div>
                          </div>
                        )}

                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">{strings.noLiveJourney}</p>
                        <p className="mt-1">{plan.note || strings.noLiveJourneyDescription}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <Button variant="outline" className="w-full" onClick={onOpenSettings}>
              {strings.openSettings}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
