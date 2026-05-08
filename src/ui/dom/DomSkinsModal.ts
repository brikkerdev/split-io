import { SKINS } from "@config/skins";
import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";
import { t } from "./i18n";

export class DomSkinsModal {
  private overlay: HTMLElement;
  private onClose: () => void;

  constructor(onClose: () => void) {
    this.onClose = onClose;
    this.overlay = this.build();
  }

  mount(): void {
    document.getElementById("ui-overlay")?.appendChild(this.overlay);
    requestAnimationFrame(() => this.overlay.classList.add("visible"));
  }

  unmount(): void {
    this.overlay.classList.remove("visible");
    setTimeout(() => this.overlay.remove(), 160);
  }

  private build(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const box = document.createElement("div");
    box.className = "modal-box panel skins-modal";

    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close-btn";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());

    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = t("skins_title");

    const coinsRow = document.createElement("div");
    coinsRow.className = "skins-coins-row";
    coinsRow.id = "skins-coins-row";
    this.updateCoinsRow(coinsRow);

    const grid = document.createElement("div");
    grid.className = "skins-grid";
    grid.id = "skins-grid";

    box.appendChild(closeBtn);
    box.appendChild(titleEl);
    box.appendChild(coinsRow);
    box.appendChild(grid);
    overlay.appendChild(box);

    this.renderGrid(grid);
    return overlay;
  }

  private updateCoinsRow(row: HTMLElement): void {
    const save = saves.get<SaveV1>();
    row.innerHTML = `<i class="ph ph-coins"></i> ${save.coins}`;
  }

  private renderGrid(grid: HTMLElement): void {
    grid.innerHTML = "";
    const save = saves.get<SaveV1>();

    for (const skin of SKINS) {
      const owned = save.unlockedSkins.includes(skin.id);
      const selected = save.selectedSkin === skin.id;
      const affordable = skin.cost === 0 || save.coins >= skin.cost;

      const card = document.createElement("div");
      card.className = "skin-card";
      if (selected) card.classList.add("skin-card--selected");
      if (!owned && !affordable) card.classList.add("skin-card--disabled");

      const hex = `#${skin.fill.toString(16).padStart(6, "0")}`;
      const swatch = document.createElement("div");
      swatch.className = "skin-swatch";
      swatch.style.backgroundColor = hex;
      swatch.style.borderColor = selected ? hex : "transparent";

      const nameEl = document.createElement("div");
      nameEl.className = "skin-name";
      nameEl.textContent = t(skin.nameKey);

      const stateEl = document.createElement("div");
      stateEl.className = "skin-state";

      if (selected) {
        stateEl.textContent = t("skins_selected");
        stateEl.classList.add("skin-state--selected");
      } else if (owned) {
        stateEl.textContent = t("skins_select");
        stateEl.classList.add("skin-state--owned");
      } else {
        stateEl.innerHTML = `<i class="ph ph-coins"></i> ${skin.cost}`;
        if (!affordable) {
          stateEl.classList.add("skin-state--locked");
        } else {
          stateEl.classList.add("skin-state--buy");
        }
      }

      card.appendChild(swatch);
      card.appendChild(nameEl);
      card.appendChild(stateEl);

      if (!selected) {
        card.addEventListener("click", () => this.onCardClick(skin.id));
        card.addEventListener("touchend", (e) => {
          e.preventDefault();
          this.onCardClick(skin.id);
        });
      }

      grid.appendChild(card);
    }
  }

  private onCardClick(skinId: string): void {
    const save = saves.get<SaveV1>();
    const skin = SKINS.find((s) => s.id === skinId);
    if (!skin) return;

    const owned = save.unlockedSkins.includes(skinId);

    if (!owned) {
      if (save.coins < skin.cost) return;
      saves.patch({
        coins: save.coins - skin.cost,
        unlockedSkins: [...save.unlockedSkins, skinId],
        selectedSkin: skinId,
      });
    } else {
      saves.patch({ selectedSkin: skinId });
    }

    const grid = document.getElementById("skins-grid");
    const coinsRow = document.getElementById("skins-coins-row");
    if (grid) this.renderGrid(grid);
    if (coinsRow) this.updateCoinsRow(coinsRow);
  }

  private close(): void {
    this.unmount();
    this.onClose();
  }
}
