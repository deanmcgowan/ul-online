import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppPreferencesProvider, useAppPreferences } from "@/contexts/AppPreferencesContext";
import { Toaster } from "@/components/ui/toaster";
import InstallBanner from "@/components/InstallBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Index from "./pages/Index.tsx";
const Settings = lazy(() => import("./pages/Settings.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const RouteFallback = () => {
  const { strings } = useAppPreferences();

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">
      {strings.loading}
    </div>
  );
};

const AppRoutes = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Index />} />
      <Route
        path="/settings"
        element={
          <Suspense fallback={<RouteFallback />}>
            <Settings />
          </Suspense>
        }
      />
      <Route
        path="*"
        element={
          <Suspense fallback={<RouteFallback />}>
            <NotFound />
          </Suspense>
        }
      />
    </Routes>
  </BrowserRouter>
);

const App = () => (
  <ErrorBoundary>
    <AppPreferencesProvider>
      <AppRoutes />
      <Toaster />
      <InstallBanner />
    </AppPreferencesProvider>
  </ErrorBoundary>
);

export default App;
