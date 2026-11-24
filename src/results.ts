import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

// Respect reduced-motion users: keep native scroll for them.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  new Lenis({ autoRaf: true });
}
