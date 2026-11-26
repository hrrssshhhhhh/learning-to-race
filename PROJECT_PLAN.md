# Self-Learning Vehicles: Project Plan

A website where cars and bikes teach themselves to drive F1-style tracks that you draw. They crash, learn, and improve every generation until they master the track. The AI is written from scratch: a small neural network trained by a genetic algorithm.

**Goal:** a portfolio project for US MS in CS applications and later for jobs.
**Deadline:** live in 3 weeks (about 2026-12-15).
**How we build:** subagent-driven. Each task is built by a fresh agent, then checked by a reviewer before the next one starts.

Detailed documents:
- Design (what and why): [docs/superpowers/specs/2026-11-24-self-learning-vehicles-design.md](docs/superpowers/specs/2026-11-24-self-learning-vehicles-design.md)
- Technical plan (exact code interfaces and tests): [docs/superpowers/plans/2026-11-24-self-learning-vehicles.md](docs/superpowers/plans/2026-11-24-self-learning-vehicles.md)

---

## What we decided, and why

| Decision | Why |
|---|---|
| A standalone website, live link, nothing to install | Reviewers can open it in 5 seconds |
| Opens straight onto vehicles already learning | Wow within the first seconds; no setup screen |
| Draw in 2D → camera swoops into 3D | A memorable moment; the physics stays simple 2D underneath |
| Neuroevolution (neural net + genetic algorithm), written from scratch | Learns a new track within 5 minutes in a browser. You can say "I wrote it" |
| No reinforcement learning, no ML libraries | Too slow for the 5-minute goal / doesn't show your own skill |
| Cars and bikes with different handling | They learn different racing lines on the same track |
| Vehicles never hit each other, only the walls | Keeps the focus on learning the track |
| **Scrape vs crash**: glancing hits make sparks and damage, hard hits are out | Shows partly-learned corners honestly, and helps them learn faster |
| **Generalization**: specialist (one track) vs generalist (many random tracks) | The real ML point (overfitting vs generalizing) that reviewers respect |
| **Carry-over vehicles**: train on your track, take them to a new one | Transfer learning you can see: familiar corners go clean, new ones scrape |
| Race always starts from random brains unless you pick otherwise | You see learning from the very first crash |
| Results page with 3 real experiments | Turns a demo into research thinking |

## Success checks

- Default track: first full lap within about 2 minutes.
- Any track you draw: first full lap within 5 minutes (speed slider allowed).
- Smooth (~60 fps) with 200 vehicles on a normal laptop.
- The generalist finishes most tracks it has never seen; the specialist mostly doesn't.

---

## Step-by-step build

### Week 1: brain and physics (ends with a working 2D version)

- [x] **1. Project setup.** Vite + TypeScript, tests, random number generator, vector math.
- [x] **2. Tracks.** Turn drawn points into a smooth track with walls and checkpoints. Reject bad drawings: too small, crossing itself, corners too tight.
- [x] **3. Random track generator.** Endless valid F1-style tracks, used to train the generalist.
- [x] **4. Car and bike physics.** Accelerate, brake, steer; bikes are quicker but grip less.
- [x] **5. Sensors.** 7 distance rays, the vehicle's "eyes".
- [x] **6. Scrape vs crash.** Angle and speed of impact decide whether it scrapes or crashes; a damage meter.
- [x] **7. Neural network**, from scratch: rays + speed in, steering + throttle out.
- [x] **8. Genetic algorithm**, from scratch: keep the best, mix, mutate.
- [x] **9. The world loop.** Run generations, score progress, stop cheaters (driving backwards, sitting still). **Test that the time goals are met.**
- [x] **10. 2D view.** Watch them learn in the browser, with a speed slider and car/bike toggles. → *Working fallback product.*

### Week 2: the wow

- [x] **11. Track editor.** Draw with the mouse, live preview, clear error messages, random/default track buttons.
- [x] **12. 3D view.** Three.js track and vehicles, chase / orbit / top cameras, the 2D→3D swoop when you hit Race.
- [x] **13. Sparks and scrape marks.** Sparks on every scrape; walls darken where vehicles rub most.
- [x] **14. Dashboard.** Generation, alive count, lap times, fitness chart, live neural-net diagram, damage bar, a celebration on the first lap. Tune cars vs bikes.
  - Spec strip at the top: vehicle count, sensors, net shape, "genetic algorithm". Tells reviewers the tech in one line.
  - Best-per-generation bar chart (one bar per generation) in place of a noisy fitness line.
  - Highlight the leader and draw its 7 sensor rays, so the net diagram visibly drives that vehicle.
  - "Best ever" and leader checkpoints (e.g. 162/168) on the panel.
  - One collapsible side panel holding all stats, readable size and contrast, never covering the track.
  - First check how much room the 2D and 3D canvases leave for a side panel. If the canvas can shrink, put the panel beside it; if not, overlay it, collapsible and semi-transparent.

### Week 3: the ML story and launch

- [x] **15. Keep my vehicles.** Save trained vehicles in the browser. Choose Fresh / My vehicles / Generalist when racing. "First lap in X generations vs Y from scratch" stat.
- [x] **16. Pre-training.** Train the specialist offline and ship it with the site (`npm run pretrain`, ~1.5 min). Start from → "Pre-trained (default track)".
  - *2026-11-25: generalist dropped to keep pre-training short.* Measured: the specialist already completes 63% on unseen random tracks (50–54% on the default track; the rest of each population are mutated children).
- [x] **17. Test on unseen track.** *(Generalist dropped: contenders are Pre-trained, Fresh (random-brain baseline) and Yours.)* Side by side, frozen, one attempt each, with completion rates; Keep training lets them all evolve.
- [x] **18. Experiments + Results page + README.**
  1. ~~Specialist vs generalist on 50 unseen tracks~~ *(generalist dropped; replaced by pre-trained vs random brains on 50 unseen tracks)*
  2. Cars vs bikes: who learns faster
  3. Transfer: does training on track A help on track B, and which corners still cause scrapes
- [x] **19. Launch.** All tests pass, a final walkthrough, deploy to Vercel (you set up the GitHub and Vercel accounts; I give you the commands).

---

## After launch (for your applications)

- Record a short GIF/video for the README and your resume.
- Link the live site + GitHub in your resume and statement of purpose.
- Be ready to explain: how the neural net decides, how the genetic algorithm improves it, and why the generalist beats the specialist.
