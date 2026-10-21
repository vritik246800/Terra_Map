/**
 * Update notice (Fase 14, UX.md §2, Q_LIST.md Q29): once per start, asks
 * GitHub for the latest release; when the core says its tag is newer than
 * this build, the "update" modal offers the download page. Optional:
 * «Later» only closes it (it comes back on the next start). Offline, no
 * release yet or a private repository → nothing happens.
 */
import { isNewerVersion, openReleasesPage } from "../net/bridge";
import { t } from "../state/i18n";
import { store } from "../state/store";
import { errorText, showToast } from "../state/toasts";

const LATEST_RELEASE = "https://api.github.com/repos/vritik246800/Terra_Map/releases/latest";

let latestTag = "";

export const update = {
  /** Tag of the newer release (`v0.2.0`), shown by `UpdateModal`. */
  get tag(): string {
    return latestTag;
  },

  async check(): Promise<void> {
    try {
      const res = await fetch(LATEST_RELEASE);
      if (!res.ok) return; // no release yet, private repository, rate limit
      const { tag_name: tag } = (await res.json()) as { tag_name?: unknown };
      if (typeof tag !== "string" || !(await isNewerVersion(tag))) return;
      latestTag = tag;
      // Never over another modal (recovery, onboarding, one the user opened).
      if (!store.modal) store.openModal("update");
    } catch (err) {
      console.warn("[update] check failed:", err); // offline: no notice
    }
  },

  async download(): Promise<void> {
    store.closeModal();
    try {
      await openReleasesPage();
    } catch (err) {
      showToast(t("toast.browserFailed", { error: errorText(err) }), "danger");
    }
  },
};
