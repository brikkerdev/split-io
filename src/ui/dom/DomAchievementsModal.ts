import { ACHIEVEMENTS } from "@config/achievements";
import type { AchievementId } from "@config/achievements";
import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";
import { t } from "./i18n";

// Map achievement id to Phosphor icon class
const ACH_ICONS: Record<AchievementId, string> = {
  first_5pct:      "ph-flag",
  capture_50pct:   "ph-target",
  capture_100pct:  "ph-crown",
  survive_round:   "ph-clock",
  kill_with_ghost: "ph-skull",
  ten_kills_round: "ph-medal",
  top1_streak3:    "ph-trophy",
  all_skins:       "ph-star",
};

export class DomAchievementsModal {
  private overlay: HTMLElement;

  constructor(onClose: () => void) {
    this.overlay = this.build(onClose);
  }

  getElement(): HTMLElement {
    return this.overlay;
  }

  private build(onClose: () => void): HTMLElement {
    let save: SaveV1 | null = null;
    try { save = saves.get<SaveV1>(); } catch { /* not loaded */ }
    const unlocked = save?.achievements ?? {};

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) onClose();
    });

    const box = document.createElement("div");
    box.className = "modal-box panel";

    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close-btn";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", onClose);

    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = t("achievements_title");

    const list = document.createElement("div");
    list.className = "achievements-list";

    for (const def of ACHIEVEMENTS.list) {
      const isUnlocked = Boolean(unlocked[def.id]);
      const item = document.createElement("div");
      item.className = `achievement-item${isUnlocked ? " unlocked" : " locked"}`;

      const icon = document.createElement("div");
      icon.className = "achievement-icon";
      icon.innerHTML = `<i class="ph ${ACH_ICONS[def.id]}"></i>`;

      const info = document.createElement("div");
      info.className = "achievement-info";

      const name = document.createElement("div");
      name.className = "achievement-name";
      name.textContent = t(def.nameKey);

      const desc = document.createElement("div");
      desc.className = "achievement-desc";
      desc.textContent = t(`${def.nameKey}_desc`);

      info.appendChild(name);
      info.appendChild(desc);

      const badge = document.createElement("div");
      badge.className = `achievement-badge${isUnlocked ? " badge-unlocked" : " badge-locked"}`;
      badge.textContent = isUnlocked ? t("ach_unlocked") : t("ach_locked");

      const reward = document.createElement("div");
      reward.className = "achievement-reward";
      if (def.rewardCoins > 0) {
        reward.innerHTML = `<i class="ph ph-coin"></i> +${def.rewardCoins}`;
      }

      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(reward);
      item.appendChild(badge);
      list.appendChild(item);
    }

    box.appendChild(closeBtn);
    box.appendChild(titleEl);
    box.appendChild(list);
    overlay.appendChild(box);

    return overlay;
  }
}
