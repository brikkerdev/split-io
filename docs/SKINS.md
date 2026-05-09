# Skins authoring guide

Skins are pure cosmetics applied to the hero — they affect:

- the player marker (circle + heading triangle),
- the trail line,
- the captured-territory fill (color **and** pattern),
- the skin gallery preview swatch.

A skin is just an entry in `src/config/skins.ts` plus a localized name in
`src/locales/{ru,en,tr}.ts`. No assets, no atlas changes.

The pattern system lets us scale the catalog cheaply: all visuals are
procedural, so a new skin = ~3 lines of code.

## Anatomy of a skin

```ts
{
  id: "daily_meadow",       // [a-z0-9_-], unique, never renamed
  nameKey: "skin.meadow",   // localized name key (3 locales)
  cost: 0,                  // shop price in coins, or 0 for daily/starter
  fill: 0x9bd35c,           // RGB hex base color
  fillSecondary: 0xff7a6b,  // optional 2nd colour for two-tone skins
  marker: "star",           // arrow | dot | diamond | star
  pattern: "stars",         // PatternId (see below)
  dailyOnly: true,          // optional — if true, can ONLY be earned via daily streak
  rarity: "rare",           // common | rare | epic | legendary (gallery accent only)
}
```

### Field rules

- **`id`** — snake_case, alphanumeric + `_-` only (Yandex asset name rule).
  Once shipped, never rename: it lives forever inside player saves.
  Daily-pool skins use the `daily_*` prefix.
- **`fill`** — saturated mid-tone works best. Avoid pure black/white unless
  the pattern adds enough contrast (we shade ±32% for accents). Aim for
  HSL-distinct colors so adjacent gallery cards don't look the same.
- **`marker`** — one of the four shapes baked in `triangle.png`. Pick the one
  that visually rhymes with the skin's vibe (e.g. `star` for celestial).
- **`pattern`** — see catalog below. Pick one that contrasts with the fill.
  "solid" is reserved for the starter / palette-cleanser skins.
- **`cost`** — see "Where the skin comes from" below. Costs follow a
  rough geometric ladder: 200 → 300 → 500 → 700 → 1000 → 1500 → 2500.
- **`rarity`** — affects only the card frame in the gallery. Reserve
  `legendary` for skins with strong identity (e.g. `daily_eclipse`).

## Patterns

All patterns are defined in `src/config/skinPatterns.ts` as procedural
generators. Two outputs are baked from each:

1. CSS background string for gallery / daily-modal previews.
2. 32×32 raster tile rendered live on territory in-game (one Phaser
   canvas-texture per `(pattern, fill)` combo, lazily registered by
   `PatternTextureCache`, drawn as an alpha-masked TileSprite per owner).
   Bots and the hero share this pipeline.

Catalog: `solid · stripes · dots · checker · grid · waves · diamond · zigzag · scales · plaid · hex · circuit · stars · noise · rays · weave · duo · duo_diag · duo_split`.

The three `duo*` patterns are dedicated layouts for two-tone skins (horizontal half / diagonal half / centred-band split). Any pattern can also be combined with `fillSecondary` — the secondary colour replaces the dark accent the pattern would otherwise auto-shade from the base, so e.g. `pattern: "stripes"` + `fillSecondary` yields true two-colour stripes.

To add a new pattern, extend `PatternId` and provide both
`patternCss` (CSS gradient) and `rasterPattern` (Canvas2D) cases.

## Where the skin comes from

| Source              | `cost`    | `dailyOnly` | Visibility in gallery                      |
|---------------------|-----------|-------------|--------------------------------------------|
| Starter             | `0`       | `false`     | Always selectable                          |
| Shop                | `> 0`     | `false`     | Buyable for coins                          |
| Daily reward        | `0`       | `true`      | Locked card with "Daily reward" badge      |

To put a daily skin into the streak schedule, append its `id` to
`DAILY_SKIN_POOL` in `src/config/dailyRewards.ts`. Order matters — pool
entries are consumed in order across the 90-day cycle. The cycle awards
a skin on day 3 then every 4 days (≈ 23 skin slots per 90-day window).

## Visual checklist before merging

1. The card looks distinct from neighbors in the gallery.
2. The pattern is still readable on dark territories (preview at
   `--bg` 0xf7f4ee and at the dark void color).
3. The marker is visible against the fill — bump `shadeColor` if needed.
4. All three locales have a `skin.<id>` translation. Missing keys break
   `t()` and surface the raw id.
5. `npm run test` passes (skins.test.ts validates the daily/shop split).

## Add-a-skin checklist (TL;DR)

- [ ] New entry in `src/config/skins.ts`.
- [ ] `skin.<id>` in `ru.ts`, `en.ts`, `tr.ts`.
- [ ] If daily-only: append `id` to `DAILY_SKIN_POOL` in `dailyRewards.ts`.
- [ ] Run tests; visually inspect Skins gallery + Daily modal.
