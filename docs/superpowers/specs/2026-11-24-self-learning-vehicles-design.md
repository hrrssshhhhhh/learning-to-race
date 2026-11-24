# Self-Learning Vehicles — Design

Date: 2026-11-24 · Deadline: live in 3 weeks (~2026-12-15)

## Intent and why

A standalone website where vehicles (cars and bikes) teach themselves to drive an F1-style track. Users can draw their own track. Vehicles crash into the track walls (never into each other), and each generation learns from the last until they can complete the whole track.

**Why:** a portfolio project for US MS in CS applications, and later for job hunting. It has to:
- wow a first-time visitor within seconds, and show the vehicles mastering a track **within 5 minutes**;
- hold up to a technical reviewer: the ML is written from scratch, and there is a real experiment (generalization) with results;
- be explainable in depth by the owner in interviews and a statement of purpose.

## Goals

1. Open the link → a default track is already running in 3D, vehicles visibly learning. No clicks needed to see the point.
2. Track editor: draw a closed F1-style track top-down in 2D; hit **Race** → the camera swoops from top-down into a 3D view and learning starts.
3. Learning: neuroevolution (small feedforward neural net + genetic algorithm), **written from scratch, no ML libraries**.
4. Cars and bikes with genuinely different handling, evolving as separate populations on the same track.
5. **Generalization (headline feature):**
   - *Specialist* brains: trained on one track only.
   - *Generalist* brains: trained on many procedurally generated random tracks.
   - When a user draws a new track, they can run Specialist vs Generalist on it side by side: the generalist drives an unseen track right away, the specialist mostly crashes. This is the wow moment and the ML point (overfitting vs generalization) at once.
6. **Carry-over vehicles (transfer learning):** a user trains vehicles on their own track, keeps them, and races them on another track they draw. Corners similar to ones already learned are handled well, new corner shapes are not, and the vehicles visibly learn those.
7. **Scrape vs crash:** glancing wall contact is a scrape (sparks, speed loss, damage) and the vehicle keeps going; hard impact is a crash. Partly-familiar corners show up as scrapes, not instant deaths.
8. Visible learning: generation counter, alive count, best progress / lap time, a fitness-over-generations chart, sensor rays and a live neural-net diagram for the leading vehicle.
9. A **Results / How it works** page: short write-up with charts from real experiments (see below). Plus a GitHub README with a GIF, architecture and results.
10. Deployed as a static site with a public URL.

## Success criteria

- Default track: some vehicle completes a full lap within ~2 minutes at default speed on a mid-range laptop.
- Any valid user-drawn track: first full lap within 5 minutes (a speed control of 1x–10x is allowed to get there).
- ~60 fps with 200 vehicles (100 cars + 100 bikes) on a mid-range laptop.
- The generalist completes a lap on most unseen tracks with zero further training; the experiment page shows the numbers.

## Non-goals

- Vehicle-to-vehicle collision.
- Reinforcement learning (PPO/DQN) or TensorFlow.js — too slow to learn within 5 minutes in a browser.
- Backend, accounts, saving tracks server-side, multiplayer, leaderboards.
- Mobile-first design (should not break on mobile, but desktop is the target).
- Realistic racing physics (tyre models, aero). Simple, believable handling is enough.

## Anti-goals (would be a failure even if it works)

- Looks like a copied tutorial: generic 2D cars on a generic track with no twist.
- Uses an ML library for the neural net or genetic algorithm — the owner must be able to say "I wrote it".
- Visitor waits more than 5 minutes and sees nothing learn, or sees a blank/setup screen first.
- Code the owner can't explain: the NN and GA code must be small, readable, and commented on the *why*.

## Constraints

- 3-week timeline. Week 1's output must already be a usable fallback product.
- Static hosting only (no server-side compute). All training runs in the visitor's browser; pre-trained brains ship as JSON.
- No external 3D model assets (licensing, load time): vehicles are low-poly meshes built in code.

## Approaches considered

1. **Clean 2D top-down** (neon style, trails). Fastest, smoothest, but familiar-looking — weakest wow.
2. **Full 3D** (Three.js scene, 3D track editing). Biggest wow but slowest and riskiest; editing a track in 3D is hard.
3. **Hybrid — chosen.** Draw in 2D, camera swoops into 3D. Physics and learning stay 2D (fast, explainable); only rendering is 3D. Chosen because the draw-then-swoop moment is memorable, the ML stays simple to explain, and the 2D view is a built-in fallback if 3D runs late.

Learning method: neuroevolution chosen over RL because it reliably learns a fresh track in minutes in a browser and is visibly watchable; RL would not meet the 5-minute goal.

## How it works (decided parts)

**Stack (builder's call, stated):** Vite + TypeScript, Three.js for the 3D view, plain Canvas 2D for the editor and the 2D view. No UI framework required. Deploy to Vercel or GitHub Pages.

**Simulation (2D, renderer-independent):**
- The same sim code runs in the browser and headless in Node (for pre-training and experiments).
- Fixed timestep; speed-up = more sim steps per frame.
- Track = closed smoothed centerline (spline) + width → inner and outer wall polylines, plus checkpoints along the centerline.
- **Wall contact: scrape vs crash.** On contact, the sim looks at impact angle and speed:
  - *Glancing* (shallow angle, below a speed-dependent threshold) → **scrape**: the vehicle slides along the wall, loses speed, takes damage proportional to the impact, and keeps going.
  - *Hard* (steep angle or high speed) → **crash**: the vehicle is out.
  - A **damage meter** accumulates scrape damage; at its limit the vehicle is out.
  - Fitness is penalized for scrape damage, so evolution drives toward clean lines.
  - Exact thresholds and damage numbers are the builder's call. They must be tuned so a near-correct line through a partly-familiar corner produces a scrape, not a crash.
- A vehicle is also out if it makes no checkpoint progress for N seconds.
- The sim emits contact events (position, intensity) so the renderer can draw effects. The sim never depends on the renderer.
- Vehicle model: simple kinematic/bicycle model. Cars vs bikes differ in parameters, e.g. bikes accelerate faster and are narrower but have less grip / tighter steering limits at speed. Exact numbers are tuned by the builder so the two types learn noticeably different behaviour.

**Brain:** small feedforward net. Inputs: ~5–7 distance rays to the walls + current speed (+ optionally steering angle). Outputs: steering and throttle/brake. Exact layer sizes are the builder's call.

**Genetic algorithm:** population per vehicle type (~100), fitness = checkpoint progress (+ lap-time bonus once laps complete), elitism + selection + crossover + Gaussian mutation. Cars and bikes evolve separately because their physics differ.

**"Learned the track":** a vehicle completes a full lap. Show a clear celebration moment when this happens, then keep improving lap time.

**Generalization:**
- Random track generator produces valid F1-style closed tracks (varied corners, no self-intersections).
- Generalist brains are pre-trained headless in Node across many random tracks (new track(s) every generation), then shipped as JSON per vehicle type.
- Specialist brains are pre-trained on the default track only, also shipped as JSON.
- *(Call made by the designer)* Each JSON holds the **whole final population** (~100 distinct brains), not one best brain. That way a run of shipped vehicles behaves differently from one vehicle to the next, so a completion rate is meaningful rather than all-or-nothing.
- UI mode "Test on unseen track": user draws or randomizes a track → specialist and generalist populations run on it side by side (colour-coded), **frozen (no evolution)**, for one attempt each. Shown: completion rate = % of that population that finishes one full lap. Experiment 1 uses exactly this same definition, so the live demo and the Results page agree. *(Designer's call)* After the frozen run, a "Keep training" button lets both populations continue evolving on that track, using the normal GA loop once per population.

**Race vs Test mode** *(designer's call, following the original idea that vehicles learn by crashing)*: **Race** on any track always starts from **random brains**, so learning is visible from the first crash. The 5-minute goal therefore applies to learning from scratch and is a real tuning target (GA hyperparameters, timeout, speed control). Pre-trained brains appear only in "Test on unseen track", or when the user explicitly picks a non-fresh starting point (below).

**Carry-over vehicles (transfer learning):**
- Why it works: brains see only local inputs (rays + speed), never map position, so what they learn is corner *shapes*, not a specific track. That is the point to explain on the Results page.
- **Keep my vehicles** button: saves the current population per vehicle type to the browser's localStorage (same JSON format as the shipped brains). No backend.
- On Race, the user chooses a starting point: **Fresh** (random brains, default), **My vehicles** (carried over, keep evolving), or **Generalist** (pre-trained, keep evolving).
- In "Test on unseen track", **My vehicles** is a third contender next to specialist and generalist (frozen, one attempt, same completion-rate definition).
- When racing with carried vehicles, the HUD shows "first lap in X generations vs Y from scratch". *(Designer's call)* Y comes from the user's own fresh run on that track if they've done one; otherwise the stat shows X only.

**Experiments for the Results page (run headless, numbers + charts committed):**
1. Specialist vs generalist on a held-out set of random tracks: lap completion rate with zero extra training.
2. Cars vs bikes: generations to first full lap, and the different racing lines they settle on.
3. Transfer: populations trained on track A, then evolved on track B, compared against fresh populations on B by generations to first lap. Also: which corners on B produce scrapes or crashes, against how similar they are to corners on A.

**Scrape visuals:** spark particles at the contact point, scaled by intensity; faint scrape marks left on the wall that build up where vehicles rub most (a visible heatmap of the hard corners). Both are cleared on track change. The 2D view shows a simple equivalent (a flash at the contact point).

**Track editor:** freehand draw a loop top-down → auto-close and smooth into a spline → validate (closed, no self-intersection, corners not impossibly tight) and show an error if invalid. Buttons for "Random track" and "Default track".

**Screens:**
- Main view: 3D race (default) with chase cam / orbit / top-down toggle; HUD panel (stats, chart, NN diagram, damage of leading vehicle); controls (speed, cars/bikes on/off, draw track, starting point Fresh/My vehicles/Generalist, keep my vehicles, test unseen track, reset training).
- Results / How it works page.

## Build order (3 weeks)

- **Week 1:** sim (including scrape/crash/damage), NN, GA, track model, random track generator, plain 2D view. A working 2D product by the end of the week.
- **Week 2:** 3D renderer, track editor, 2D→3D camera swoop, HUD, chart, NN diagram, sparks and scrape marks, cars vs bikes tuning.
- **Week 3:** headless pre-training of specialist/generalist, unseen-track test mode, carry-over vehicles (save/load, starting-point picker, transfer stat), experiments and Results page, README + GIF, deploy, polish.

## Left to the builder

NN layer sizes, GA hyperparameters, exact vehicle physics numbers, visual style and colours, chart approach (tiny library or hand-drawn canvas), whether the sim runs in a Web Worker, camera details, how many random tracks the generalist trains on.
