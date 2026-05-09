import { GameEvents } from "@events/GameEvents";
import { AUDIO } from "@config/audio";
import type { AchievementUnlockedPayload } from "@systems/AchievementSystem";
import { t } from "./i18n";

/**
 * Global achievement-unlock toast. Listens on `game.events.AchievementUnlocked`
 * and surfaces a stacked toast in the top-right of the UI overlay, with a
 * celebratory SFX. Mounted once per game; survives scene/menu transitions.
 */
export class DomAchievementToast {
  private static installed = false;
  private static container: HTMLElement | null = null;
  private static game: Phaser.Game | null = null;

  static install(game: Phaser.Game): void {
    if (DomAchievementToast.installed) return;
    DomAchievementToast.installed = true;
    DomAchievementToast.game = game;

    const overlay = document.getElementById("ui-overlay") ?? document.body;
    const container = document.createElement("div");
    container.className = "achievement-toast-container";
    overlay.appendChild(container);
    DomAchievementToast.container = container;

    game.events.on(GameEvents.AchievementUnlocked, DomAchievementToast.onUnlocked);
  }

  private static onUnlocked = (payload: AchievementUnlockedPayload): void => {
    DomAchievementToast.show(payload);
    DomAchievementToast.playSfx();
    if (payload.rewardCoins > 0) {
      DomAchievementToast.flyCoins(payload.rewardCoins);
      DomAchievementToast.playCoinChime();
    }
  };

  /**
   * Spawn a flock of coin flyers from the toast position towards the HUD coin
   * counter to mirror the in-round coin reward feedback.
   */
  private static flyCoins(reward: number): void {
    const overlay = document.getElementById("ui-overlay");
    const container = DomAchievementToast.container;
    const counter = document.getElementById("hud-coins");
    if (!overlay || !container || !counter) return;

    const overlayRect = overlay.getBoundingClientRect();
    const fromRect = container.getBoundingClientRect();
    const toRect = counter.getBoundingClientRect();

    const startX = fromRect.left + fromRect.width / 2 - overlayRect.left;
    const startY = fromRect.bottom - overlayRect.top;
    const targetX = toRect.left + toRect.width / 2 - overlayRect.left;
    const targetY = toRect.top + toRect.height / 2 - overlayRect.top;

    const count = Math.min(8, Math.max(3, Math.round(reward / 50)));
    for (let i = 0; i < count; i++) {
      const flyer = document.createElement("div");
      flyer.className = "coin-flyer";
      flyer.textContent = i === 0 ? `+${reward}` : "+";
      const jitterX = (Math.random() - 0.5) * 60;
      flyer.style.left = `${startX + jitterX}px`;
      flyer.style.top = `${startY}px`;
      overlay.appendChild(flyer);

      const delay = i * 70;
      globalThis.setTimeout(() => {
        flyer.style.transform = `translate(${targetX - startX - jitterX}px, ${targetY - startY}px)`;
        flyer.style.opacity = "0";
      }, delay + 16);

      const cleanup = (): void => flyer.remove();
      flyer.addEventListener("transitionend", cleanup, { once: true });
      globalThis.setTimeout(cleanup, delay + 900);
    }
  }

  private static show(payload: AchievementUnlockedPayload): void {
    const container = DomAchievementToast.container;
    if (!container) return;

    const name = t(payload.nameKey);
    const reward = payload.rewardCoins;

    const toast = document.createElement("div");
    toast.className = "achievement-toast";
    toast.innerHTML = `
      <div class="achievement-toast__icon"><i class="ph-fill ph-trophy"></i></div>
      <div class="achievement-toast__body">
        <div class="achievement-toast__label">${t("ach_unlocked")}</div>
        <div class="achievement-toast__name">${name}</div>
      </div>
      ${reward > 0 ? `<div class="achievement-toast__reward"><i class="ph-fill ph-coins"></i> +${reward}</div>` : ""}
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));

    const remove = (): void => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 220);
    };
    setTimeout(remove, 3500);
    toast.addEventListener("click", remove);
  }

  private static playSfx(): void {
    const game = DomAchievementToast.game;
    if (!game) return;
    try {
      const cache = game.cache.audio;
      // Soft warm pad: prefer dedicated achievement SFX, otherwise a deeply
      // detuned capture chime — much gentler than the upgrade jingle.
      if (cache.exists("sfx_achievement")) {
        game.sound.play("sfx_achievement", { volume: 0.4, detune: -100 });
        return;
      }
      if (cache.exists(AUDIO.sfx.capture)) {
        game.sound.play(AUDIO.sfx.capture, { volume: 0.36, detune: -500 });
        // Layered higher partial for a brief sparkle.
        globalThis.setTimeout(() => {
          try {
            game.sound.play(AUDIO.sfx.capture, { volume: 0.22, detune: 200 });
          } catch { /* silent */ }
        }, 90);
        return;
      }
      if (cache.exists(AUDIO.sfx.uiClick)) {
        game.sound.play(AUDIO.sfx.uiClick, { volume: 0.32, detune: -300 });
      }
    } catch { /* silent */ }
  }

  /**
   * Rising-pitch tick chime synchronized with the coin flyer animation,
   * matching the daily-reward modal feedback.
   */
  private static playCoinChime(): void {
    const game = DomAchievementToast.game;
    if (!game) return;
    const cache = game.cache.audio;
    const tickKey =
      cache.exists(AUDIO.sfx.capture) ? AUDIO.sfx.capture :
      cache.exists(AUDIO.sfx.uiClick) ? AUDIO.sfx.uiClick : null;
    if (!tickKey) return;

    const steps = 8;
    const startMs = 220;
    const spanMs = 700;
    const startDetune = -200;
    const endDetune = 900;
    const startVolume = 0.16;
    const endVolume = 0.36;

    for (let i = 0; i < steps; i++) {
      const p = i / (steps - 1);
      const eased = 1 - (1 - p) * (1 - p);
      const at = startMs + eased * spanMs;
      const detune = startDetune + (endDetune - startDetune) * p;
      const volume = startVolume + (endVolume - startVolume) * p;
      globalThis.setTimeout(() => {
        try {
          game.sound.play(tickKey, { volume, detune });
        } catch { /* silent */ }
      }, at);
    }
  }
}
