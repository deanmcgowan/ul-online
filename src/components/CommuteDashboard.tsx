import { useState } from "react";
import { AlertTriangle, ArrowRight, Bell, BellOff, BellRing, Briefcase, Bus, ChevronDown, ChevronRight, Footprints, GraduationCap, Home, Loader2, MapPin, Navigation, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
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

function formatTripSummary(option: CommuteOption, strings: ReturnType<typeof useAppPreferences>["strings"]) {
  const transitLegs = option.legs.filter((l) => l.type === "JNY");
  const lineNames = transitLegs.map((l) => l.line ?? "?").join(" → ");
  if (option.departureTime) {
    return `${lineNames} • ${strings.departsAt(option.departureTime)}`;
  }
  return `${lineNames} • ${formatLeaveGuidance(option, strings)}`;
}

function formatChipLabel(option: CommuteOption) {
  if (option.departureTime) return option.departureTime;
  return `${Math.max(1, Math.round(option.vehicleEtaSeconds / 60))} min`;
}

function getPlaceIcon(place: SavedPlace) {
  switch (place.kind) {
    case "home":
      return Home;
    case "work":
      return Briefcase;
    case "school":
      return GraduationCap;
    default:
      return MapPin;
  }
}

function getOriginLabel(plan: CommutePlan, strings: ReturnType<typeof useAppPreferences>["strings"]) {
  if (plan.origin.id === "__current_location__") {
    return strings.yourLocation;
  }
  return plan.origin.label;
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

function TripOptionRow({
  option,
  label,
  expanded,
  onToggle,
  strings,
  destinationLabel,
  onNotify,
  notifyState,
}: {
  option: CommuteOption;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  strings: ReturnType<typeof useAppPreferences>["strings"];
  destinationLabel: string;
  onNotify: () => void;
  notifyState: "idle" | "scheduled" | "pending";
}) {
  const transitLegs = option.legs.filter((l) => l.type === "JNY");
  const lineNames = transitLegs.map((l) => l.line ?? "?").join(" → ");

  return (
    <div className="rounded-xl border bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-3 text-left"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        <Bus className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
            <Badge className={getConfidenceClasses(option.confidence)} variant="outline">
              {getConfidenceLabel(option.confidence, strings)}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm font-semibold">
            {lineNames} • {option.departureTime ?? formatChipLabel(option)}
            {option.durationMinutes != null && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {strings.totalDuration(option.durationMinutes)}
              </span>
            )}
          </p>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Notify button — only shown when there's a departure time to schedule from */}
      {option.departureTime && (
        <div className="border-t px-3 pb-2 pt-2">
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${notifyState === "scheduled" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            onClick={(e) => { e.stopPropagation(); onNotify(); }}
          >
            {notifyState === "scheduled" ? (
              <BellOff className="h-3.5 w-3.5 shrink-0" />
            ) : notifyState === "pending" ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <Bell className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{notifyState === "scheduled" ? strings.notifyCancel : strings.notifyWhenTimeToLeave}</span>
          </button>
        </div>
      )}

      {expanded && (
        <div className="space-y-1.5 border-t px-3 pb-3 pt-2 text-xs">
          {option.legs.map((leg, i) => (
            <div key={i} className="flex items-start gap-2">
              {leg.type === "JNY" ? (
                <Bus className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              ) : (
                <Footprints className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                {leg.type === "JNY" ? (
                  <p className="text-foreground">
                    <span className="font-semibold">{leg.line ?? leg.name}</span>
                    {leg.direction && <span className="text-muted-foreground"> → {leg.direction}</span>}
                  </p>
                ) : leg.type === "WALK" ? (
                  <p className="text-muted-foreground">{strings.walk}{leg.distMeters ? ` ${leg.distMeters} m` : ""}</p>
                ) : (
                  <p className="text-muted-foreground">{strings.transfer}</p>
                )}
                <p className="text-muted-foreground">
                  {leg.originTime && <span>{leg.originTime} {leg.originName}</span>}
                  {leg.destinationTime && <span> → {leg.destinationTime} {leg.destinationName}</span>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommuteDashboard({
  plans,
  loading,
  hasEnoughPlaces,
  onOpenSettings,
  onSelectPlan,
  activePlanId,
  hasLocation,
  offsetTopClassName = "top-4",
}: {
  plans: CommutePlan[];
  loading: boolean;
  hasEnoughPlaces: boolean;
  onOpenSettings: () => void;
  onSelectPlan: (plan: CommutePlan) => void;
  activePlanId: string | null;
  hasLocation: boolean;
  offsetTopClassName?: string;
}) {
  const { strings } = useAppPreferences();
  const [open, setOpen] = useState(false);
  const [expandedTripKey, setExpandedTripKey] = useState<string | null>(null);
  const [notifyPendingKey, setNotifyPendingKey] = useState<string | null>(null);
  const { state: pushState, activeNotification, scheduleNotification, cancelNotification } = usePushNotifications();
  const likelyPlan = plans.find((plan) => plan.activeOrigin && plan.bestOption) ?? plans.find((plan) => plan.bestOption) ?? null;
  const likelyAlert = getLikelyAlert(likelyPlan, strings);

  // Quick commute chips: plans with activeOrigin (from current location / near a place)
  const quickPlans = plans.filter((plan) => plan.activeOrigin);

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
    <div className={`absolute right-4 z-20 ${offsetTopClassName} flex flex-col pointer-events-none`}>
      {/* Full commute panel trigger */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="secondary"
            className="pointer-events-auto h-auto max-w-[min(18rem,calc(100vw-6rem))] items-start justify-start rounded-2xl border bg-background/95 px-3 py-2.5 text-left shadow-lg backdrop-blur-sm"
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
                  {likelyAlert && <BellRing className="h-3.5 w-3.5 shrink-0 text-amber-700" />}
                </div>
                <div className="mt-1 flex items-start gap-2">
                  {loading && !likelyPlan?.bestOption ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : likelyAlert ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                  ) : null}
                  <span className="line-clamp-2 text-sm font-semibold leading-tight">
                    {likelyPlan?.bestOption
                      ? formatTripSummary(likelyPlan.bestOption, strings)
                      : loading
                        ? strings.calculatingCommute
                        : strings.noLiveJourney}
                  </span>
                </div>
                {likelyPlan && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {getOriginLabel(likelyPlan, strings)} <ArrowRight className="mx-1 inline h-3 w-3" /> {likelyPlan.destination.label}
                  </p>
                )}
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
          </Button>
        </SheetTrigger>

        <SheetContent side="right" className="sheet-safe-top sheet-safe-bottom sheet-safe-right sheet-safe-height !w-[min(26rem,calc(100vw-2.5rem))] !border !rounded-2xl !p-0 flex flex-col shadow-2xl overflow-hidden">
          <SheetHeader className="shrink-0 border-b px-5 py-4">
            <SheetTitle>{strings.commuteDashboardTitle}</SheetTitle>
            <SheetDescription>
              {strings.commuteDashboardEmptyDescription}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 p-4">
            {plans.map((plan) => {
              const OriginIcon = plan.origin.id === "__current_location__" ? Navigation : getPlaceIcon(plan.origin);
              const DestinationIcon = getPlaceIcon(plan.destination);
              const isActive = activePlanId === plan.id;
              const originLabel = getOriginLabel(plan, strings);

              if (plan.bestOption) {
                return (
                  <div
                    key={plan.id}
                    className={`rounded-lg border bg-background shadow-sm ${isActive ? "border-primary ring-1 ring-primary/40" : ""}`}
                  >
                    <div className="space-y-2 px-4 pb-2 pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <OriginIcon className="h-4 w-4 text-primary" />
                          <span className="truncate">{originLabel}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <DestinationIcon className="h-4 w-4 text-primary" />
                          <span className="truncate">{plan.destination.label}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {plan.activeOrigin && <Badge variant="secondary" className="text-[10px]">{strings.likelyNow}</Badge>}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 px-4 pb-3">
                      <TripOptionRow
                        option={plan.bestOption}
                        label={strings.bestOption}
                        expanded={expandedTripKey === `${plan.id}:best`}
                        onToggle={() => setExpandedTripKey(expandedTripKey === `${plan.id}:best` ? null : `${plan.id}:best`)}
                        strings={strings}
                        destinationLabel={plan.destination.label}
                        notifyState={notifyPendingKey === `${plan.id}:best` ? "pending" : activeNotification?.id && scheduleNotification ? activeNotification.subscriptionId ? "scheduled" : "idle" : "idle"}
                        onNotify={() => {
                          const opt = plan.bestOption!;
                          const tripKey = `${plan.id}:best`;
                          if (activeNotification) {
                            cancelNotification();
                            return;
                          }
                          if (!opt.departureTime) return;
                          if (pushState === "blocked") { alert(strings.notificationsBlocked); return; }
                          if (pushState === "unsupported") { alert(strings.notificationsUnsupported); return; }
                          if (pushState === "install-required") { alert(strings.notifyInstallRequired); return; }
                          setNotifyPendingKey(tripKey);
                          const transitLegs = opt.legs.filter((l) => l.type === "JNY");
                          const lineNames = transitLegs.map((l) => l.line ?? "?").join(" → ");
                          scheduleNotification(
                            opt.departureTime,
                            opt.walkSeconds,
                            strings.notifyWhenTimeToLeave,
                            `${lineNames} ${strings.departsAt(opt.departureTime)} — ${plan.destination.label}`,
                          ).then((result) => {
                            setNotifyPendingKey(null);
                            if (result === "ok" && opt.departureTime) {
                              const [hh, mm] = opt.departureTime.split(":").map(Number);
                              const leaveAt = new Date();
                              leaveAt.setHours(hh, mm, 0, 0);
                              leaveAt.setSeconds(leaveAt.getSeconds() - opt.walkSeconds - 120);
                              alert(strings.notifyScheduled(`${String(leaveAt.getHours()).padStart(2, "0")}:${String(leaveAt.getMinutes()).padStart(2, "0")}`));
                            }
                          });
                        }}
                      />

                      {plan.fallbackOption && (
                        <TripOptionRow
                          option={plan.fallbackOption}
                          label={strings.nextDeparture}
                          expanded={expandedTripKey === `${plan.id}:next`}
                          onToggle={() => setExpandedTripKey(expandedTripKey === `${plan.id}:next` ? null : `${plan.id}:next`)}
                          strings={strings}
                          destinationLabel={plan.destination.label}
                          notifyState="idle"
                          onNotify={() => {}}
                        />
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

                      <button
                        type="button"
                        className={`w-full rounded-md border px-3 py-2 text-center text-sm font-medium ${isActive ? "bg-primary text-primary-foreground" : "bg-background"}`}
                        onClick={() => onSelectPlan(plan)}
                      >
                        {isActive ? strings.showingOnMap : strings.showBoardingStop}
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={plan.id}
                  className={`rounded-lg border bg-background p-4 shadow-sm ${isActive ? "border-primary ring-1 ring-primary/40" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <OriginIcon className="h-4 w-4 text-primary" />
                      <span className="truncate">{originLabel}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <DestinationIcon className="h-4 w-4 text-primary" />
                      <span className="truncate">{plan.destination.label}</span>
                    </div>
                    {plan.activeOrigin && <Badge variant="secondary" className="text-[10px]">{strings.likelyNow}</Badge>}
                  </div>
                  {loading && !plan.bestOption && !plan.note ? (
                    <p className="text-sm text-muted-foreground">{strings.calculatingCommute}</p>
                  ) : (
                    <div className="rounded-xl border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">{strings.noLiveJourney}</p>
                      <p className="mt-1">{plan.note || strings.noLiveJourneyDescription}</p>
                    </div>
                  )}
                </div>
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
