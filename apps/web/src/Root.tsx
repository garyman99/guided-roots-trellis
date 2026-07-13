/**
 * Path-based entry router. Navigation between surfaces is intentionally
 * full-page (plain anchors, location.assign): the lab experience reads its
 * query params at module load, and the simulator/recorder tooling enters at
 * "/?lab=…" — both keep working untouched.
 *
 * Routes:
 *   /          landing page (marketing). LEGACY ENTRY: "/?lab=…" or
 *              "/?ui=…" boots the desktop experience directly and ungated —
 *              the scenario tooling in tools/recorder depends on it.
 *   /home      post-login launcher (auth required)
 *   /lab       the desktop experience (auth required); ?lab=<id> selects
 *   /admin     operator surface (auth + admin flag required)
 *   /callback  Auth0 redirect target
 */
import { useEffect, useState } from "react";
import { App } from "./App.tsx";
import { completeLogin, isAdmin, isAuthenticated } from "./auth.ts";
import { Landing } from "./pages/Landing.tsx";
import { Home } from "./pages/Home.tsx";
import { Admin } from "./pages/Admin.tsx";

export function Root() {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);

  // Legacy tooling entry: the desktop experience at "/", selected by params.
  if (path === "/" && (query.has("lab") || query.has("ui"))) return <App />;

  if (path === "/callback") return <Callback />;
  if (path === "/home") return requireAuth(<Home />);
  if (path === "/lab") return requireAuth(<App />);
  if (path === "/admin") return requireAdmin(<Admin />);
  return <Landing />;
}

function requireAuth(page: JSX.Element): JSX.Element | null {
  if (!isAuthenticated()) {
    window.location.replace("/");
    return null;
  }
  return page;
}

/** Non-admins land on /home — the admin surface simply doesn't exist for them. */
function requireAdmin(page: JSX.Element): JSX.Element | null {
  if (!isAuthenticated()) {
    window.location.replace("/");
    return null;
  }
  if (!isAdmin()) {
    window.location.replace("/home");
    return null;
  }
  return page;
}

/** Auth0 lands here; finish the code exchange, then move on. */
function Callback() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    completeLogin()
      .then((to) => window.location.replace(to))
      .catch((err) => setError(String(err instanceof Error ? err.message : err)));
  }, []);
  if (error) {
    return (
      <div className="boot-error">
        <p>Sign-in didn't complete: {error}</p>
        <a href="/">Back to the landing page</a>
      </div>
    );
  }
  return <div className="boot">Signing you in…</div>;
}
