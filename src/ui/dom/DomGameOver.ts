import type { RoundBreakdown } from "@gametypes/round";
import { AdSystem } from "@systems/AdSystem";
import { LeaderboardSystem } from "@systems/LeaderboardSystem";
import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";
import { GameEvents } from "@events/GameEvents";
import type { AchievementUnlockedPayload } from "@systems/AchievementSystem";
import { t } from "./i18n";

interface GameOverOptions {
  breakdown: RoundBreakdown;
  isDeath: boolean;
  onContinue: () => Promise<void>;
  onRestart: () => Promise<void>;
  onMenu: () => void;
}

export class DomGameOver {
  private root: HTMLElement;
  private rankEl!: HTMLElement;
  private game: Phaser.Game | null = null;
  private adSys = new AdSystem();
  private lbSys = new LeaderboardSystem();

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "gameover-screen";
    this.root.className = "ui-screen interactive";
  }

  mount(game: Phaser.Game, opts: GameOverOptions): void {
    this.game = game;
    this.build(opts);

    const overlay = document.getElementById("ui-overlay");
    overlay?.appendChild(this.root);

    requestAnimationFrame(() => {
      this.root.classList.add("visible");
    });

    void this.submitRank(opts.breakdown.total);

    game.events.on(GameEvents.AchievementUnlocked, this.onAchievementUnlocked, this);
  }

  unmount(): void {
    this.game?.events.off(GameEvents.AchievementUnlocked, this.onAchievementUnlocked, this);
    this.root.classList.remove("visible");
    setTimeout(() => this.root.remove(), 160);
    this.game = null;
  }

  private onAchievementUnlocked(payload: AchievementUnlockedPayload): void {
    const name = t(payload.nameKey);
    const msg = t("ach_toast").replace("{name}", name);

    const toast = document.createElement("div");
    toast.className = "achievement-toast";
    toast.innerHTML = `<i class="ph ph-trophy"></i> ${msg}`;
    this.root.appendChild(toast);

    setTimeout(() => toast.remove(), 3500);
  }

  // ── Build ─────────────────────────────────────────────────

  private build(opts: GameOverOptions): void {
    const bd = opts.breakdown;
    const inner = document.createElement("div");
    inner.className = "gameover-inner";

    inner.appendChild(this.buildTitle(opts.isDeath));
    inner.appendChild(this.buildScore(bd));
    inner.appendChild(this.buildBreakdown(bd));
    inner.appendChild(this.buildRank());
    inner.appendChild(this.buildButtons(bd, opts));

    this.root.appendChild(inner);
  }

  private buildTitle(isDeath: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = "gameover-title";
    el.textContent = isDeath ? t("gameover_title") : t("gameover_title");
    return el;
  }

  private buildScore(bd: RoundBreakdown): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "gameover-score-wrap";

    const val = document.createElement("div");
    val.className = `gameover-score-value${bd.bestNew ? " new-best" : ""}`;
    val.textContent = String(bd.total);
    wrap.appendChild(val);

    if (bd.bestNew) {
      const badge = document.createElement("div");
      badge.className = "gameover-new-best-badge";
      badge.innerHTML = `<i class="ph ph-star"></i> ${t("gameover_new_best")}`;
      wrap.appendChild(badge);
    }

    return wrap;
  }

  private buildBreakdown(bd: RoundBreakdown): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "gameover-breakdown panel";

    type RowDef = { label: string; value: string; cls: string };
    const rows: RowDef[] = [
      {
        label: t("gameover_territory"),
        value: `${bd.territoryPct.toFixed(1)}%  +${bd.territoryPoints}`,
        cls: "cyan",
      },
      {
        label: t("gameover_speed_bonus"),
        value: `+${bd.secondsBonus}`,
        cls: "green",
      },
      {
        label: t("gameover_kills"),
        value: `${bd.kills} × 500  +${bd.killPoints}`,
        cls: "amber",
      },
      {
        label: t("gameover_penalty"),
        value: bd.penalty > 0 ? `−${bd.penalty}` : "0",
        cls: bd.penalty > 0 ? "red" : "dim",
      },
    ];

    rows.forEach((row) => {
      const r = document.createElement("div");
      r.className = "breakdown-row";
      r.innerHTML = `
        <span class="breakdown-label">${row.label}</span>
        <span class="breakdown-value ${row.cls}">${row.value}</span>
      `;
      panel.appendChild(r);
    });

    const totalRow = document.createElement("div");
    totalRow.className = "breakdown-row total-row";
    totalRow.innerHTML = `
      <span class="breakdown-label">${t("gameover_total")}</span>
      <span class="breakdown-value cyan">${bd.total}</span>
    `;
    panel.appendChild(totalRow);

    return panel;
  }

  private buildRank(): HTMLElement {
    const el = document.createElement("div");
    el.className = "gameover-rank";
    el.textContent = t("gameover_leaderboard_submitting");
    this.rankEl = el;
    return el;
  }

  private buildButtons(bd: RoundBreakdown, opts: GameOverOptions): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "gameover-buttons";

    const canContinue = opts.isDeath && this.adSys.canContinue();

    if (canContinue) {
      const continueBtn = document.createElement("button");
      continueBtn.className = "btn btn-primary";
      continueBtn.innerHTML = `<i class="ph ph-play-circle"></i> ${t("gameover_continue")}`;
      continueBtn.addEventListener("click", () => void opts.onContinue());
      wrap.appendChild(continueBtn);
    }

    const row = document.createElement("div");
    row.className = "btn-row";

    const restartBtn = document.createElement("button");
    restartBtn.className = "btn";
    restartBtn.innerHTML = `<i class="ph ph-arrow-counter-clockwise"></i> ${t("gameover_restart")}`;
    restartBtn.addEventListener("click", () => void opts.onRestart());

    const menuBtn = document.createElement("button");
    menuBtn.className = "btn";
    menuBtn.innerHTML = `<i class="ph ph-house"></i> ${t("gameover_menu")}`;
    menuBtn.addEventListener("click", opts.onMenu);

    row.appendChild(restartBtn);
    row.appendChild(menuBtn);
    wrap.appendChild(row);

    return wrap;
  }

  // ── Rank submission ───────────────────────────────────────

  private async submitRank(score: number): Promise<void> {
    try {
      await this.lbSys.submitScore(score);
      const rank = await this.lbSys.getPlayerRank();
      if (!this.rankEl.isConnected) return;

      if (rank > 0) {
        this.rankEl.innerHTML = `<i class="ph ph-crown"></i> ${t("gameover_rank_label", { rank: String(rank) })}`;
        this.rankEl.classList.add("ranked");
      } else {
        this.rankEl.textContent = "";
      }

      let save: SaveV1 | null = null;
      try { save = saves.get<SaveV1>(); } catch { /* not loaded */ }
      if (save && score > save.bestScore) {
        saves.patch({ bestScore: score });
      }
    } catch {
      if (this.rankEl.isConnected) this.rankEl.textContent = "";
    }
  }
}
