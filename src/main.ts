import "@phosphor-icons/web/regular";
import "@ui/styles/base.css";
import "@ui/styles/hud.css";
import "@ui/styles/menu.css";
import "@ui/styles/gameover.css";
import "@ui/styles/upgrade.css";

import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "@config/game";
import { BootScene } from "@scenes/BootScene";
import { GameOverScene } from "@scenes/GameOverScene";
import { GameScene } from "@scenes/GameScene";
import { MenuScene } from "@scenes/MenuScene";
import { PreloadScene } from "@scenes/PreloadScene";
import { UIScene } from "@scenes/UIScene";
import { yandex } from "@sdk/yandex";

async function bootstrap(): Promise<void> {
  await yandex.init();

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#000000",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    render: {
      pixelArt: false,
      antialias: true,
      roundPixels: true,
    },
    scene: [BootScene, PreloadScene, MenuScene, GameScene, UIScene, GameOverScene],
  };

  const game = new Phaser.Game(config);

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
