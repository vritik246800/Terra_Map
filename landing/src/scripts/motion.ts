// Page motion (Fase 15, GSAP): hero intro, scroll-linked hero, the pinned
// "how it works" story that swaps the app videos, reveals and counters.
// Everything sits behind prefers-reduced-motion: with it, the page is static
// and the videos wait for the play button.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText);

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

function play(video: HTMLVideoElement, restart = false): void {
  if (restart) video.currentTime = 0;
  video.play().catch(() => {}); // autoplay refused: the poster stays
}

/** Muted loops play only while visible (saves battery and bandwidth). */
function autoplayInView(videos: HTMLVideoElement[]): void {
  const io = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const v = target as HTMLVideoElement;
      if (isIntersecting) play(v);
      else v.pause();
    }
  }, { threshold: 0.35 });
  videos.forEach((v) => io.observe(v));
}

function counters(root: ParentNode, start: string): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-count]")) {
    const to = Number(el.dataset.count);
    const decimals = Number(el.dataset.decimals ?? 0);
    const value = { n: 0 };
    gsap.to(value, {
      n: to,
      duration: 1.6,
      ease: "power2.out",
      scrollTrigger: { trigger: el, start, once: true },
      onUpdate: () => (el.textContent = value.n.toFixed(decimals)),
    });
  }
}

/** Pinned story on wide screens: the scroll walks the four steps. */
function story(): void {
  const steps = $$(".step");
  const videos = $$<HTMLVideoElement>(".stage video");
  let active = -1;
  let pinned = false; // videos play only while the story is on screen
  const show = (i: number) => {
    if (i === active) return;
    active = i;
    steps.forEach((s, k) => s.classList.toggle("is-active", k === i));
    videos.forEach((v, k) => {
      v.classList.toggle("is-active", k === i);
      if (k !== i) v.pause();
      else if (pinned) play(v, true);
    });
  };
  const st = ScrollTrigger.create({
    trigger: ".story",
    start: "top top",
    end: () => `+=${innerHeight * 3}`,
    pin: true,
    scrub: true,
    onToggle: (self) => {
      pinned = self.isActive;
      const v = videos[active];
      if (v && pinned) play(v);
      else v?.pause();
    },
    onUpdate: (self) => {
      gsap.set(".rail__fill", { scaleY: self.progress });
      show(Math.min(steps.length - 1, Math.floor(self.progress * steps.length)));
    },
  });
  show(0);
  steps.forEach((s, i) =>
    s.querySelector("button")?.addEventListener("click", () => st.scroll(st.start + ((st.end - st.start) * (i + 0.5)) / steps.length)),
  );
}

/** Cursor-following light on the glass cards (CSS reads --mx/--my). */
function spotlight(): void {
  for (const card of $$(".spot")) {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  }
}

export function initMotion(opts: { onHeroProgress?: (p: number) => void } = {}): void {
  spotlight();
  const mm = gsap.matchMedia();
  mm.add({ motion: "(prefers-reduced-motion: no-preference)", wide: "(min-width: 900px)" }, (ctx) => {
    const { motion, wide } = ctx.conditions as { motion: boolean; wide: boolean };
    const stepVideos = $$<HTMLVideoElement>(".step video");
    if (!motion) {
      // static page: every video gets its controls and waits for the user
      $$<HTMLVideoElement>("video").forEach((v) => (v.controls = true));
      return;
    }
    autoplayInView([...stepVideos, ...$$<HTMLVideoElement>(".showcase video")]);

    // hero intro
    const split = SplitText.create(".hero h1 .line", { type: "words", mask: "words" });
    gsap
      .timeline({ defaults: { ease: "power3.out" } })
      .from(".top", { y: -24, autoAlpha: 0, duration: 0.8 })
      .from(".hero .eyebrow", { y: 16, autoAlpha: 0, duration: 0.6 }, "-=0.45")
      .from(split.words, { yPercent: 110, duration: 1.05, stagger: 0.07 }, "-=0.3")
      .from(".hero .lede", { y: 18, autoAlpha: 0, duration: 0.7 }, "-=0.65")
      .from(".hero .cta > *", { y: 14, autoAlpha: 0, stagger: 0.08, duration: 0.6 }, "-=0.45")
      .from(".hud", { x: 48, autoAlpha: 0, duration: 0.9 }, "-=0.55");
    counters($(".hud") ?? document, "top bottom");

    // hero follows the scroll: copy lifts away, the 3D camera tilts to a map
    gsap.to(".hero .copy", {
      yPercent: -22,
      autoAlpha: 0,
      ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "75% top", scrub: true },
    });
    ScrollTrigger.create({
      trigger: ".hero",
      start: "top top",
      end: "bottom top",
      onUpdate: (self) => opts.onHeroProgress?.(self.progress),
    });

    // section reveals
    gsap.set("[data-reveal]", { y: 36, autoAlpha: 0 });
    ScrollTrigger.batch("[data-reveal]", {
      start: "top 88%",
      once: true,
      onEnter: (els) => gsap.to(els, { y: 0, autoAlpha: 1, duration: 0.9, stagger: 0.08, ease: "power3.out" }),
    });

    if (wide) story();

    // presentation video grows into place
    gsap.fromTo(
      ".showcase .frame",
      { scale: 0.86, borderRadius: 40 },
      { scale: 1, borderRadius: 20, ease: "none", scrollTrigger: { trigger: ".showcase", start: "top 85%", end: "center 60%", scrub: true } },
    );
    counters($(".stats") ?? document, "top 85%");

    // background aurora drifts
    $$(".aurora span").forEach((blob, i) =>
      gsap.to(blob, { xPercent: i % 2 ? -18 : 22, yPercent: i % 2 ? 14 : -16, scale: 1.15, duration: 14 + i * 4, ease: "sine.inOut", repeat: -1, yoyo: true }),
    );
  });
}
