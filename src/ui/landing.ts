import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Landing hero over the live simulation. The page scrolls one screen: the hero fades away and the app's
 * chrome (title, view bar, controls, panel) comes in, so scrolling "moves into" the running model.
 * The sim never stops; the hero's visual is the real thing.
 */
export function mountLanding(opts: { status(): string; draw(): void }): void {
  const hero = document.createElement('section');
  hero.className = 'hero';
  hero.setAttribute('aria-labelledby', 'hero-title');
  hero.innerHTML = `
    <div class="hero-scrim"></div>
    <nav class="hero-nav"><span class="hero-mark">Self-learning vehicles</span><a href="./results.html">How it works</a></nav>
    <div class="hero-copy">
      <h1 id="hero-title">Draw a track. Watch 200 cars and bikes teach themselves to race it</h1>
      <p class="hero-sub">A small neural network and a genetic algorithm, both written from scratch in TypeScript. Every crash makes the next generation a little better.</p>
      <div class="hero-actions">
        <button type="button" class="btn primary hero-btn" data-a="watch">Watch them learn</button>
        <button type="button" class="btn hero-btn" data-a="draw">Draw a track</button>
      </div>
      <p class="hero-live fig" aria-live="off"></p>
    </div>
    <p class="hero-cue">Scroll to enter the simulation</p>`;
  const space = document.createElement('div');
  space.className = 'landing-space'; // gives the page one screen of scroll for the transition
  document.body.prepend(hero);
  document.body.append(space);
  document.body.classList.add('at-hero');

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Lenis smooths wheel/touch scrolling; GSAP's ticker drives it so ScrollTrigger and Lenis share one clock.
  const lenis = reduce ? null : new Lenis({ lerp: 0.09 });
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const end = () => document.documentElement.scrollHeight - window.innerHeight;
  const go = (then?: () => void) => {
    if (lenis) lenis.scrollTo(end(), { duration: 1.2, onComplete: then });
    else { window.scrollTo(0, end()); then?.(); }
  };
  hero.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'watch') go();
    else if (a === 'draw') go(opts.draw);
  });

  // App chrome is hidden (and unfocusable, via autoAlpha) until the hero has gone
  const chrome = ['#panel', '.title', '.viewbar', '#controls']; // panel first: it appears as the canvas narrows
  gsap.set(chrome, { autoAlpha: 0 });
  const rise = reduce ? 0 : 1;
  const tl = gsap.timeline({
    defaults: { ease: 'none' }, // scrubbed: the scroll position is the easing
    scrollTrigger: {
      trigger: space, start: 'top top', end: 'bottom bottom', scrub: true,
      // the panel takes its width from the canvas only once the hero is mostly gone, so the resize hides under the fade
      onUpdate: (st) => document.body.classList.toggle('at-hero', st.progress < 0.55),
    },
  });
  tl.to('.hero-copy', { autoAlpha: 0, y: -48 * rise, duration: 0.5 }, 0)
    .to('.hero-nav, .hero-cue', { autoAlpha: 0, duration: 0.3 }, 0)
    .to('.hero-scrim', { autoAlpha: 0, duration: 0.7 }, 0.1)
    .fromTo(chrome, { autoAlpha: 0, y: 12 * rise }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.05 }, 0.55)
    .set(hero, { autoAlpha: 0 }, 1); // fully gone at the end: no stray clicks or focus on the hero

  // live line: the hero's numbers are the running simulation's
  const live = hero.querySelector<HTMLElement>('.hero-live')!;
  const tick = () => { if (document.body.classList.contains('at-hero')) live.textContent = opts.status(); };
  tick(); setInterval(tick, 500);
}
