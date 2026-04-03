import type { LanguagePreference } from "@/lib/preferences";

export type SupportedLanguage = "en-GB" | "sv-SE";

export interface AppStrings {
  appTitle: string;
  loading: string;
  settings: string;
  settingsDescription: string;
  backToMap: string;
  saveAndReturn: string;
  journeyTab: string;
  mapTab: string;
  appTab: string;
  journeyCardTitle: string;
  journeyCardDescription: string;
  mapCardTitle: string;
  mapCardDescription: string;
  appCardTitle: string;
  appCardDescription: string;
  bufferTime: string;
  bufferTimeHint: string;
  walkSpeed: string;
  maxWalkDistance: string;
  maxWalkDistanceHint: string;
  runSpeed: string;
  showSkolskjuts: string;
  highAccuracyLocation: string;
  highAccuracyHint: string;
  stopVisibilityZoom: string;
  stopVisibilityHint: string;
  stopVisibilityValue: string;
  language: string;
  languageHint: string;
  systemDefault: string;
  britishEnglish: string;
  swedish: string;
  favouriteStops: string;
  noFavouriteStops: string;
  filteringByStop: string;
  showFavouriteStops: string;
  openSettings: string;
  centerOnMyLocation: string;
  filterBuses: string;
  loadingBusDetails: string;
  nextLiveArrival: string;
  nextLiveArrivalLoading: string;
  nextLiveArrivalUnavailable: string;
  arrivingNow: string;
  timetableTime: (timeText: string) => string;
  headingTo: (placeText: string) => string;
  northSide: string;
  southSide: string;
  eastSide: string;
  westSide: string;
  inMinutes: (minutesText: string) => string;
  line: string;
  distance: string;
  pageNotFound: string;
  returnHome: string;
  loadingCachedData: string;
  checkingForUpdates: string;
  downloadingData: string;
  processingData: string;
  upToDate: string;
  updatedToLatest: string;
  updateCheckFailed: string;
  processingFailedSuffix: string;
  nearbyRoadSituations: string;
  nearbyRoadSituationsLoading: string;
  nearbyRoadSituationsSummary: (count: number) => string;
  roadSituationUntil: string;
  roadSituationUntilFurtherNotice: string;
  openSourceLink: string;
  savedPlaces: string;
  savedPlacesDescription: string;
  homePlace: string;
  workPlace: string;
  schoolPlace: string;
  otherPlace: string;
  savedPlaceMissing: string;
  setPlace: string;
  editPlace: string;
  otherPlaces: string;
  otherPlacesDescription: string;
  addPlace: string;
  noOtherPlaces: string;
  editSavedPlace: (kindLabel: string) => string;
  savedPlaceDialogDescription: string;
  placeLabel: string;
  placeSearchLabel: string;
  placeSearchPlaceholder: string;
  useCurrentLocation: string;
  placeSelected: string;
  searchingPlaces: string;
  noPlaceSearchResults: string;
  selectedPlace: string;
  savePlace: string;
  placeSearchError: string;
  currentLocationLabel: string;
  currentLocationError: string;
  commuteDashboardTitle: string;
  commuteDashboardEmptyTitle: string;
  commuteDashboardEmptyDescription: string;
  addPlacesToStart: string;
  likelyNow: string;
  calculatingCommute: string;
  bestOption: string;
  fallbackOption: string;
  walkToStop: string;
  walkFromStop: string;
  vehicleToStop: string;
  showBoardingStop: string;
  showingOnMap: string;
  commuteSelectionToastTitle: string;
  commuteSelectionToastDescription: (stopName: string, lineNumber: string) => string;
  boardAt: (stopName: string) => string;
  getOffAt: (stopName: string) => string;
  aboutStops: (count: number) => string;
  noLiveJourney: string;
  noLiveJourneyDescription: string;
  highConfidence: string;
  mediumConfidence: string;
  lowConfidence: string;
  leaveNow: string;
  leaveSoon: string;
  leaveIn: (minutesText: string) => string;
  trafficMayAffect: string;
  commuteTrafficAlertTitle: string;
  commuteTrafficAlertDescription: (origin: string, destination: string, incident: string) => string;
  commuteRiskAlertTitle: string;
  commuteRiskAlert: (origin: string, destination: string, lineNumber: string) => string;
  commuteRiskAlertWithFallback: (origin: string, destination: string, lineNumber: string, fallbackLine: string) => string;
  nextStops: string;
  noResults: string;
}

const STRINGS: Record<SupportedLanguage, AppStrings> = {
  "en-GB": {
    appTitle: "UL Bus Tracker",
    loading: "Loading...",
    settings: "Settings",
    settingsDescription: "Tune live tracking, map detail, and app language for this device.",
    backToMap: "Back to map",
    saveAndReturn: "Save and return to map",
    journeyTab: "Journey",
    mapTab: "Map",
    appTab: "App",
    journeyCardTitle: "Journey reach",
    journeyCardDescription: "Adjust the travel assumptions used for the reach circles and bus timing estimates.",
    mapCardTitle: "Map behaviour",
    mapCardDescription: "Control when stop markers appear and how location tracking behaves while the app is active.",
    appCardTitle: "App preferences",
    appCardDescription: "Language selection and saved favourites for this device.",
    bufferTime: "Buffer time",
    bufferTimeHint: "The circles on the map show the distance you can cover in this time.",
    walkSpeed: "Walking speed",
    maxWalkDistance: "Maximum walk to a stop",
    maxWalkDistanceHint: "The planner only considers stops within this distance from your saved places.",
    runSpeed: "Running speed",
    showSkolskjuts: "Show school transport stops",
    highAccuracyLocation: "High accuracy location",
    highAccuracyHint: "Uses more battery. Live tracking and GPS now pause completely when the app is hidden or inactive.",
    stopVisibilityZoom: "Show stop markers from zoom level",
    stopVisibilityHint: "Hide stop markers until the map is zoomed in enough to keep the map responsive and readable.",
    stopVisibilityValue: "Zoom level",
    language: "Language",
    languageHint: "System default follows your device language.",
    systemDefault: "System default",
    britishEnglish: "British English",
    swedish: "Svenska",
    favouriteStops: "Favourite stops",
    noFavouriteStops: "No favourite stops saved yet.",
    filteringByStop: "Filtering by stop",
    showFavouriteStops: "Show favourite stops",
    openSettings: "Open settings",
    centerOnMyLocation: "Centre on my location",
    filterBuses: "Filter buses",
    loadingBusDetails: "Loading bus details...",
    nextLiveArrival: "Next live arrival",
    nextLiveArrivalLoading: "Calculating live arrival...",
    nextLiveArrivalUnavailable: "No live arrival estimate is available right now.",
    arrivingNow: "Arriving now",
    timetableTime: (timeText) => `Timetable ${timeText}`,
    headingTo: (placeText) => `towards ${placeText}`,
    northSide: "north side",
    southSide: "south side",
    eastSide: "east side",
    westSide: "west side",
    inMinutes: (minutesText) => `in ${minutesText}`,
    line: "Line",
    distance: "Distance",
    pageNotFound: "Page not found",
    returnHome: "Return home",
    loadingCachedData: "Loading cached data",
    checkingForUpdates: "Checking for updates",
    downloadingData: "Downloading data",
    processingData: "Processing data",
    upToDate: "Already up to date",
    updatedToLatest: "Updated to the latest data",
    updateCheckFailed: "Update check failed, using cached data",
    processingFailedSuffix: "failed",
    nearbyRoadSituations: "Nearby road situations",
    nearbyRoadSituationsLoading: "Checking nearby road situations...",
    nearbyRoadSituationsSummary: (count) => `${count} active road event${count === 1 ? "" : "s"} near the map`,
    roadSituationUntil: "Until",
    roadSituationUntilFurtherNotice: "Until further notice",
    openSourceLink: "Open source",
    savedPlaces: "Saved places",
    savedPlacesDescription: "Save home, one work or school destination, and any extra places for faster commute suggestions.",
    homePlace: "Home",
    workPlace: "Work / school",
    schoolPlace: "Work / school",
    otherPlace: "Other",
    savedPlaceMissing: "Not set yet.",
    setPlace: "Set",
    editPlace: "Edit",
    otherPlaces: "Other places",
    otherPlacesDescription: "Optional places you travel to often.",
    addPlace: "Add place",
    noOtherPlaces: "No extra places saved yet.",
    editSavedPlace: (kindLabel) => `Edit ${kindLabel}`,
    savedPlaceDialogDescription: "Search for an address or use your current location to save this place.",
    placeLabel: "Place name",
    placeSearchLabel: "Search location",
    placeSearchPlaceholder: "Search for an address, place, or area",
    useCurrentLocation: "Use current location",
    placeSelected: "Place selected",
    searchingPlaces: "Searching places...",
    noPlaceSearchResults: "No places matched that search.",
    selectedPlace: "Selected place",
    savePlace: "Save place",
    placeSearchError: "Place search failed. Try another search.",
    currentLocationLabel: "Current location",
    currentLocationError: "Current location could not be used.",
    commuteDashboardTitle: "Commute now",
    commuteDashboardEmptyTitle: "Set up saved places",
    commuteDashboardEmptyDescription: "Add at least two saved places to see live place-to-place commute suggestions.",
    addPlacesToStart: "Add saved places",
    likelyNow: "Likely now",
    calculatingCommute: "Calculating live commute options...",
    bestOption: "Best option",
    fallbackOption: "Fallback",
    walkToStop: "Walk to stop",
    walkFromStop: "Walk from stop",
    vehicleToStop: "Bus to stop",
    showBoardingStop: "Show boarding stop on map",
    showingOnMap: "Showing on map",
    commuteSelectionToastTitle: "Boarding stop selected",
    commuteSelectionToastDescription: (stopName, lineNumber) => `Showing ${stopName} for line ${lineNumber} on the map.`,
    boardAt: (stopName) => `Board at ${stopName}`,
    getOffAt: (stopName) => `Get off at ${stopName}`,
    aboutStops: (count) => `about ${count} stop${count === 1 ? "" : "s"}`,
    noLiveJourney: "No live journey right now",
    noLiveJourneyDescription: "Try again in a moment or choose another saved place.",
    highConfidence: "High confidence",
    mediumConfidence: "Tight",
    lowConfidence: "Risky",
    leaveNow: "Leave now",
    leaveSoon: "Leave soon",
    leaveIn: (minutesText) => `Leave in ${minutesText}`,
    trafficMayAffect: "Traffic may affect this trip",
    commuteTrafficAlertTitle: "Journey alert",
    commuteTrafficAlertDescription: (origin, destination, incident) => `${origin} to ${destination} may be affected by ${incident}.`,
    commuteRiskAlertTitle: "Tight departure",
    commuteRiskAlert: (origin, destination, lineNumber) => `${origin} to ${destination} is tight for line ${lineNumber}.`,
    commuteRiskAlertWithFallback: (origin, destination, lineNumber, fallbackLine) => `${origin} to ${destination} is tight for line ${lineNumber}. Line ${fallbackLine} is the safer fallback.`,
    nextStops: "Next stops",
    noResults: "No information available.",
  },
  "sv-SE": {
    appTitle: "UL Busskarta",
    loading: "Laddar...",
    settings: "Inställningar",
    settingsDescription: "Justera liveuppdatering, kartdetaljer och språk för den här enheten.",
    backToMap: "Tillbaka till kartan",
    saveAndReturn: "Spara och gå tillbaka till kartan",
    journeyTab: "Resa",
    mapTab: "Karta",
    appTab: "App",
    journeyCardTitle: "Räckvidd",
    journeyCardDescription: "Ändra antagandena som används för räckviddscirklarna och tidsuppskattningarna.",
    mapCardTitle: "Kartbeteende",
    mapCardDescription: "Styr när hållplatsmarkörer visas och hur platsspårning ska fungera medan appen är aktiv.",
    appCardTitle: "Appinställningar",
    appCardDescription: "Språkval och sparade favoriter för den här enheten.",
    bufferTime: "Buffertid",
    bufferTimeHint: "Cirklarna på kartan visar hur långt du hinner på den här tiden.",
    walkSpeed: "Gånghastighet",
    maxWalkDistance: "Max gångavstånd till hållplats",
    maxWalkDistanceHint: "Planeraren tar bara med hållplatser inom det här avståndet från dina sparade platser.",
    runSpeed: "Löphastighet",
    showSkolskjuts: "Visa skolskjutshållplatser",
    highAccuracyLocation: "Hög platsnoggrannhet",
    highAccuracyHint: "Använder mer batteri. Liveuppdatering och GPS pausas nu helt när appen är dold eller inaktiv.",
    stopVisibilityZoom: "Visa hållplatsmarkörer från zoomnivå",
    stopVisibilityHint: "Dölj hållplatsmarkörer tills kartan är tillräckligt inzoomad för att vara snabb och lättläst.",
    stopVisibilityValue: "Zoomnivå",
    language: "Språk",
    languageHint: "Systemstandard följer enhetens språk.",
    systemDefault: "Systemstandard",
    britishEnglish: "Brittisk engelska",
    swedish: "Svenska",
    favouriteStops: "Favoritstopp",
    noFavouriteStops: "Inga favoritstopp har sparats än.",
    filteringByStop: "Filtrerar på hållplats",
    showFavouriteStops: "Visa favoritstopp",
    openSettings: "Öppna inställningar",
    centerOnMyLocation: "Centrera på min plats",
    filterBuses: "Filtrera bussar",
    loadingBusDetails: "Laddar bussdetaljer...",
    nextLiveArrival: "Nästa liveankomst",
    nextLiveArrivalLoading: "Beräknar liveankomst...",
    nextLiveArrivalUnavailable: "Ingen liveberäkning finns tillgänglig just nu.",
    arrivingNow: "Anländer nu",
    timetableTime: (timeText) => `Tidtabell ${timeText}`,
    headingTo: (placeText) => `mot ${placeText}`,
    northSide: "norra sidan",
    southSide: "södra sidan",
    eastSide: "östra sidan",
    westSide: "västra sidan",
    inMinutes: (minutesText) => `om ${minutesText}`,
    line: "Linje",
    distance: "Avstånd",
    pageNotFound: "Sidan hittades inte",
    returnHome: "Till startsidan",
    loadingCachedData: "Laddar cachelagrad data",
    checkingForUpdates: "Kontrollerar uppdateringar",
    downloadingData: "Hämtar data",
    processingData: "Bearbetar data",
    upToDate: "Redan uppdaterad",
    updatedToLatest: "Uppdaterad till senaste data",
    updateCheckFailed: "Uppdateringskontrollen misslyckades, använder cachelagrad data",
    processingFailedSuffix: "misslyckades",
    nearbyRoadSituations: "Väghändelser i närheten",
    nearbyRoadSituationsLoading: "Kontrollerar väghändelser i närheten...",
    nearbyRoadSituationsSummary: (count) => `${count} aktiva väghändelse${count === 1 ? "" : "r"} nära kartan`,
    roadSituationUntil: "Till",
    roadSituationUntilFurtherNotice: "Tills vidare",
    openSourceLink: "Öppna källa",
    savedPlaces: "Sparade platser",
    savedPlacesDescription: "Spara hem, en jobb- eller skolplats och andra platser för snabbare pendlingsförslag.",
    homePlace: "Hem",
    workPlace: "Jobb / skola",
    schoolPlace: "Jobb / skola",
    otherPlace: "Övrigt",
    savedPlaceMissing: "Inte inställd ännu.",
    setPlace: "Ange",
    editPlace: "Ändra",
    otherPlaces: "Övriga platser",
    otherPlacesDescription: "Valfria platser som du ofta reser till.",
    addPlace: "Lägg till plats",
    noOtherPlaces: "Inga extra platser sparade ännu.",
    editSavedPlace: (kindLabel) => `Ändra ${kindLabel.toLowerCase()}`,
    savedPlaceDialogDescription: "Sök efter en adress eller använd din nuvarande plats för att spara platsen.",
    placeLabel: "Platsnamn",
    placeSearchLabel: "Sök plats",
    placeSearchPlaceholder: "Sök efter adress, plats eller område",
    useCurrentLocation: "Använd nuvarande plats",
    placeSelected: "Plats vald",
    searchingPlaces: "Söker platser...",
    noPlaceSearchResults: "Inga platser matchade sökningen.",
    selectedPlace: "Vald plats",
    savePlace: "Spara plats",
    placeSearchError: "Platssökningen misslyckades. Försök igen.",
    currentLocationLabel: "Nuvarande plats",
    currentLocationError: "Nuvarande plats kunde inte användas.",
    commuteDashboardTitle: "Pendla nu",
    commuteDashboardEmptyTitle: "Ställ in sparade platser",
    commuteDashboardEmptyDescription: "Lägg till minst två sparade platser för att se liveförslag mellan platser.",
    addPlacesToStart: "Lägg till sparade platser",
    likelyNow: "Trolig nu",
    calculatingCommute: "Beräknar livealternativ...",
    bestOption: "Bästa alternativ",
    fallbackOption: "Reserv",
    walkToStop: "Gå till hållplats",
    walkFromStop: "Gå från hållplats",
    vehicleToStop: "Buss till hållplats",
    showBoardingStop: "Visa påstigningshållplats på kartan",
    showingOnMap: "Visas på kartan",
    commuteSelectionToastTitle: "Påstigningshållplats vald",
    commuteSelectionToastDescription: (stopName, lineNumber) => `Visar ${stopName} för linje ${lineNumber} på kartan.`,
    boardAt: (stopName) => `Gå på vid ${stopName}`,
    getOffAt: (stopName) => `Gå av vid ${stopName}`,
    aboutStops: (count) => `cirka ${count} hållplats${count === 1 ? "" : "er"}`,
    noLiveJourney: "Ingen liveavgång just nu",
    noLiveJourneyDescription: "Försök igen om en stund eller välj en annan sparad plats.",
    highConfidence: "Hög marginal",
    mediumConfidence: "Tajt",
    lowConfidence: "Riskfyllt",
    leaveNow: "Gå nu",
    leaveSoon: "Gå snart",
    leaveIn: (minutesText) => `Gå om ${minutesText}`,
    trafficMayAffect: "Trafiken kan påverka resan",
    commuteTrafficAlertTitle: "Resevarning",
    commuteTrafficAlertDescription: (origin, destination, incident) => `${incident} kan påverka resan från ${origin} till ${destination}.`,
    commuteRiskAlertTitle: "Tajt avgång",
    commuteRiskAlert: (origin, destination, lineNumber) => `Resan från ${origin} till ${destination} är tajt för linje ${lineNumber}.`,
    commuteRiskAlertWithFallback: (origin, destination, lineNumber, fallbackLine) => `Resan från ${origin} till ${destination} är tajt för linje ${lineNumber}. Linje ${fallbackLine} är ett säkrare reservval.`,
    nextStops: "Nästa hållplatser",
    noResults: "Ingen information tillgänglig.",
  },
};

export function resolveAppLanguage(
  preference: LanguagePreference,
  systemLanguages: readonly string[] = typeof navigator !== "undefined"
    ? [...navigator.languages, navigator.language].filter(Boolean)
    : ["en-GB"],
): SupportedLanguage {
  if (preference === "en-GB" || preference === "sv-SE") {
    return preference;
  }

  return systemLanguages.some((language) => language.toLowerCase().startsWith("sv"))
    ? "sv-SE"
    : "en-GB";
}

export function getStrings(language: SupportedLanguage): AppStrings {
  return STRINGS[language];
}