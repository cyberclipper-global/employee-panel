import "@/styles/globals.css";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { SidebarProvider } from "../context/SidebarContext";
import { UserInfoProvider } from "../context/UserInfoContext";
import { AuthProvider } from "../context/AuthContext";
import ProtectedRoute from "../components/ProtectedRoute";

// Thin bar at the top while the next page loads. The current page stays on
// screen (instead of a full-screen loader that unmounts it), and the bar
// only appears if loading takes longer than a moment.
function RouteProgress() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    const start = (url, { shallow } = {}) => {
      if (shallow || url === router.asPath) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(true), 120);
    };
    const done = () => { clearTimeout(timer.current); setVisible(false); };
    router.events.on("routeChangeStart", start);
    router.events.on("routeChangeComplete", done);
    router.events.on("routeChangeError", done);
    return () => {
      clearTimeout(timer.current);
      router.events.off("routeChangeStart", start);
      router.events.off("routeChangeComplete", done);
      router.events.off("routeChangeError", done);
    };
  }, [router]);
  if (!visible) return null;
  return (
    <div aria-hidden="true" style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 10000, overflow: "hidden", background: "rgba(22,163,74,0.15)" }}>
      <div style={{ height: "100%", width: "40%", background: "#16a34a", animation: "route-progress 0.9s ease-in-out infinite" }} />
      <style>{"@keyframes route-progress{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}"}</style>
    </div>
  );
}

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <SidebarProvider>
        <UserInfoProvider>
          <RouteProgress />
          <ProtectedRoute>
            <Component {...pageProps} />
          </ProtectedRoute>
        </UserInfoProvider>
      </SidebarProvider>
    </AuthProvider>
  );
}
