// Cosmetic skins. Each skin = base fill color + procedural pattern.
//
// Sources:
//  • cost > 0  → bought from Skins gallery for coins
//  • cost = 0, dailyOnly = true → granted by daily-reward streak schedule
//  • cost = 0, no dailyOnly      → starter skin (always unlocked)
//
// To add a new skin:
//  1. Append a SkinDef below with a unique `id` (snake_case, [a-z0-9_-]).
//  2. Add localized name keys "skin.<id>" in src/locales/{ru,en,tr}.ts.
//  3. If the skin is meant for the daily schedule, set cost = 0 and
//     dailyOnly = true, then reference the id in src/config/dailyRewards.ts.
//  4. Pick a `pattern` from PatternId in src/config/skinPatterns.ts.
//
// See docs/SKINS.md for full authoring guidelines.

import type { PatternId } from "./skinPatterns";

export interface SkinDef {
  id: string;
  nameKey: string;
  cost: number;
  fill: number;
  marker: "arrow" | "dot" | "diamond" | "star";
  pattern: PatternId;
  /**
   * Optional second colour. When set, the pattern's "dark" accent is replaced
   * with this RGB hex instead of the auto-shaded base — yields a true
   * two-tone skin (combine with patterns like `duo`, `stripes`, `checker`).
   */
  fillSecondary?: number;
  /** Skin can only be obtained from the daily-reward schedule. */
  dailyOnly?: boolean;
  /** Optional rarity tag — purely for gallery sort/coloring. */
  rarity?: "common" | "rare" | "epic" | "legendary";
}

export const SKINS: readonly SkinDef[] = [
  // ── Starter & shop skins — solid colours, no patterns ─────────
  { id: "neon_cyan",   nameKey: "skin.cyan",   cost: 0,    fill: 0x21f0ff, marker: "arrow",   pattern: "solid", rarity: "common" },
  { id: "neon_pink",   nameKey: "skin.pink",   cost: 200,  fill: 0xff3df0, marker: "arrow",   pattern: "solid", rarity: "common" },
  { id: "neon_lime",   nameKey: "skin.lime",   cost: 200,  fill: 0xb6ff3b, marker: "dot",     pattern: "solid", rarity: "common" },
  { id: "neon_amber",  nameKey: "skin.amber",  cost: 300,  fill: 0xffb13b, marker: "dot",     pattern: "solid", rarity: "common" },
  { id: "neon_red",    nameKey: "skin.red",    cost: 300,  fill: 0xff5252, marker: "diamond", pattern: "solid", rarity: "common" },
  { id: "neon_violet", nameKey: "skin.violet", cost: 500,  fill: 0x9d3bff, marker: "diamond", pattern: "solid", rarity: "rare"   },
  { id: "neon_mint",   nameKey: "skin.mint",   cost: 500,  fill: 0x3bff9d, marker: "star",    pattern: "solid", rarity: "rare"   },
  { id: "neon_sky",    nameKey: "skin.sky",    cost: 700,  fill: 0x3bd1ff, marker: "star",    pattern: "solid", rarity: "rare"   },
  { id: "neon_rose",   nameKey: "skin.rose",   cost: 800,  fill: 0xff3b95, marker: "arrow",   pattern: "solid", rarity: "rare"   },
  { id: "neon_gold",   nameKey: "skin.gold",   cost: 1000, fill: 0xffe33b, marker: "diamond", pattern: "solid", rarity: "epic"   },
  { id: "neon_white",  nameKey: "skin.white",  cost: 1500, fill: 0xffffff, marker: "star",    pattern: "solid", rarity: "epic"   },
  { id: "neon_black",  nameKey: "skin.black",  cost: 2500, fill: 0x202535, marker: "arrow",   pattern: "solid", rarity: "legendary" },

  // ── Two-tone shop skins ──────────────────────────────────────
  { id: "duo_split",     nameKey: "skin.duo_split",     cost: 600,  fill: 0x21f0ff, fillSecondary: 0xff3df0, marker: "arrow",   pattern: "duo",       rarity: "rare"      },
  { id: "duo_lemon",     nameKey: "skin.duo_lemon",     cost: 800,  fill: 0xffe33b, fillSecondary: 0xb6ff3b, marker: "dot",     pattern: "stripes",   rarity: "rare"      },
  { id: "duo_grape",     nameKey: "skin.duo_grape",     cost: 1200, fill: 0x9d3bff, fillSecondary: 0xff3b95, marker: "diamond", pattern: "duo_diag",  rarity: "epic"      },
  { id: "duo_sunset",    nameKey: "skin.duo_sunset",    cost: 1400, fill: 0xff7a2c, fillSecondary: 0xff3df0, marker: "star",    pattern: "checker",   rarity: "epic"      },
  { id: "duo_ocean",     nameKey: "skin.duo_ocean",     cost: 1800, fill: 0x3bd1ff, fillSecondary: 0x4a6dff, marker: "diamond", pattern: "waves",     rarity: "epic"      },

  // ── Daily-only skins ──────────────────────────────────────────
  // Mix of plain colours (early/common) and patterned ones (rarer).
  { id: "daily_coral",     nameKey: "skin.coral",     cost: 0, fill: 0xff7a6b, marker: "arrow",   pattern: "solid",   dailyOnly: true, rarity: "common" },
  { id: "daily_aqua",      nameKey: "skin.aqua",      cost: 0, fill: 0x4fe5d9, marker: "dot",     pattern: "solid",   dailyOnly: true, rarity: "common" },
  { id: "daily_lavender",  nameKey: "skin.lavender",  cost: 0, fill: 0xc7a2ff, marker: "diamond", pattern: "solid",   dailyOnly: true, rarity: "common" },
  { id: "daily_sun",       nameKey: "skin.sun",       cost: 0, fill: 0xffd84d, marker: "star",    pattern: "rays",    dailyOnly: true, rarity: "epic"   },
  { id: "daily_jade",      nameKey: "skin.jade",      cost: 0, fill: 0x4fd18a, marker: "dot",     pattern: "solid",   dailyOnly: true, rarity: "common" },
  { id: "daily_blossom",   nameKey: "skin.blossom",   cost: 0, fill: 0xff9ec9, marker: "star",    pattern: "dots",    dailyOnly: true, rarity: "rare"   },
  { id: "daily_sapphire",  nameKey: "skin.sapphire",  cost: 0, fill: 0x4a6dff, marker: "diamond", pattern: "circuit", dailyOnly: true, rarity: "epic"   },
  { id: "daily_ember",     nameKey: "skin.ember",     cost: 0, fill: 0xff6a2c, marker: "arrow",   pattern: "noise",   dailyOnly: true, rarity: "epic"   },
  { id: "daily_glacier",   nameKey: "skin.glacier",   cost: 0, fill: 0xa8e8ff, marker: "diamond", pattern: "solid",   dailyOnly: true, rarity: "common" },
  { id: "daily_forest",    nameKey: "skin.forest",    cost: 0, fill: 0x2f8c5a, marker: "star",    pattern: "plaid",   dailyOnly: true, rarity: "epic"   },
  { id: "daily_orchid",    nameKey: "skin.orchid",    cost: 0, fill: 0xc14fff, marker: "arrow",   pattern: "waves",   dailyOnly: true, rarity: "epic"   },
  { id: "daily_topaz",     nameKey: "skin.topaz",     cost: 0, fill: 0xffc14f, marker: "dot",     pattern: "solid",   dailyOnly: true, rarity: "common" },
  { id: "daily_obsidian",  nameKey: "skin.obsidian",  cost: 0, fill: 0x35384a, marker: "diamond", pattern: "zigzag",  dailyOnly: true, rarity: "epic"   },
  { id: "daily_pearl",     nameKey: "skin.pearl",     cost: 0, fill: 0xf0eaff, marker: "star",    pattern: "scales",  dailyOnly: true, rarity: "epic"   },
  { id: "daily_ruby",      nameKey: "skin.ruby",      cost: 0, fill: 0xe22a4a, marker: "diamond", pattern: "checker", dailyOnly: true, rarity: "epic"   },
  { id: "daily_lagoon",    nameKey: "skin.lagoon",    cost: 0, fill: 0x2cd6c4, marker: "arrow",   pattern: "solid",   dailyOnly: true, rarity: "common" },
  { id: "daily_storm",     nameKey: "skin.storm",     cost: 0, fill: 0x6a78a8, marker: "dot",     pattern: "circuit", dailyOnly: true, rarity: "epic"   },
  { id: "daily_meadow",    nameKey: "skin.meadow",    cost: 0, fill: 0x9bd35c, marker: "star",    pattern: "solid",   dailyOnly: true, rarity: "common" },
  { id: "daily_neon_void", nameKey: "skin.neon_void", cost: 0, fill: 0x1a1430, marker: "diamond", pattern: "rays",    dailyOnly: true, rarity: "legendary" },
  { id: "daily_aurora",    nameKey: "skin.aurora",    cost: 0, fill: 0x6affc4, marker: "star",    pattern: "weave",   dailyOnly: true, rarity: "legendary" },
  { id: "daily_inferno",   nameKey: "skin.inferno",   cost: 0, fill: 0xff4a1a, marker: "arrow",   pattern: "rays",    dailyOnly: true, rarity: "legendary" },
  { id: "daily_celestial", nameKey: "skin.celestial", cost: 0, fill: 0xffeaa6, marker: "star",    pattern: "stars",   dailyOnly: true, rarity: "legendary" },
  { id: "daily_eclipse",   nameKey: "skin.eclipse",   cost: 0, fill: 0x000814, marker: "diamond", pattern: "rays",    dailyOnly: true, rarity: "legendary" },

  // ── Two-tone daily skins ─────────────────────────────────────
  { id: "daily_duo_reef",   nameKey: "skin.duo_reef",   cost: 0, fill: 0x2cd6c4, fillSecondary: 0xff7a6b, marker: "arrow",   pattern: "duo_diag",  dailyOnly: true, rarity: "epic"      },
  { id: "daily_duo_galaxy", nameKey: "skin.duo_galaxy", cost: 0, fill: 0x4a6dff, fillSecondary: 0xc14fff, marker: "star",    pattern: "stripes",   dailyOnly: true, rarity: "epic"      },
  { id: "daily_duo_candy",  nameKey: "skin.duo_candy",  cost: 0, fill: 0xff9ec9, fillSecondary: 0xffd84d, marker: "dot",     pattern: "checker",   dailyOnly: true, rarity: "rare"      },
  { id: "daily_duo_phoenix",nameKey: "skin.duo_phoenix",cost: 0, fill: 0xff4a1a, fillSecondary: 0xffd84d, marker: "diamond", pattern: "rays",      dailyOnly: true, rarity: "legendary" },
] as const;
