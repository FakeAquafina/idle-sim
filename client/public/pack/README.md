# Art pack (not in git)

The viewer can use the **Cozy Isometric Exterior** pixel-art pack by Choco Ted
(https://choco-ted.itch.io/cozy-isometric-pixel-art-asset-pack-32x32-exterior-game-assets-for-godot-unity)
for grass, paths, trees and houses. Its licence forbids redistributing the files,
so nothing from it is committed: this folder is gitignored apart from this note.

To install it on a machine:

1. Download the pack zip from itch.io and copy it into this folder
   (`client/public/pack/`). Any `*.zip` here is picked up.
2. Run `npm run pack -w client` (or just `npm run build`, which does it first).
   That writes `manifest.json` and the few PNGs the viewer needs.

Without a zip the viewer draws everything in code, as it always did.
The free version is credited in the viewer's hint bar, as its licence asks.
