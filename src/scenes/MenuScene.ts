import Phaser from "phaser";
import { DomUI } from "@ui/dom/DomUI";
import { AUDIO } from "@config/audio";

export class MenuScene extends Phaser.Scene {
  private domUI = DomUI.get();

  constructor() {
    super("Menu");
  }

  create(): void {
    // Dark background — game canvas behind DOM overlay
    this.cameras.main.setBackgroundColor("#05060d");

    this.domUI.mountMenu(this.game, () => this.startGame());

    try { this.sound.play(AUDIO.music.menu, { loop: true, volume: 0.5 }); } catch { /* not loaded */ }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.domUI.dismountMenu();
    });
  }

  private startGame(): void {
    try { this.sound.stopAll(); } catch { /* silent */ }
    this.scene.start("Game");
    this.scene.launch("UI");
  }
}
