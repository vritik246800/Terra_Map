// Downloads (Fase 15): highlights the visitor's system and, when the latest
// GitHub release answers, points every button at the right installer — the
// top bar and hero «Download» buttons get the installer for the detected OS.
// Without an answer (no release yet, rate limit) the links go to the releases
// page; with no known desktop OS (phones) they stay on the downloads section.
const API = "https://api.github.com/repos/vritik246800/Terra_Map/releases/latest";
const RELEASES = "https://github.com/vritik246800/Terra_Map/releases/latest";

type Os = "macos" | "windows" | "linux";
const NAMES: Record<Os, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };
// file kinds per data-asset attribute, most specific first
const ASSETS: Record<string, RegExp[]> = {
  dmg: [/universal\.dmg$/i, /\.dmg$/i],
  exe: [/-setup\.exe$/i, /\.exe$/i],
  msi: [/\.msi$/i],
  appimage: [/\.AppImage$/i],
  deb: [/\.deb$/i],
  rpm: [/\.rpm$/i],
};
const PRIMARY: Record<Os, string> = { macos: "dmg", windows: "exe", linux: "appimage" };

function detectOs(): Os | null {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|Android/i.test(ua)) return null;
  if (/Win/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return null;
}

export async function initDownloads(): Promise<void> {
  const os = detectOs();
  const hero = document.querySelector<HTMLAnchorElement>("[data-hero-download]");
  const osButtons = document.querySelectorAll<HTMLAnchorElement>("[data-os-download]");
  if (os) {
    document.querySelector(`[data-os="${os}"]`)?.classList.add("is-mine");
    if (hero) hero.textContent = `Download for ${NAMES[os]}`;
    for (const a of osButtons) a.href = RELEASES; // until the release answers
  }
  try {
    const res = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return;
    const release: { tag_name: string; assets: { name: string; browser_download_url: string }[] } = await res.json();
    const url = (kind: string) =>
      ASSETS[kind].map((re) => release.assets.find((a) => re.test(a.name))).find(Boolean)?.browser_download_url;
    for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-asset]")) {
      const href = url(link.dataset.asset!);
      if (href) link.href = href;
    }
    const installer = os && url(PRIMARY[os]);
    if (installer) for (const a of osButtons) a.href = installer;
    for (const el of document.querySelectorAll("[data-version]")) el.textContent = release.tag_name;
  } catch {
    // offline or blocked: the releases page links stay
  }
}
