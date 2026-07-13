/**
 * Public landing page — Guided Roots brand (see ../brand/guided-roots.css).
 * Screenshots under /landing/ are captured from the real desktop experience
 * (see apps/web/public/landing/README.md for how to regenerate them).
 */
import { bypassAvailable, login, loginBypass } from "../auth.ts";
import { useReveal } from "./reveal.ts";
import "../brand/guided-roots.css";
import "./pages.css";

export function Landing() {
  useReveal();
  return (
    <div className="gr-scope">
      <nav className="gr-nav">
        <div className="gr-nav-inner">
          <a className="gr-wordmark" href="/">
            <img src="/brand/logo-mark.svg" alt="" />
            <span>
              <span className="name">Trellis</span>
              <span className="by">by Guided Roots</span>
            </span>
          </a>
          <div className="gr-nav-actions">
            <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={() => void login()}>
              Sign in
            </button>
          </div>
        </div>
      </nav>

      <header className="gr-hero">
        <img className="gr-hero-rings" src="/brand/rings-watermark.svg" alt="" />
        <div className="gr-container">
          <div className="gr-hero-copy">
            <p className="gr-eyebrow">Guided Roots · Trellis</p>
            <h1>
              Practice on a real desktop, where the work is <em>measured</em>.
            </h1>
            <p className="gr-lede">
              Trellis drops you into a virtual desktop — a terminal, an editor, a real repository, and a
              guide at the next desk. Every command, diff, and test run is observed by deterministic
              instrumentation, so completion is decided by evidence, not self-report.
            </p>
            <div className="gr-hero-ctas">
              <button className="gr-btn gr-btn-primary" onClick={() => void login()}>
                Sign in to start
              </button>
              <a className="gr-btn gr-btn-ghost" href="#tour">
                See the workspace
              </a>
              {bypassAvailable && (
                <button className="gr-text-link" onClick={() => loginBypass()}>
                  Continue as local developer
                </button>
              )}
            </div>
          </div>
          <figure className="shot-frame gr-reveal">
            <div className="bar" aria-hidden="true">
              <i /><i /><i />
              <span className="url">trellis · virtual desktop</span>
            </div>
            <img
              src="/landing/desktop.png"
              alt="The Trellis virtual desktop: a windowed workspace with a code editor, terminal, and guide chat"
            />
          </figure>
        </div>
      </header>

      <section className="gr-section tight" id="tour">
        <div className="gr-container">
          <div className="gr-section-head">
            <p className="gr-eyebrow">The workspace</p>
            <h2>
              A whole desktop, <em>grown</em> for one lesson.
            </h2>
            <p className="gr-lede">
              Not a quiz and not a sandbox toy — a windowed machine where knowing what to open is part
              of what the lesson teaches.
            </p>
          </div>

          <div className="tour-row gr-reveal">
            <figure className="shot-frame">
              <div className="bar" aria-hidden="true"><i /><i /><i /><span className="url">code studio</span></div>
              <img src="/landing/code-studio.png" alt="Code Studio: an editor with a file list, open source files, and an integrated terminal" />
            </figure>
            <div className="tour-copy">
              <p className="gr-mono-note">FIELD NOTE 01 · CODE STUDIO</p>
              <h2>A real editor over a real repository</h2>
              <p>
                Open files, read diffs, run the test suite in an integrated terminal. The repository is
                genuinely yours for the session — including the mistakes an AI agent left in it.
              </p>
            </div>
          </div>

          <div className="tour-row flip gr-reveal">
            <figure className="shot-frame">
              <div className="bar" aria-hidden="true"><i /><i /><i /><span className="url">trellis guide</span></div>
              <img src="/landing/guide.png" alt="The Trellis Guide window: a chat with the instructor beside a live task checklist" />
            </figure>
            <div className="tour-copy">
              <p className="gr-mono-note">FIELD NOTE 02 · THE GUIDE</p>
              <h2>A guide that asks before it tells</h2>
              <p>
                The instructor works an elicit-first ladder: it nudges you toward the next observation
                before it ever hands you an answer. When you're stuck, help arrives — measured, not
                poured.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="gr-section tight">
        <div className="gr-container">
          <hr className="gr-ground" />
          <div className="gr-section-head" style={{ marginTop: "clamp(40px, 5vw, 72px)" }}>
            <p className="gr-eyebrow">How it works</p>
            <h2>
              Evidence decides, <em>not</em> vibes.
            </h2>
          </div>
          <div className="gr-grid gr-grid-3">
            <div className="gr-card gr-reveal">
              <span className="step-num">01</span>
              <h3>Launch the desktop</h3>
              <p>
                Pick a scenario — reading a failing Playwright test, reviewing an AI agent's diff — and
                a fresh workspace grows around it.
              </p>
            </div>
            <div className="gr-card gr-reveal" data-delay="1">
              <span className="step-num">02</span>
              <h3>Work like you would at a real machine</h3>
              <p>
                Shell instrumentation watches commands, edits, and test runs. The platform measures
                what you do; the guide only chooses how to talk about it.
              </p>
            </div>
            <div className="gr-card gr-reveal" data-delay="2">
              <span className="step-num">03</span>
              <h3>Completion is checked behaviorally</h3>
              <p>
                A deterministic verifier inspects the workspace itself. If the checkpoint passes, you
                earned it — and your learner profile records the evidence.
              </p>
            </div>
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
