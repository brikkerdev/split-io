import { UPGRADES, type UpgradeId } from "@config/upgrades";
import type { UpgradeOfferPayload } from "@gametypes/events";
import { UpgradePreview } from "./UpgradePreview";
import { t } from "./i18n";

export class DomUpgradeModal {
  private overlay: HTMLElement | null = null;
  private previews: UpgradePreview[] = [];

  show(
    payload: UpgradeOfferPayload,
    onPick: (id: UpgradeId) => void,
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

    const pick = (id: UpgradeId): void => {
      onPick(id);
      this.dismiss(onClose);
    };

    defs.forEach((def) => {
      const card = document.createElement("div");
      card.className = "upgrade-card";

      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 144;
      canvas.className = "upgrade-card__preview";

      card.innerHTML = `
        <span class="upgrade-card__icon"><i class="ph ${def.iconKey}"></i></span>
        <span class="upgrade-card__name">${t(def.labelKey)}</span>
        <span class="upgrade-card__desc">${t(def.descKey)}</span>
      `;
      card.insertBefore(canvas, card.firstChild);

      const preview = new UpgradePreview();
      preview.mount(canvas, def.id);
      this.previews.push(preview);

      card.addEventListener("click", () => pick(def.id));
      card.addEventListener("touchend", (e) => { e.preventDefault(); pick(def.id); });
      cardsWrap.appendChild(card);
    });

    panel.appendChild(cardsWrap);
    overlay.appendChild(panel);
    document.getElementById("ui-overlay")?.appendChild(overlay);
  }

  dismiss(onClose?: () => void): void {
    for (const p of this.previews) p.unmount();
    this.previews = [];

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    onClose?.();
  }
}
