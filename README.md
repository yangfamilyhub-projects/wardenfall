# Wardenfall

A web prototype of a boss-fight action game built around Wildstar-style telegraphs and high-mobility real-time combat. It's a single boss in a single arena, with no overworld.

Open `index.html` in a browser. It runs on desktop and on phones and tablets. Three.js r128 loads from cdnjs.

## Controls
- **Keyboard and mouse:** WASD to move, mouse to aim. Click for Slash, Q or right-click for Lunge, E for Burst. Space jumps (press again in the air to double jump). Shift dashes, on the ground or in the air.
- **Touch:** drag on the left half of the screen to move. The buttons on the right attack, jump and dash.

## Systems
- **Telegraphs:** one shader draws circles, rings, cones and rectangles that fill as they charge. Red hits everything, amber hits only the ground (jump it), and magenta hits only the air. Blue shapes are the player's own attacks.
- **Movement:** double jump, two dash charges usable on the ground or in the air, coyote time, and air control. Dash gives no i-frames by default (`CFG.player.dashIFrames`).
- **Boss:** each ability is a generator script (`yield seconds`). The boss has three phases, expanding shockwaves, and a Cataclysm channel with interrupt armor and safe pads.
- **Adaptive director (`Mind`):** profiles the player's range, air time, dodge timing and sidestep rate, and unlocks counter-abilities: Skyward Lances, Chain Pull, Whirling Rend, Feints, Echo Strikes and Pincer Rails. Ability choice is weighted toward attacks that have been landing. Memory persists in localStorage.

All tuning values live in the `CFG` block at the top of the script.

## Hosting
Live at https://wardenfall.zizzy.name, with branch test slots at `wf1`–`wf4.zizzy.name`. See [docs/hosting.md](docs/hosting.md) for deploying, testing branches and rebuilding the setup.
