# Seryn anatomical portrait

`portrait.json` contains only graphical asset data: the head/neck region of the
MakeHuman basemesh with female and facial morphs, fitted eye geometry, one
Catmull–Clark subdivision, Seryn-specific shaping and a smooth scalp sampler.
The game constructs its usual synchronous Three.js rig from this baked data.

## Provenance and licensing

- Basemesh, targets and high-poly eyes: MakeHuman Community, **CC0 1.0 Universal**.
  Source revision: `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`.
  https://github.com/makehumancommunity/makehuman/tree/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data
  License clarification: https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.md
  The asset license is reproduced in `LICENSE-CC0.txt`. No MakeHuman program
  source was imported; its separate application-code license does not apply to
  these graphical assets.
- `public/assets/heroes/seryn/portrait-albedo.png`: original
  `darthfurby_caucasian_female.png`, by **darthfurby**, **CC0**, from the community's
  natural-female skin pack. No reference portrait is pasted onto the model.
  https://static.makehumancommunity.org/assets/assetpacks/skins01.html
  https://www.makehumancommunity.org/node/1549
  Pack: https://files.makehumancommunity.org/asset_packs/skins01/skins01_cc0.zip

## Rebuild

From the repository root: `python scripts/assets/build-seryn-portrait.py`.
Python 3 standard library only. The script downloads pinned OBJ/target data to
`node_modules/.cache/seryn-source` and regenerates `portrait.json`; it never runs
downloaded code. The original skin PNG is included in the repository, so building
or playing the game needs no network request to a third party.

The procedural hair, eyebrows, eyelashes and diadem are fitted at runtime.
The source portrait (`H002I.webp`) remains an artistic reference; this is an
approximation of that character, not a photogrammetric reconstruction.
