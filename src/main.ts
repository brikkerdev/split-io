import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "@ui/styles/base.css";
import "@ui/styles/hud.css";
import "@ui/styles/menu.css";
import "@ui/styles/gameover.css";
import "@ui/styles/upgrade.css";
import "@ui/styles/skins.css";
import "@ui/styles/achievements.css";
import "@ui/styles/settings.css";
import "@ui/styles/leaderboard.css";
import "@ui/styles/daily.css";
import "@ui/styles/pause.css";

import Phaser from "phaser";
import { BootScene } from "@scenes/BootScene";
import { GameScene } from "@scenes/GameScene";
import { PreloadScene } from "@scenes/PreloadScene";
import { UIScene } from "@scenes/UIScene";
import { yandex } from "@sdk/yandex";
import { PALETTE } from "@config/palette";
import { shadeColor } from "@utils/color";
import { applyStoredUiScale } from "@ui/dom/uiScale";

async function bootstrap(): Promise<void> {
  await yandex.init();
  applyStoredUiScale();

  const voidHex = `#${shadeColor(PALETTE.bg, -0.18).toString(16).padStart(6, "0")}`;

  const parentEl = document.getElementById("game");
  const parentRect = (): { w: number; h: number } => ({
    w: parentEl?.clientWidth || window.innerWidth,
    h: parentEl?.clientHeight || window.innerHeight,
  });
  const initial = parentRect();

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: voidHex,
    fps: { target: 60, smoothStep: true },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      autoRound: true,
      width: initial.w,
      height: initial.h,
      // The #game parent element is locked to 16:9 (landscape) / 9:16 (portrait)
      // via CSS aspect-ratio. Phaser tracks the parent's size, so the canvas
      // inherits that aspect.
    },
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    render: {
      pixelArt: false,
      // MSAA on integrated GPUs (Yandex iframe often forces integrated context)
      // is the single biggest fillrate cost for our overdraw-heavy rendering
      // (territory shadow + fill + 2 strokes + tilesprite patterns + 4 stencil
      // masks per frame). With roundPixels on, edges read as crisp without it.
      antialias: false,
      antialiasGL: false,
      roundPixels: true,
      powerPreference: "high-performance",
    },
    scene: [BootScene, PreloadScene, GameScene, UIScene],
  };

  const game = new Phaser.Game(config);
  yandex.setGame(game);

  if (new URLSearchParams(location.search).get("dev") === "1") {
    (window as unknown as { __game: Phaser.Game }).__game = game;
  }

  // Force a resize on viewport changes so the canvas tracks orientation flips
  // and mobile address-bar collapses without requiring a reload. We resize to
  // the locked-aspect parent rect, not the raw viewport.
  const handleViewportChange = (): void => {
    const { w, h } = parentRect();
    game.scale.resize(w, h);
  };
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("orientationchange", handleViewportChange);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      game.sound.mute = true;
      game.loop.sleep();
      game.events.emit("pause:toggle", true);
    } else {
      game.sound.mute = false;
      game.loop.wake();
      game.events.emit("pause:toggle", false);
    }
  });
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err);
});
