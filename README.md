# Journey — a three.js tribute

An unofficial, non-commercial fan homage to thatgamecompany's *Journey* (2012), built from scratch with
[three.js](https://threejs.org). No assets are used: terrain, textures, models and music are all procedural.

```bash
npm install
npm run dev        # http://localhost:5173
```

## Controls

| | |
|---|---|
| **W A S D / arrows** | walk (camera-relative) |
| **Mouse** | look (click to capture the mouse; drag also works) · **wheel** zoom |
| **Space** | jump; hold to fly (flutter upward) on the scarf's glowing charge; with an empty scarf, holding it glides |
| **C** (or **G**) | toggle **glide** while airborne: robe spread, slow sink, fast forward flight, banked turns; costs no charge |
| **Shift** (hold) | **dive**: tuck and plunge, trading height for speed; let go (or skim the ground) to pull out into a swoop |
| **Z / X** · **R** · **V** | aerial maneuvers (airborne, ≥3 m up): barrel roll left / right (a sideways slide that sheds height; out of a dive it winds into a two-turn corkscrew), loop (up, over and back down), twirl (a pirouette with the robe flared). Chain them freely; companions join in |
| **E / Q / right-click** | sing; hold and release for a long call that carries much further |
| **Esc / P** | pause menu: look sensitivity, invert Y, volume (saved per browser) |
| Gamepad | left stick walk, right stick look, A / RT fly, LB / Y glide, RB dive, X / B / LT sing, Start pause, d-pad ← / → roll, ↑ loop, ↓ twirl |
| Touch | left half joystick, right half look, on-screen FLY / GLIDE / DIVE / SING / ROLL (toward the stick) / LOOP |

Walk toward the glowing split in the mountain. Steep dunes turn walking into **sand-surfing**; you can still
trudge up them slowly. Follow the pillars of light to the symbols that lengthen your scarf.

### Flight modes

All flight is fed by the scarf: symbols lengthen it and so its charge.

- **Flutter** (hold Space): rise in soft beats while the charge lasts; the sleeves beat with each flap.
- **Glide** (C): sleeves and robe spread like a paraglider. Sink ~1.7 m/s, cruise 14 m/s, turns bank in at up to
  1.6 rad/s; push the stick against your flight to flare and slow down. Free. Glide also kicks in when the
  charge runs out while Space is held, after a swoop, and when you leave the top of a wind column.
- **Dive** (hold Shift, at least 2.5 m up): tucked, plunging up to 40 m/s with the horizon tilting toward you.
  Releasing converts the fall into forward speed (45 % high up, up to 85 % within a few metres of the ground,
  capped at 34 m/s) and a short rising arc; skim too low and it pulls out for you.
- **Soar**: swirling columns of sand, motes and red cloth (`src/world/updrafts.js`) lift you up to ~11 m/s
  and refill the scarf; walking into one lifts you off. Positions come from a function so any world can feed them.
- **Ribbon boost**: flying past a cloth creature or your companion gives a short charged burst forward with a
  trail of light (each source once every 6 s).

- **Slide hazards** (`src/world/slidehazards.js`): boulders sit in the floor and low walls of both long sand slides
  (steer round them or jump them; a hit costs speed, a short stun and a hop). Sandworms are Dune-sized and unhurried: the
  sand shakes and dust heaves for ~2.5 s to a deep rock-grinding rumble, then a worm slowly rises out of the sand facing you
  right where you were heading — a huge, low, armoured body skimming the surface, a round maw wide open and bristling with hundreds of needle teeth around a dark throat (you can glide
  or jump over it) — ploughs sideways through the sand, and sinks back. Hit one and you are flung up and lose scarf charge. Companions get hit too; `?auto` steers round both.

The camera pulls back and widens in a glide; a dive tucks it in with an FOV kick and slight shake (both off
with *Reduce motion*). Each mode has its own sound: soft flaps, a broad gliding wind, a whoosh that rises in pitch
with dive speed, a whistling column.

## What's in it

- **Sand shader** (`src/world/terrain.js`) after John Edwards' GDC 2013 talk "Sand Rendering in Journey":
  high-contrast "phenomenological" diffuse, wind ripples that follow dune slope, a wide "ocean" specular sheen,
  Fresnel rim light, and multi-scale glitter that stays about a pixel wide at any distance.
- **Seeded worlds** (`src/world/seed.js`, `src/world/layout.js`): the noise, route meander, dune grain, mountain,
  ruined-city plazas, shrines, symbols, cloth, creatures and murals all derive from one seed via independent
  streams (`rngFor(tag)`); `layout.js` exports the chapter plan (`PLAN`) and the built sites per chapter (`SITES`).
- **Chunked infinite dunes** streamed around the traveler plus one coarse far mesh carrying the mountain.
- **Four chapters** driven by one colour script (`src/world/palette.js`): golden dunes → amber ruins at dusk →
  the blue depths (canyon, rock arches, shafts of light) → snow and white-out.
- **The traveler**: a robe whose hem sways, flares and is kicked forward by thin IK-driven legs; a hood whose
  soft point flops with every turn; head turns toward symbols, shrines and your companion; squash on landings;
  lean into turns, acceleration and headwinds. The verlet scarf has air drag relative to the wind, so it hangs
  at rest, streams out at speed and floats when charged.
- **Movement**: coyote time and jump buffering, momentum-keeping air control, carving sand-surfs up to 25 m/s
  with launches off crests, slide grooves and footprints in the sand, a chase camera that leads your motion,
  climbs over dunes that would hide you, and frames the summit during the finale.
- **A companion**: another traveler waits on a dune early on, walks a little ahead of you, answers your song,
  follows you into the air, fills your scarf when you sing close together, and is lost to you in the blizzard.
- **Post-processing** (`src/post.js`): screen-space light shafts from the sun, plus a grade pass (saturation,
  contrast, warm vignette, film grain) and the snow chapter's white-out.
- Chapter titles, a pause menu, snow gusts that push you back unless you shelter behind standing stones,
  and an end card that counts the symbols you found.
- Cloth mechanics: dormant grey banners turn red when sung to, floating cloth recharges the scarf, curious cloth
  creatures swoop around you, stone-and-bronze guardians hunt you unless you shelter under stone.
- Shrines show procedural cave-painting visions; a collapse / revival / flight-to-the-summit ending.
- **Buildings you can enter** (`src/interiors/`): one glowing doorway per chapter (a desert ruin, a temple in the
  sunken city, a cave mouth in the depths, a stone hut on the ascent), each opening onto a seeded mini world with
  its own light, fog, grade and room tone: the *Hall of Falling Sand* (sunlit hall, sand pouring through cracks,
  a symbol in the light), the *Sleeping Garden* (cloth flowers that bloom when sung to; wake them all and a cloth
  creature follows you), the *Tower of Wind* (ride a wind column past cloth ledges to a vision at the top), the
  *Pocket of Stars* (lift drifting lights into a constellation that gives you a symbol) and the *Chamber of
  Memory* (murals that tell the story, ending on one no shrine shows). Companions walking with you come along.
- Fully synthesised score (`src/audio.js`): drifting pad per chapter, cello-like melody, singing voice, wind,
  sand hiss, bells.

## Debug URL flags

`?p=0.4` start at 40 % of the journey · `?glyphs=6` start with 6 symbols · `?auto` skip the title (and mute) ·
`?mute` no audio · `?seed=123` build world 123 (otherwise every new journey gets a random world; the seed is saved
with progress and shown in the pause menu). `window.__game` exposes internals; `window.__advance(seconds)` steps the simulation;
`window.__view({ p, yaw, pitch, dist })` teleports along the path and frames the traveler.
`?room=garden` (or a door index, `?room=2`) walks straight into a building; `window.__enter('tower')` / `__enter(1)` and
`window.__exit()` do the same at any time, `__game.interiors.info()` lists the doors; `?auto&rooms` makes the
autopilot detour through every doorway.

## Credits

Design inspiration: *Journey* by thatgamecompany (Jenova Chen, Kellee Santiago, John Edwards, Matt Nava,
Austin Wintory). This project is not affiliated with or endorsed by them or Sony.
