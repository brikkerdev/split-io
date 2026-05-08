// All UI magic numbers live here. No inline values in scene/component code.

export const UI = {
  safeArea: 32,

  colors: {
    primary: 0x21f0ff,
    ghost: 0xff3df0,
    text: 0xffffff,
    textDim: 0x6b7080,
    danger: 0xff3d6e,
    success: 0x3bff9d,
    warning: 0xffb13b,
    overlay: 0x000000,
    panelBg: 0x0a0e1f,
    panelBorder: 0x21f0ff,
    btnBg: 0x0d1530,
    btnHover: 0x1a2a50,
    btnPress: 0x060c1a,
    cooldownBg: 0x1a1f3a,
    upgradeCard: 0x0d1530,
    upgradeCardHover: 0x162040,
  },

  alpha: {
    overlay: 0.7,
    panel: 0.92,
    dim: 0.5,
    panelBorder: 0.8,
  },

  fonts: {
    h1: "bold 64px 'Arial', sans-serif",
    h2: "bold 40px 'Arial', sans-serif",
    h3: "bold 28px 'Arial', sans-serif",
    body: "20px 'Arial', sans-serif",
    small: "16px 'Arial', sans-serif",
    hud: "bold 24px 'Arial', sans-serif",
    hudLarge: "bold 36px 'Arial', sans-serif",
    mono: "bold 22px 'Courier New', monospace",
  },

  fontSizes: {
    h1: 64,
    h2: 40,
    h3: 28,
    body: 20,
    small: 16,
    hud: 24,
    hudLarge: 36,
    mono: 22,
  },

  tweens: {
    fast: 150,
    medium: 250,
    slow: 400,
    easing: "Sine.easeOut" as const,
  },

  hud: {
    scoreX: 32,
    scoreY: 32,
    timerRightPad: 32,
    timerY: 32,
    cooldownRightPad: 32,
    cooldownBottomPad: 32,
    cooldownRadius: 36,
    cooldownLineWidth: 6,
    cooldownBgAlpha: 0.6,
    territoryBarWidth: 120,
    territoryBarHeight: 12,
    territoryBarPad: 8,
    hintArrowY: 0.6,
    pulsePeriod: 600,
    timerWarnSeconds: 10,
  },

  menu: {
    logoY: 0.25,
    playBtnY: 0.5,
    secondaryBtnY: 0.67,
    secondaryBtnGap: 140,
    btnWidth: 280,
    btnHeight: 64,
    btnBorderRadius: 12,
    secondaryBtnSize: 52,
    dailyDotSize: 10,
    dailyDotOffsetX: 12,
    dailyDotOffsetY: -12,
  },

  gameover: {
    titleY: 0.18,
    scoreY: 0.3,
    breakdownY: 0.42,
    breakdownLineH: 36,
    rankY: 0.7,
    btnY: 0.82,
    btnGap: 180,
    panelW: 600,
    panelH: 520,
  },

  upgrade: {
    cardW: 240,
    cardH: 300,
    cardGap: 32,
    iconSize: 64,
    timerBarH: 6,
    autoCloseSec: 4,
    panelW: 580,
    panelH: 380,
  },

  modal: {
    closeBtnSize: 36,
    closeBtnPad: 16,
  },
} as const;
