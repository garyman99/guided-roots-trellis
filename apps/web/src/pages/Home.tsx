/**
 * Post-login launcher. Front and center: launch the virtual desktop. Below:
 * curated scenario entries that open the desktop with a specific lab loaded.
 * Navigation to /lab is a full page load on purpose — the lab experience
 * reads its query params at module load.
 */
import { getUser, logout } from "../auth.ts";
import { scenarios } from "../scenarios.ts";
import { useReveal } from "./reveal.ts";
import "../brand/guided-roots.css";
import "./pages.css";

export function Home() {
  useReveal();
  const user = getUser();
  const firstName = (user?.name ?? "there").split(" ")[0];
  return (
    <div className="gr-scope">
      <nav className="gr-nav">
        <div className="gr-nav-inner">
          <a className="gr-wordmark" href="/home">
            <img src="/brand/logo-mark.svg" alt="" />
            <span>
              <span className="name">Trellis</span>
              <span className="by">by Guided Roots</span>
            </span>
          </a>
          <div className="gr-nav-actions user-chip">
            <span className="who">{user?.name?.toUpperCase()}</span>
            <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={() => logout()}>
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <header className="gr-section tight">
        <div className="gr-container">
          <div className="gr-section-head" style={{ marginBottom: "clamp(28px, 4vw, 48px)" }}>
            <p className="gr-eyebrow">Your workspace</p>
            <h2>
              Welcome back, <em>{firstName}</em>.
            </h2>
          </div>

          <div className="launch-card gr-reveal in">
            <img className="launch-rings" src="/brand/rings-watermark.svg" alt="" />
            <div className="copy">
              <p className="gr-mono-note">VIRTUAL DESKTOP · FRESH SESSION</p>
              <h2>Step up to the desk</h2>
              <p>
                A windowed machine with an editor, a terminal, and a guide at the next desk. Everything
                you do in it is measured; nothing outside it is touched.
              </p>
              <a className="gr-btn gr-btn-primary gr-btn-big" href="/lab">
                Launch the virtual desktop
              </a>
            </div>
            <figure className="shot-frame">
              <div className="bar" aria-hidden="true">
                <i /><i /><i />
                <span className="url">trellis · virtual desktop</span>
              </div>
              <img src="/landing/desktop.png" alt="Preview of the Trellis virtual desktop" />
            </figure>
          </div>
        </div>
      </header>

      <section className="gr-section tight" style={{ paddingTop: 0 }}>
        <div className="gr-container">
          <div className="gr-section-head" style={{ marginBottom: "clamp(24px, 3vw, 40px)" }}>
            <p className="gr-eyebrow">Scenarios</p>
            <h2 style={{ fontSize: "clamp(1.7rem, 2.6vw, 2.3rem)" }}>
              Or start from a <em>scenario</em>
            </h2>
            <p className="gr-lede">
              Each one opens the desktop with a situation already growing in it — a failing test, an
              agent's unreviewed diff, an inbox that needs judgment.
            </p>
          </div>
          <div className="gr-grid gr-grid-3">
            {scenarios.map((s, i) => (
              <a
                key={s.labId}
                className={`gr-card scenario-card gr-reveal${i === 0 ? " featured" : ""}`}
                data-delay={String(i % 3)}
                href={`/lab?lab=${encodeURIComponent(s.labId)}`}
              >
                <span className="gr-mono-note">{s.tag}</span>
                <h3>{s.title}</h3>
                <p>{s.blurb}</p>
                <span className="go">Launch scenario</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <footer className="gr-footer">
        <div className="gr-container">
          <hr className="gr-ground" />
          <div className="gr-footer-inner">
            <span className="gr-mono-note">TRELLIS · GUIDED ROOTS LLC</span>
            <span className="gr-mono-note">SHAPED BY HAND, GROWN IN PLACE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
