/**
 * GuideSwitcher — a top-level control (lives in the desktop's taskbar chrome)
 * for choosing who voices the guide chat: the deterministic offline mock, or a
 * live model. The swap is per-session and immediate — no reload, lab state and
 * transcript survive; only the next reply changes voice. The choice is
 * persisted so the next session starts on it too.
 *
 * The list of options comes from the server, which knows what's actually
 * configured. When no live model is set up, that option is present but disabled
 * with an ℹ tooltip naming the exact env vars to add — so this doubles as the
 * discovery path for "how do I talk to a real model?".
 */
import { useEffect, useState } from "react";
import {
  api,
  saveGuidePref,
  type GuideProviderId,
  type GuideProviderInfo,
  type SessionCredentials,
  type StatePayload,
} from "../api.ts";

export function GuideSwitcher({
  creds,
  current,
  onNewData,
}: {
  creds: SessionCredentials;
  current: GuideProviderId;
  onNewData: (d: StatePayload) => void;
}) {
  const [options, setOptions] = useState<GuideProviderInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    api
      .guideProviders()
      .then((r) => {
        if (!stop) setOptions(r.options);
      })
      .catch(() => {
        /* switcher just stays on the current value */
      });
    return () => {
      stop = true;
    };
  }, []);

  const modelOption = options.find((o) => o.id === "model");

  const choose = async (id: GuideProviderId) => {
    if (id === current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.setGuideProvider(creds, id);
      saveGuidePref(id); // next session starts here too
      onNewData(await api.state(creds)); // reflect the live swap immediately
    } catch {
      setError(
        id === "model"
          ? modelOption?.detail ?? "That guide provider isn't available."
          : "Couldn't switch the guide provider.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="guide-switch" title="Who voices the guide chat — the offline scripted guide, or a live model">
      <span className="guide-switch-label" aria-hidden="true">
        🧠 Guide
      </span>
      <select
        className="guide-switch-select"
        value={current}
        disabled={busy || options.length === 0}
        aria-label="Guide provider"
        onChange={(e) => void choose(e.target.value as GuideProviderId)}
      >
        {options.length === 0 ? (
          <option key="loading" value={current}>
            {current === "model" ? "Live model" : "Scripted guide (offline)"}
          </option>
        ) : (
          options.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.available}>
              {o.label}
            </option>
          ))
        )}
      </select>
      {modelOption && !modelOption.available && (
        <span className="guide-switch-info" title={modelOption.detail} aria-label={modelOption.detail}>
          ℹ
        </span>
      )}
      {error && (
        <span className="guide-switch-err" title={error} aria-label={error}>
          ⚠
        </span>
      )}
    </div>
  );
}
