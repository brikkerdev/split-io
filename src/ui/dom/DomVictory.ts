import { LeaderboardSystem } from "@systems/LeaderboardSystem";
import { t } from "./i18n";

export interface VictoryStats {
  cycle: number;
  score: number;
}

export class DomVictory {
  private root: HTMLElement;
  private game: Phaser.Game | null = null;
  private lbSys = new LeaderboardSystem();

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "victory-screen";
    this.root.className = "ui-screen interactive";
  }

  mount(
    game: Phaser.Game,
    stats: VictoryStats,
    onLeaderboard: () => void,
    onMenu: () => void,
  ): void {
    this.game = game;
    this.build(stats, onMenu);

    const overlay = document.getElementById("ui-overlay");
    overlay?.appendChild(this.root);

    requestAnimationFrame(() => {
      this.root.classList.add("visible");
    });

    void this.submitAndShowRank(stats.score);
    onLeaderboard();
  }

  unmount(): void {
    this.root.classList.remove("visible");
    setTimeout(() => this.root.remove(), 160);
    this.game = null;
  }

  private build(stats: VictoryStats, onMenu: () => void): void {
    const inner = document.createElement("div");
    inner.className = "victory-inner";

    const title = document.createElement("div");
    title.className = "victory-title";
    title.textContent = t("victory_title");
    inner.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.className = "victory-subtitle";
    subtitle.textContent = t("victory_subtitle");
    inner.appendChild(subtitle);

    const statsPanel = document.createElement("div");
    statsPanel.className = "victory-stats panel";
    statsPanel.innerHTML = `
      <div class="breakdown-row">
        <span class="breakdown-label">${t("victory_cycles")}</span>
        <span class="breakdown-value cyan">${stats.cycle}</span>
      </div>
      <div class="breakdown-row">
        <span class="breakdown-label">${t("victory_score")}</span>
        <span class="breakdown-value cyan">${stats.score}</span>
      </div>
    `;
    inner.appendChild(statsPanel);

    const rankEl = document.createElement("div");
    rankEl.className = "victory-rank";
    rankEl.id = "victory-rank";
    rankEl.textContent = t("gameover_leaderboard_submitting");
    inner.appendChild(rankEl);

    const btnRow = document.createElement("div");
    btnRow.className = "gameover-buttons";

    const menuBtn = document.createElement("button");
    menuBtn.className = "btn";
    menuBtn.innerHTML = `<i class="ph ph-house"></i> ${t("gameover_menu")}`;
    menuBtn.addEventListener("click", onMenu);
    btnRow.appendChild(menuBtn);

    inner.appendChild(btnRow);
    this.root.appendChild(inner);
  }

  private async submitAndShowRank(score: number): Promise<void> {
    const rankEl = this.root.querySelector<HTMLElement>("#victory-rank");
    if (!rankEl) return;

    try {
      await this.lbSys.submitScore(score);
      const rank = await this.lbSys.getPlayerRank();
      if (!rankEl.isConnected) return;

      if (rank > 0) {
        rankEl.innerHTML = `<i class="ph ph-crown"></i> ${t("gameover_rank_label", { rank: String(rank) })}`;
        rankEl.classList.add("ranked");
      } else {
        rankEl.textContent = "";
      }
    } catch {
      if (rankEl.isConnected) rankEl.textContent = "";
    }
  }
}
