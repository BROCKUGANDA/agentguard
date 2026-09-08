import { useState, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './components/layout/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConnectionBanner } from './components/ConnectionBanner';
import { ToastHost } from './components/ui/Toast';
import { Skeleton } from './components/ui/Skeleton';

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Agents = lazy(() => import('./pages/Agents').then((m) => ({ default: m.Agents })));
const Policies = lazy(() => import('./pages/Policies').then((m) => ({ default: m.Policies })));
const Audit = lazy(() => import('./pages/Audit').then((m) => ({ default: m.Audit })));
const Alerts = lazy(() => import('./pages/Alerts').then((m) => ({ default: m.Alerts })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));

function PageFallback(): JSX.Element {
  return (
    <div className="p-lg">
      <Skeleton variant="block" height={400} className="w-full" />
    </div>
  );
}

export function App(): JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ErrorBoundary>
      <ConnectionBanner />
      <div className="flex min-h-screen bg-bg">
        <Sidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Mobile hamburger — hidden on md+ where sidebar is always visible */}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="md:hidden fixed top-2 left-2 z-30 p-2 rounded-md bg-surface border border-border text-text"
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
          <Routes>
            <Route
              path="/"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>
                    <Home />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="/agents"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>
                    <Agents />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="/policies"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>
                    <Policies />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="/audit"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>
                    <Audit />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="/alerts"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>
                    <Alerts />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="/settings"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>
                    <Settings />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="*"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>
                    <Home />
                  </Suspense>
                </ErrorBoundary>
              }
            />
          </Routes>
        </div>
      </div>
      <ToastHost />
    </ErrorBoundary>
  );
}

export default App;
