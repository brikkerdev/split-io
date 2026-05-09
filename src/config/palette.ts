// Pastel minimalism palette. Hex int format for Phaser.
// Hero + ghost + bot color bands. No glow — soft fills only.

export const PALETTE = {
  bg: 0xf7f4ee,
  gridLine: 0xc8c5be,

  hero: {
    fill: 0xa8e0c5,      // pastel mint
    trail: 0xa8e0c5,
    territory: 0xa8e0c5,
    glow: 0.05,
  },
  ghost: {
    fill: 0xc9b8e8,      // pastel lavender
    trail: 0xc9b8e8,
    glow: 0.05,
  },
  bots: [
    0xf5c4a3, // peach
    0xe3a8c4, // lilac
    0xf0d97f, // yellow
    0xb8d4f0, // sky
    0xc9b8e8, // lavender (different bot)
    0xa8d4e0, // teal
    0xf0b8c9, // rose
    0xc4e0a8, // sage
  ] as const,
  botGlowNearest: 0.12,
  botGlowFar: 0.0,

  ui: {
    text: 0x2a2a2e,
    accent: 0xa8e0c5,
    danger: 0xe8856a,
    dim: 0x6b6b72,
  },

  upgradeIcon: {
    speed:         0xa8d8ea, // sky-blue (kept for UpgradeCard compat)
    splitCooldown: 0xb8e0c2, // mint
    shield:        0xffd8b1, // peach
    ghostSpeed:    0xa8d8ea, // sky-blue
    ghostLifetime: 0xd4c5f9, // lavender
    ghostCooldown: 0xb8e0c2, // mint
    passiveSpeed:  0xa8e0c5, // mint-green
    default:       0xa8e0c5,
  },
} as const;

export type Palette = typeof PALETTE;
