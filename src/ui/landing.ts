import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { LAYERS, weightCount } from '../ml/nn';
import { POP_SIZE } from '../sim/world';
import { mountHeroDeck } from './heroDeck';

gsap.registerPlugin(ScrollTrigger);

/**
 * Landing hero over the 3D circuit. Scrolling one screen drives the camera from an aerial orbit down onto the
 * starting grid (see CameraRig.intro) while the hero copy clears and the app's chrome comes in.
 * Nothing trains until the user asks: "Start training" here, or Start in the app.
 */
export function mountLanding(opts: { start(): void; draw(): void }): { progress(): number } {
  const hero = document.createElement('section');
  hero.className = 'hero';
  hero.setAttribute('aria-labelledby', 'hero-title');
  hero.innerHTML = `
    <div class="hero-scrim"></div>
    <nav class="hero-nav"><span class="hero-mark">Self-learning vehicles</span><a href="./results.html">How it works</a></nav>
    <div class="hero-copy">
      <p class="hero-tag">Neuroevolution, written from scratch</p>
      <h1 id="hero-title" class="hero-h1">
        <span class="ln"><span>Learning</span></span>
        <span class="ln"><span>to race</span></span>
      </h1>
      <p class="hero-sub"><b class="c-car">${POP_SIZE} cars</b> and <b class="c-bike">${POP_SIZE} bikes</b> start with random brains.
        Nobody writes a driving rule: each generation the best survive, breed and mutate, until they can lap any track you draw.</p>
      <dl class="hero-figs">
        <div><dt>on the grid</dt><dd class="fig">${2 * POP_SIZE}</dd></div>
        <div><dt>weights per brain</dt><dd class="fig">${weightCount(LAYERS)}</dd></div>
        <div><dt>driving rules written</dt><dd class="fig">0</dd></div>
      </dl>
      <div class="hero-actions">
        <button type="button" class="btn primary hero-btn" data-a="start">Start the race</button>
        <button type="button" class="btn hero-btn" data-a="draw">Draw a track</button>
      </div>
    </div>
    <div class="hero-cue" aria-hidden="true"><span>Scroll to the grid</span><i><b></b></i></div>
    <div class="hero-chequer" aria-hidden="true"></div>`;
  const space = document.createElement('div');
  space.className = 'landing-space'; // one screen of scroll drives the hero -> app transition
  document.body.prepend(hero);
  if (matchMedia('(min-width: 1100px) and (min-height: 700px)').matches) mountHeroDeck(hero); // the cards need the empty right side
  document.body.append(space);
  document.body.classList.add('at-hero');

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Lenis smooths wheel/touch scrolling; GSAP's ticker drives it so ScrollTrigger and Lenis share one clock.
  const lenis = reduce ? null : new Lenis({ lerp: 0.08 });
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const end = () => document.documentElement.scrollHeight - window.innerHeight;
  const go = (then?: () => void) => {
    if (lenis) lenis.scrollTo(end(), { duration: 1.8, onComplete: then });
    else { window.scrollTo(0, end()); then?.(); }
  };
  hero.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'start') go(opts.start);
    else if (a === 'draw') go(opts.draw);
  });

  // one entrance: the headline lines rise out of their masks, then the rest fades in
  if (!reduce) {
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .from('.hero-h1 .ln > span', { yPercent: 110, duration: 1.1, stagger: 0.12 })
      .from('.hero-tag, .hero-sub, .hero-figs, .hero-actions, .hero-nav, .hero-cue, .hero-chequer', { autoAlpha: 0, y: 12, duration: 0.8, stagger: 0.06 }, '-=0.7')
      .from('.tele', { autoAlpha: 0, x: 16, duration: 0.8, stagger: 0.1 }, '-=0.6');
  }

  // App chrome is hidden (and unfocusable, via autoAlpha) until the hero has gone
  const chrome = ['#panel', '.title', '.viewbar', '#controls']; // panel first: it appears as the canvas narrows
  gsap.set(chrome, { autoAlpha: 0 });
  const m = reduce ? 0 : 1;
  let progress = 0;
  const tl = gsap.timeline({
    defaults: { ease: 'none' }, // scrubbed: the scroll position is the easing
    scrollTrigger: {
      trigger: space, start: 'top top', end: 'bottom bottom', scrub: true,
      onUpdate: (st) => {
        progress = st.progress;
        // the panel takes its width from the canvas only once the hero is mostly gone, so the resize hides under the fade
        document.body.classList.toggle('at-hero', st.progress < 0.55);
      },
    },
  });
  // lines leave at slightly different speeds, so the headline peels apart as the camera dives
  tl.to('.hero-h1 .ln', { y: (i) => -60 * m * (i + 1), autoAlpha: 0, duration: 0.45, stagger: 0.04 }, 0)
    // explicit start values + immediateRender false: these elements also have the load entrance, which must not be overwritten
    .fromTo('.hero-tag, .hero-sub, .hero-figs, .hero-actions, .hero-chequer', { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -40 * m, duration: 0.4, immediateRender: false }, 0.05)
    .fromTo('.hero-nav', { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.3, immediateRender: false }, 0)
    .fromTo('.hero-deck', { autoAlpha: 1, x: 0 }, { autoAlpha: 0, x: 40 * m, duration: 0.4, immediateRender: false }, 0)
    .to('.hero-cue b', { scaleX: 1, duration: 0.6 }, 0) // the cue's bar fills as you scroll
    .fromTo('.hero-cue', { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.15, immediateRender: false }, 0.6)
    .to('.hero-scrim', { autoAlpha: 0, duration: 0.6 }, 0.15)
    .fromTo(chrome, { autoAlpha: 0, y: 12 * m }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.05 }, 0.6)
    .set(hero, { autoAlpha: 0 }, 1); // fully gone at the end: no stray clicks or focus on the hero
  return { progress: () => progress };
}
