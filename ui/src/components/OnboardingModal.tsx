/**
 * First-run introduction (Fase 13, UX.md §2, Q_LIST.md Q26): 3 steps, each
 * raising the real UI zone above the backdrop with an `--accent` ring — the
 * zone stays usable during the step (DESIGN.md §1.9). The card sits in the
 * bottom-right corner and does not trap focus; «Saltar», `Esc` or the last
 * step mark the intro as seen (local flag). «Ver introdução» in the guide
 * opens it again.
 */
import { useEffect, useState } from "react";

import { t } from "../state/i18n";
import { Modal } from "./Modal";

const STEPS = [
  { id: "terrain", target: ".panel-left" },
  { id: "elements", target: ".viewport" },
  { id: "save", target: ".navbar-top" },
] as const;

const SEEN_KEY = "terra-map.onboarded";

/** True on the first run (the intro was never finished or skipped). */
export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    return false; // no storage: do not nag on every start
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // storage blocked: shows again next time
  }
}

export function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const { id, target } = STEPS[step];
  const last = step === STEPS.length - 1;

  useEffect(() => {
    const zone = document.querySelector(target);
    zone?.classList.add("is-onboarding-target");
    return () => zone?.classList.remove("is-onboarding-target");
  }, [target]);

  function finish(): void {
    markSeen();
    onClose();
  }

  return (
    <Modal title={t("onboarding.title")} onDismiss={finish} trap={false} corner>
      <p className="onboarding__step" aria-live="polite">
        {t("onboarding.step", { n: step + 1, total: STEPS.length })}
      </p>
      <h3 className="guide-steps__title">{t(`onboarding.steps.${id}.title`)}</h3>
      <p className="modal__text">{t(`onboarding.steps.${id}.text`)}</p>
      <div className="modal__actions">
        <button type="button" className="modal__button" onClick={finish}>
          {t("onboarding.skip")}
        </button>
        {step > 0 && (
          <button type="button" className="modal__button" onClick={() => setStep(step - 1)}>
            {t("onboarding.back")}
          </button>
        )}
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={() => (last ? finish() : setStep(step + 1))}
        >
          {t(last ? "onboarding.done" : "onboarding.next")}
        </button>
      </div>
    </Modal>
  );
}
