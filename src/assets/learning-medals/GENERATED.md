# Additional study medals

Created with the built-in image generation tool from the existing Kenney Medals
CC0 artwork (see LICENSE.txt). The original images remain unchanged.

Prompt set: preserve the original vertical ribbon and circular medal proportions,
front-facing flat illustrated style, restrained two-tone shading, and transparent
background; keep all decoration inside the medal footprint, without text.

The first versions (navy diamond, champagne star, rose sun) were edited into the
`-v2` files below and are no longer kept. Of the Kenney originals, only the
flatshadow medals the app shows are kept.

- `medal-navy-diamond-v2.webp`: 40-hour / 30-day emblem update. Edit prompt:
  preserve the existing ribbon, disc, rim, proportions and transparent framing;
  replace only the center with a midnight-navy diamond, two flat facets and a
  thin warm-gold edge. Generated with the built-in image generation tool.
- `medal-champagne-flame-v2.webp`: 50-hour / 60-day emblem update. Edit prompt:
  preserve the existing burgundy ribbon, champagne disc, rim and silhouette;
  replace only the star with a simple burgundy flame, one curling tip and a
  small gold inner cutout, readable at the existing icon size. Generated with
  the built-in image generation tool.
- `medal-emerald-sun-v2.webp`: replaces the plain sun at the 60-hour / 100-day tier.
  Edit prompt: preserve the original footprint and green ribbon; brighten the
  rose-gold disc, add a warm-gold lip and concentric rim, and use a pointed solar
  compass with a small emerald center. Keep the detail calmer than the platinum
  medal, with no external ornaments or glow. Generated with the built-in tool.
- `medal-platinum-compass.webp`: royal-indigo ribbon, platinum disc, faceted double
  rim, eight-point compass star with a small sapphire center. Uses the existing
  silver medal for geometry and the champagne medal for the illustration style.

The generated 1254x1254 PNGs (550-730 KB each) are no longer shipped. Each was
cropped to its visible artwork (the boxes below, `x y width height` in the original
pixels) so every medal has the same display height, scaled to 240 px tall (about
3x the largest on-screen size of 66 px) and saved as WebP (quality 88, alpha kept),
8-10 KB each. The originals remain in git history at commit 9ecf775.

- navy diamond: `349 125 556 1041`
- champagne flame: `287 75 683 1120`
- emerald sun: `313 75 628 1116`
- platinum compass: `287 74 684 1124`
