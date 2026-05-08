import { LeaderboardSystem, type LeaderboardEntry } from "@systems/LeaderboardSystem";
import { t } from "./i18n";

export class DomLeaderboardModal {
  private root: HTMLElement;
  private lb: LeaderboardSystem;
  private onClose: () => void;

  constructor(onClose: () => void) {
    this.onClose = onClose;
    this.lb = new LeaderboardSystem();
    this.root = this.buildShell();
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.root);
    requestAnimationFrame(() => this.root.classList.add("visible"));
    this.fetchAndRender();
  }

  unmount(): void {
    this.root.remove();
  }

  // ── Private ────────────────────────────────────────────────

  private buildShell(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.onClose();
    });

    const box = document.createElement("div");
    box.className = "modal-box panel";

    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close-btn";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.onClose());

    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = t("leaderboard_title");

    const body = document.createElement("div");
    body.className = "modal-body lb-body";
    body.id = "lb-modal-body";

    box.appendChild(closeBtn);
    box.appendChild(titleEl);
    box.appendChild(body);
    overlay.appendChild(box);
    return overlay;
  }

  private body(): HTMLElement {
    return this.root.querySelector("#lb-modal-body") as HTMLElement;
  }

  private renderLoading(): void {
    const body = this.body();
    body.innerHTML = "";
    const spinner = document.createElement("div");
    spinner.className = "lb-spinner";
    spinner.textContent = t("leaderboard_loading");
    body.appendChild(spinner);
  }

  private renderError(): void {
    const body = this.body();
    body.innerHTML = "";

    const msg = document.createElement("p");
    msg.className = "lb-error";
    msg.textContent = t("leaderboard_error");

    const retry = document.createElement("button");
    retry.className = "btn btn-primary";
    retry.textContent = t("leaderboard_retry");
    retry.addEventListener("click", () => this.fetchAndRender());

    body.appendChild(msg);
    body.appendChild(retry);
  }

  private renderEntries(entries: LeaderboardEntry[], playerRank: number): void {
    const body = this.body();
    body.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "lb-empty";
      empty.textContent = t("leaderboard_empty");
      body.appendChild(empty);
      return;
    }

    const list = document.createElement("ol");
    list.className = "lb-list";

    const playerInTop = entries.some((e) => e.rank === playerRank);

    entries.forEach((entry) => {
      list.appendChild(this.buildRow(entry, entry.rank === playerRank));
    });

    body.appendChild(list);

    if (playerRank > 0 && !playerInTop) {
      const sep = document.createElement("div");
      sep.className = "lb-separator";
      sep.textContent = "•••";

      const ownRow = document.createElement("ol");
      ownRow.className = "lb-list lb-list--own";
      ownRow.appendChild(
        this.buildRow({ rank: playerRank, name: t("leaderboard_you"), score: 0 }, true),
      );

      body.appendChild(sep);
      body.appendChild(ownRow);
    }
  }

  private buildRow(entry: LeaderboardEntry, isPlayer: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "lb-row" + (isPlayer ? " lb-row--you" : "");

    const rank = document.createElement("span");
    rank.className = "lb-rank";
    rank.textContent = `#${entry.rank}`;

    const name = document.createElement("span");
    name.className = "lb-name";
    name.textContent = isPlayer && entry.name === t("leaderboard_you")
      ? t("leaderboard_you")
      : entry.name;

    const score = document.createElement("span");
    score.className = "lb-score";
    score.textContent = entry.score > 0 ? String(entry.score) : "";

    li.appendChild(rank);
    li.appendChild(name);
    li.appendChild(score);
    return li;
  }

  private async fetchAndRender(): Promise<void> {
    this.renderLoading();
    try {
      const [entries, playerRank] = await Promise.all([
        this.lb.getTop(10),
        this.lb.getPlayerRank(),
      ]);
      this.renderEntries(entries, playerRank);
    } catch {
      this.renderError();
    }
  }
}
