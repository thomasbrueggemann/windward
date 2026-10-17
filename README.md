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
| **Space** | jump; hold to fly on the scarf's glowing charge |
| **E / Q / right-click** | sing; hold and release for a long call that carries much further |
| **Esc / P** | pause menu: look sensitivity, invert Y, volume (saved per browser) |
| Gamepad | left stick walk, right stick look, A fly, X/B sing, Start pause |
| Touch | left half joystick, right half look, on-screen FLY / SING |

Walk toward the glowing split in the mountain. Steep dunes turn walking into **sand-surfing**; you can still
trudge up them slowly. Follow the pillars of light to the symbols that lengthen your scarf.

## What's in it

- **Sand shader** (`src/world/terrain.js`) after John Edwards' GDC 2013 talk "Sand Rendering in Journey":
  high-contrast "phenomenological" diffuse, wind ripples that follow dune slope, a wide "ocean" specular sheen,
  Fresnel rim light, and multi-scale glitter that stays about a pixel wide at any distance.
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
- Fully synthesised score (`src/audio.js`): drifting pad per chapter, cello-like melody, singing voice, wind,
  sand hiss, bells.

## Debug URL flags

`?p=0.4` start at 40 % of the journey · `?glyphs=6` start with 6 symbols · `?auto` skip the title (and mute) ·
`?mute` no audio. `window.__game` exposes internals; `window.__advance(seconds)` steps the simulation;
`window.__view({ p, yaw, pitch, dist })` teleports along the path and frames the traveler.

## Credits

Design inspiration: *Journey* by thatgamecompany (Jenova Chen, Kellee Santiago, John Edwards, Matt Nava,
Austin Wintory). This project is not affiliated with or endorsed by them or Sony.
