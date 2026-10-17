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
| **Mouse drag** | orbit the camera |
| **Space** (hold) | jump, then fly on the scarf's glowing charge |
| **E / Q / right-click** | sing — wakes grey cloth, calls the cloth creatures, lights up nearby cloth |
| Gamepad | left stick walk, right stick look, A fly, X/B sing |
| Touch | left half joystick, right half look, on-screen FLY / SING |

Walk toward the glowing split in the mountain. Dunes steeper than ~15° turn walking into **sand-surfing**.

## What's in it

- **Sand shader** (`src/world/terrain.js`) after John Edwards' GDC 2013 talk "Sand Rendering in Journey":
  high-contrast "phenomenological" diffuse, wind ripples that follow dune slope, a wide "ocean" specular sheen,
  Fresnel rim light, and multi-scale glitter that stays about a pixel wide at any distance.
- **Chunked infinite dunes** streamed around the traveler plus one coarse far mesh carrying the mountain.
- **Four chapters** driven by one colour script (`src/world/palette.js`): golden dunes → amber ruins at dusk →
  the blue depths (canyon, rock arches, shafts of light) → snow and white-out.
- **The traveler**: robe, hood and a verlet-simulated scarf whose glyphs glow with flight charge and grow when
  you collect floating symbols.
- Cloth mechanics: dormant grey banners turn red when sung to, floating cloth recharges the scarf, curious cloth
  creatures swoop around you, stone-and-bronze guardians hunt you unless you shelter under stone.
- Shrines show procedural cave-painting visions; a collapse / revival / flight-to-the-summit ending.
- Fully synthesised score (`src/audio.js`): drifting pad per chapter, cello-like melody, singing voice, wind,
  sand hiss, bells.

## Debug URL flags

`?p=0.4` start at 40 % of the journey · `?glyphs=6` start with 6 symbols · `?auto` skip the title (and mute) ·
`?mute` no audio. `window.__game` exposes internals; `window.__advance(seconds)` steps the simulation.

## Credits

Design inspiration: *Journey* by thatgamecompany (Jenova Chen, Kellee Santiago, John Edwards, Matt Nava,
Austin Wintory). This project is not affiliated with or endorsed by them or Sony.
