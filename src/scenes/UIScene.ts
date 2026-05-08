import Phaser from "phaser";
import { DomUI } from "@ui/dom/DomUI";

/**
 * UIScene — thin Phaser scene that delegates all rendering
 * to the HTML DOM overlay via DomUI.
 */
export class UIScene extends Phaser.Scene {
  private gameEvents!: Phaser.Events.EventEmitter;
  private domUI = DomUI.get();

  constructor() {
    super("UI");
  }

  create(data?: { heroId?: number }): void {
    const gameScene = this.scene.get("Game");
    this.gameEvents = gameScene.events;

    this.domUI.mountHUD(this.game, this.gameEvents, data?.heroId ?? 0);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
  }

  private cleanup(): void {
    this.domUI.dismountHUD();
  }
}
