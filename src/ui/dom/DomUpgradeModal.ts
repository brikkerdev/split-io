import { UPGRADES } from "@config/upgrades";
import type { UpgradeOfferPayload } from "@gametypes/events";
import { t } from "./i18n";

const AUTO_CLOSE_SEC = 4;

const UPGRADE_ICONS: Record<string, string> = {
  speed:         "ph-gauge",
  homingDelay:   "ph-ghost",
  splitCooldown: "ph-timer",
  shield:        "ph-shield",
};

export class DomUpgradeModal {
  private overlay: HTMLElement | null = null;
  private tickerId: number | null = null;

  show(
    payload: UpgradeOfferPayload,
    onPick: (id: string) => void,
    onClose: () => void,
  ): void {
    if (this.overlay) return;

    const defs = payload.choices
      .map((id) => UPGRADES.find((u) => u.id === id))
      .filter((d): d is NonNullable<typeof d> => d !== undefined);

    if (defs.length === 0) return;

    const overlay = document.createElement("div");
    overlay.className = "upgrade-overlay";
    this.overlay = overlay;

    const panel = document.createElement("div");
    panel.className = "upgrade-panel panel";

    const titleEl = document.createElement("div");
    titleEl.className = "upgrade-title";
    titleEl.textContent = t("upgrade_title");
    panel.appendChild(titleEl);

    const cardsWrap = document.createElement("div");
    cardsWrap.className = "upgrade-cards";

    const pick = (id: string): void => {
      onPick(id);
      this.dismiss(onClose);
    };

    defs.forEach((def) => {
      const card = document.createElement("div");
      card.className = "upgrade-card";
      const iconClass = UPGRADE_ICONS[def.id] ?? "ph-star";
      card.innerHTML = `
        <span class="upgrade-card__icon"><i class="ph ${iconClass}"></i></span>
        <span class="upgrade-card__name">${t(def.labelKey)}</span>
        <span class="upgrade-card__desc">${t(`${def.id}_desc`, undefined)}</span>
      `;
      // desc key convention: speed_desc, homingDelay_desc etc.
      // Map to existing locale keys
      const descKey = this.descKey(def.id);
      card.querySelector<HTMLElement>(".upgrade-card__desc")!.textContent = t(descKey);

      card.addEventListener("click", () => pick(def.id));
      card.addEventListener("touchend", (e) => { e.preventDefault(); pick(def.id); });
      cardsWrap.appendChild(card);
    });

    panel.appendChild(cardsWrap);

    // Auto-close timer bar
    const timerWrap = document.createElement("div");
    timerWrap.className = "upgrade-timer";
    timerWrap.innerHTML = `
      <span class="upgrade-timer__label" id="upg-timer-label"></span>
      <div class="upgrade-timer__bar-wrap">
        <div class="upgrade-timer__bar-fill" id="upg-timer-fill"></div>
      </div>
    `;
    panel.appendChild(timerWrap);

    overlay.appendChild(panel);
    document.getElementById("ui-overlay")?.appendChild(overlay);

    // Start countdown
    let elapsed = 0;
    const labelEl = overlay.querySelector<HTMLElement>("#upg-timer-label")!;
    const fillEl = overlay.querySelector<HTMLElement>("#upg-timer-fill")!;

    const updateTimer = (): void => {
      elapsed += 0.1;
      const ratio = Math.max(0, 1 - elapsed / AUTO_CLOSE_SEC);
      fillEl.style.transform = `scaleX(${ratio})`;
      labelEl.textContent = t("upgrade_auto_close", { sec: String(Math.ceil(AUTO_CLOSE_SEC - elapsed)) });

      if (elapsed >= AUTO_CLOSE_SEC) {
        this.stopTicker();
        const firstId = defs[0]?.id;
        if (firstId) pick(firstId);
      }
    };
    updateTimer();
    this.tickerId = window.setInterval(updateTimer, 100);
  }

  dismiss(onClose?: () => void): void {
    this.stopTicker();
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    onClose?.();
  }

  private stopTicker(): void {
    if (this.tickerId !== null) {
      clearInterval(this.tickerId);
      this.tickerId = null;
    }
  }

  private descKey(id: string): string {
    const map: Record<string, string> = {
      speed: "upgrade_speed_desc",
      homingDelay: "upgrade_homing_desc",
      splitCooldown: "upgrade_split_cd_desc",
      shield: "upgrade_shield_desc",
    };
    return map[id] ?? id;
  }
}
