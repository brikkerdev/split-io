// 12 cosmetic skins. Source: GDD §3.

export interface SkinDef {
  id: string;
  nameKey: string;
  cost: number;
  fill: number;
  marker: "arrow" | "dot" | "diamond" | "star";
}

export const SKINS: readonly SkinDef[] = [
  { id: "neon_cyan",   nameKey: "skin.cyan",   cost: 0,    fill: 0x21f0ff, marker: "arrow"   },
  { id: "neon_pink",   nameKey: "skin.pink",   cost: 200,  fill: 0xff3df0, marker: "arrow"   },
  { id: "neon_lime",   nameKey: "skin.lime",   cost: 200,  fill: 0xb6ff3b, marker: "dot"     },
  { id: "neon_amber",  nameKey: "skin.amber",  cost: 300,  fill: 0xffb13b, marker: "dot"     },
  { id: "neon_red",    nameKey: "skin.red",    cost: 300,  fill: 0xff5252, marker: "diamond" },
  { id: "neon_violet", nameKey: "skin.violet", cost: 500,  fill: 0x9d3bff, marker: "diamond" },
  { id: "neon_mint",   nameKey: "skin.mint",   cost: 500,  fill: 0x3bff9d, marker: "star"    },
  { id: "neon_sky",    nameKey: "skin.sky",    cost: 700,  fill: 0x3bd1ff, marker: "star"    },
  { id: "neon_rose",   nameKey: "skin.rose",   cost: 800,  fill: 0xff3b95, marker: "arrow"   },
  { id: "neon_gold",   nameKey: "skin.gold",   cost: 1000, fill: 0xffe33b, marker: "diamond" },
  { id: "neon_white",  nameKey: "skin.white",  cost: 1500, fill: 0xffffff, marker: "star"    },
  { id: "neon_black",  nameKey: "skin.black",  cost: 2500, fill: 0x202535, marker: "arrow"   },
] as const;
