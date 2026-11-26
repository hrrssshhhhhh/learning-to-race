# Self-learning vehicles

100 cars and 100 bikes start with random brains and teach themselves to race any track you draw. Each vehicle has a small neural network; a genetic algorithm keeps the best drivers and breeds the next generation. The neural network, the genetic algorithm, the physics and the sensors are all written from scratch in TypeScript, with no ML libraries.

**Live:** _link added at launch_ · **Results:** [`/results.html`](results.html) · **Report:** [`docs/report.md`](docs/report.md)

![Cars and bikes learning the default circuit](docs/demo.gif)
<!-- docs/demo.gif is recorded by hand after launch -->

## What you can do

- Watch both populations learn the default circuit in 3D (chase, orbit or top camera) or 2D.
- Draw your own track and race on it. Invalid drawings (too small, self-crossing, corners too tight) are rejected with a reason.
- Start from random brains, your own saved vehicles, or the shipped pre-trained population.
- Test on an unseen track: pre-trained, random and your own vehicles, side by side, one attempt each, with completion rates.
- Follow the leader's live neural network, damage and lap times in the side panel.

## How it works

```
 7 distance rays + speed          neural network            controls
 ─────────────────────────►   8 → 10 → 2  (112 weights)  ─►  steer, throttle
          ▲                                                      │
          │                       physics + walls                ▼
          └──────────── sensors ◄── vehicle state ◄──── fixed 60 Hz step
                                         │
                       fitness: checkpoints + lap time − damage
                                         │
                 genetic algorithm: keep top 5, tournament of 20, mutate 30%
```

| Folder | What lives there |
|---|---|
| `src/sim` | Tracks, random track generator, car and bike physics, sensors, wall contact, the world loop |
| `src/ml` | Neural network and genetic algorithm |
| `src/render2d`, `src/render3d` | 2D broadcast map and the Three.js night circuit |
| `src/editor` | Track drawing |
| `src/ui` | Landing, controls, side panel, charts, network diagram |
| `src/storage` | Saving and loading populations |
| `scripts` | Headless pre-training and experiments |

The simulation runs on a fixed timestep, so results never depend on frame rate, and every run is seeded, so the experiments are reproducible.

## Run it

```bash
npm install
npm run dev            # the app at http://localhost:5173
npm test               # unit tests, plus the learning-speed checks
npm run build          # typecheck and production build
npm run pretrain       # re-train the shipped population (about 2 min)
npm run experiments    # re-run the experiments behind the Results page (~35 min)
```

## Results

Four experiments, run headless with the same simulation as the browser on a harder family of random tracks (`npm run experiments`, about 35 minutes on 8 cores). A population has *learned* a track when half of it laps in one generation. Intervals are 95% bootstrap confidence intervals; paired comparisons use the Wilcoxon signed-rank test. Charts and per-run data are on the [Results page](results.html); method, discussion and limitations are in the [report](docs/report.md).

| Question | Result |
|---|---|
| Does pre-training carry over to unseen tracks? | Trained on the default track only, pre-trained cars complete a lap on **59%** of attempts across 50 unseen tracks (95% CI 58–59%), bikes **55%** (55–56%). Random networks: **0%** (p < 0.001). |
| Who learns faster, cars or bikes? | No significant difference: median **10** vs **9** generations to learn a track across 30 paired tracks (p = 0.345). |
| Does learning one track help on the next? | Yes, strongly: after learning track A, cars learn a new track B in a median of **1** generation instead of **11.5** from scratch, sooner on **20 of 20** pairs (median saving 10.5, 95% CI 7.5–13, p < 0.001). |
| Where does transfer fail? | Corners tighter than anything on track A are 11% of corners but drew **35%** of the crashes. |
| How much does each sensor matter? | Completion on unseen tracks: 3 rays **37%**, 5 rays **50%**, 7 rays **45%**. Three rays also learn far slower (median 35.5 vs 9.5 generations). 3 vs 7: p = 0.053, suggestive only; 5 rays match 7. |

Why transfer works: the sensors are local, so a network never learns a track. It learns how to react to walls at a given distance and speed, which carries to any track whose corners it has already met.
