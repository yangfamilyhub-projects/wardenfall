# Wardenfall

A web prototype of a boss-fight action game built around Wildstar-style telegraphs and high-mobility real-time combat. It's two boss levels in a single arena, with no overworld.

Open `index.html` in a browser. It runs on desktop and on phones and tablets. Three.js r128 loads from cdnjs.

## Controls
- **Keyboard and mouse:** WASD to move, mouse to aim. Click for Slash, Q or right-click for Lunge, E for Burst. Space jumps (press again in the air to double jump). Shift dashes, on the ground or in the air.
- **Touch:** drag on the left half of the screen to move. The buttons on the right attack, jump and dash.

## Systems
- **Telegraphs:** one shader draws circles, rings, cones and rectangles that fill as they charge. Red hits everything, amber hits only the ground (jump it), and magenta hits only the air. Blue shapes are the player's own attacks.
- **Movement:** double jump, two dash charges usable on the ground or in the air, coyote time, and air control. Dash gives no i-frames by default (`CFG.player.dashIFrames`).
- **Levels:** `ENCOUNTERS` lists the bosses in order. Level 1 is the Sentinel: one phase, slow windups (`CFG.sentinel.timeScale`), light damage, and it never adapts. Level 2 is the Warden. Each level opens with an intro card, and your HP carries over (`CFG.carryHp`). If you lose, you can retry that level with the HP you started it with, or start over. In multiplayer each level is its own fight: others can join whichever level you're on, but they don't follow you into the next one.
- **Boss:** each ability is a generator script (`yield seconds`). The boss has three phases, expanding shockwaves, and a Cataclysm channel with interrupt armor and safe pads.
- **Adaptive director (`Mind`):** profiles the player's range, air time, dodge timing and sidestep rate, and unlocks counter-abilities: Skyward Lances, Chain Pull, Whirling Rend, Feints, Echo Strikes and Pincer Rails. Ability choice is weighted toward attacks that have been landing. The profile keeps updating during the Sentinel fight, so the Warden starts with what it saw there; counters only unlock once the Warden fight begins. Memory persists in localStorage.
- **Where you stand:** the Mind also keeps a heatmap of the arena (3m cells, fading over about a minute) and tracks rim time and time spent behind the boss during its casts. These unlock three spatial counters. Warding Sigils marks your favourite spots. Crumbling Rim collapses the edge you hug (the whole rim in phase III). Backhand Rend adds a rear swing to Rending Cleave. The Mind panel draws the heatmap, with dashed circles on the spots the Sigils will hit.

All tuning values live in the `CFG` block at the top of the script.

## Hosting
Live at https://wardenfall.zizzy.name, with branch test slots at `wf1`–`wf4.zizzy.name`. See [docs/hosting.md](docs/hosting.md) for deploying, testing branches and rebuilding the setup.
