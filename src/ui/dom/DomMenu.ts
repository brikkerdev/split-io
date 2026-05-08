import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";
import { t } from "./i18n";
import { DomUI } from "./DomUI";
import { DailyRewardSystem } from "@systems/DailyRewardSystem";

type IconBtn = { labelKey: string; glyph: string; action: () => void };

export class DomMenu {
  private root: HTMLElement;
  private dailyBtnEl!: HTMLButtonElement;
  private dailyDotEl!: HTMLElement;
  private modalContainer: HTMLElement;

  private onPlay: () => void;
  private game: Phaser.Game | null = null;

  constructor(onPlay: () => void) {
    this.onPlay = onPlay;

    this.root = document.createElement("div");
    this.root.id = "menu-screen";
    this.root.className = "ui-screen interactive";

    this.modalContainer = document.createElement("div");

    this.build();
  }

  mount(game: Phaser.Game): void {
    this.game = game;
    const overlay = document.getElementById("ui-overlay");
    overlay?.appendChild(this.root);
    overlay?.appendChild(this.modalContainer);

    requestAnimationFrame(() => {
      this.root.classList.add("visible");
    });

    this.checkDailyReward();

    game.events.on("lang:changed", this.onLangChange, this);
  }

  unmount(): void {
    this.root.classList.remove("visible");
    setTimeout(() => {
      this.root.remove();
      this.modalContainer.remove();
    }, 160);
    this.game?.events.off("lang:changed", this.onLangChange, this);
    this.game = null;
  }

  // ── Private builders ──────────────────────────────────────

  private build(): void {
    const inner = document.createElement("div");
    inner.className = "menu-inner";

    inner.appendChild(this.buildLogo());
    inner.appendChild(this.buildPlayBtn());
    inner.appendChild(this.buildDailyBtn());
    inner.appendChild(this.buildSecondaryRow());

    this.root.appendChild(inner);
  }

  private buildLogo(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "menu-logo";

    const title = document.createElement("div");
    title.className = "menu-logo__title";
    title.textContent = "Split.io";
    wrap.appendChild(title);

    let save: SaveV1 | null = null;
    try { save = saves.get<SaveV1>(); } catch { /* not loaded */ }
    if (save && save.bestScore > 0) {
      const best = document.createElement("div");
      best.className = "menu-logo__best";
      best.textContent = `${t("hud_score")}: ${save.bestScore}`;
      wrap.appendChild(best);
    }

    return wrap;
  }

  private buildPlayBtn(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary menu-play-btn";
    btn.textContent = t("menu_play");
    btn.addEventListener("click", () => {
      this.playClick();
      this.onPlay();
    });
    btn.addEventListener("touchend", (e) => {
      e.preventDefault();
      this.playClick();
      this.onPlay();
    });
    return btn;
  }

  private buildDailyBtn(): HTMLButtonElement {
    const btn = document.createElement("button") as HTMLButtonElement;
    btn.className = "btn menu-daily-btn";
    this.dailyBtnEl = btn;

    const dot = document.createElement("span");
    dot.className = "daily-dot";
    this.dailyDotEl = dot;
    btn.appendChild(dot);

    const icon = document.createElement("i");
    icon.className = "ph ph-gift";
    btn.appendChild(icon);

    const label = document.createElement("span");
    label.textContent = t("menu_daily_reward");
    btn.appendChild(label);

    btn.addEventListener("click", () => this.openDailyRewardModal());
    return btn;
  }

  private buildSecondaryRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "menu-secondary-row";

    const items: IconBtn[] = [
      { labelKey: "menu_skins",        glyph: "ph-shirt",        action: () => this.openSkinsModal() },
      { labelKey: "menu_achievements", glyph: "ph-trophy",       action: () => DomUI.get().mountAchievementsModal() },
      { labelKey: "menu_leaderboard",  glyph: "ph-crown",        action: () => this.openLeaderboardModal() },
      { labelKey: "menu_settings",     glyph: "ph-gear",         action: () => this.openSettingsModal() },
    ];

    items.forEach((item) => {
      const btn = document.createElement("div");
      btn.className = "menu-icon-btn";
      btn.innerHTML = `
        <span class="menu-icon-btn__glyph"><i class="ph ${item.glyph}"></i></span>
        <span class="menu-icon-btn__label">${t(item.labelKey)}</span>
      `;
      btn.addEventListener("click", item.action);
      btn.addEventListener("touchend", (e) => { e.preventDefault(); item.action(); });
      row.appendChild(btn);
    });

    return row;
  }

  // ── Daily reward ──────────────────────────────────────────

  private checkDailyReward(): void {
    const sys = new DailyRewardSystem();
    if (sys.canClaim(Date.now())) {
      this.dailyBtnEl.classList.add("has-reward");
    } else {
      this.dailyBtnEl.classList.remove("has-reward");
    }
  }

  private openDailyRewardModal(): void {
    DomUI.get().mountDailyModal(
      () => {
        // on close — no extra action needed
      },
      () => {
        // on claimed — remove badge, emit event
        this.dailyBtnEl.classList.remove("has-reward");
        this.game?.events.emit("daily:claimed", { amount: 50 });
      },
    );
  }

  // ── Leaderboard ───────────────────────────────────────────

  private openLeaderboardModal(): void {
    DomUI.get().mountLeaderboardModal();
  }

  private openSkinsModal(): void {
    DomUI.get().mountSkinsModal(() => {
      // no-op: modal self-dismounts on close
    });
  }

  private openSettingsModal(): void {
    if (!this.game) return;
    DomUI.get().mountSettingsModal(this.game, () => {
      // Re-apply i18n on menu root in case lang changed
      this.root.innerHTML = "";
      this.build();
    });
  }

  private openStub(titleKey: string): void {
    const modal = this.createModal(t(titleKey), () => modal.remove());
    const body = modal.querySelector(".modal-body");
    if (body) body.textContent = "Coming soon";
    this.modalContainer.appendChild(modal);
  }

  // ── Modal factory ─────────────────────────────────────────

  private createModal(title: string, onClose: () => void): HTMLElement {
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
    titleEl.textContent = title;

    const body = document.createElement("div");
    body.className = "modal-body";

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    box.appendChild(closeBtn);
    box.appendChild(titleEl);
    box.appendChild(body);
    box.appendChild(actions);
    overlay.appendChild(box);
    return overlay;
  }

  private playClick(): void {
    try {
      const ctx = (this.game as unknown as { sound?: { play?: (k: string) => void } }).sound;
      ctx?.play?.("ui_click");
    } catch { /* silent */ }
  }

  private onLangChange(): void {
    // Full re-build is cheapest for menu
    this.root.innerHTML = "";
    this.build();
  }
}
