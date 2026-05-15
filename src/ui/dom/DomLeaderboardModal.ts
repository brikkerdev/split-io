import { LeaderboardSystem, type LeaderboardEntry } from "@systems/LeaderboardSystem";
import { yandex } from "@sdk/yandex";
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
    if (this.needsAuth()) {
      this.renderAuthPrompt();
    } else if (this.shouldAskConsent()) {
      this.renderConsent();
    } else {
      this.fetchAndRender();
    }
  }

  private needsAuth(): boolean {
    return !yandex.isMock && !yandex.isAuthorized();
  }

  private shouldAskConsent(): boolean {
    return this.lb.getPendingScore() > 0 && !this.lb.canSubmit();
  }

  private shouldShowPlayerRow(): boolean {
    return yandex.isMock || yandex.isAuthorized();
  }

  private renderAuthPrompt(): void {
    const body = this.body();
    body.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "lb-consent";

    const title = document.createElement("div");
    title.className = "lb-consent__title";
    title.textContent = t("leaderboard_auth_title");

    const text = document.createElement("p");
    text.className = "lb-consent__text";
    text.textContent = t("leaderboard_auth_text");

    const row = document.createElement("div");
    row.className = "lb-consent__buttons";

    const accept = document.createElement("button");
    accept.className = "btn btn-primary";
    accept.textContent = t("leaderboard_auth_accept");
    accept.addEventListener("click", () => void this.handleAuthAccept(accept));

    const decline = document.createElement("button");
    decline.className = "btn";
    decline.textContent = t("leaderboard_auth_decline");
    decline.addEventListener("click", () => this.fetchAndRender());

    row.appendChild(accept);
    row.appendChild(decline);

    wrap.appendChild(title);
    wrap.appendChild(text);
    wrap.appendChild(row);
    body.appendChild(wrap);
  }

  private async handleAuthAccept(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    const ok = await yandex.requestAuth();
    if (!ok) {
      btn.disabled = false;
      return;
    }
    if (this.shouldAskConsent()) {
      this.renderConsent();
    } else {
      this.fetchAndRender();
    }
  }

  private renderConsent(): void {
    const body = this.body();
    body.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "lb-consent";

    const title = document.createElement("div");
    title.className = "lb-consent__title";
    title.textContent = t("leaderboard_consent_title");

    const text = document.createElement("p");
    text.className = "lb-consent__text";
    text.textContent = t("leaderboard_consent_text");

    const pending = document.createElement("div");
    pending.className = "lb-consent__pending";
    pending.textContent = t("leaderboard_consent_pending", {
      score: String(this.lb.getPendingScore()),
    });

    const row = document.createElement("div");
    row.className = "lb-consent__buttons";

    const accept = document.createElement("button");
    accept.className = "btn btn-primary";
    accept.textContent = t("leaderboard_consent_accept");
    accept.addEventListener("click", () => void this.handleConsentAccept(accept));

    const decline = document.createElement("button");
    decline.className = "btn";
    decline.textContent = t("leaderboard_consent_decline");
    decline.addEventListener("click", () => this.fetchAndRender());

    row.appendChild(accept);
    row.appendChild(decline);

    wrap.appendChild(title);
    wrap.appendChild(text);
    wrap.appendChild(pending);
    wrap.appendChild(row);
    body.appendChild(wrap);
  }

  private async handleConsentAccept(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    const ok = await this.lb.grantConsentAndFlush();
    if (!ok) {
      btn.disabled = false;
      return;
    }
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

  private renderEntries(
    top: LeaderboardEntry[],
    around: LeaderboardEntry[],
    playerRank: number,
  ): void {
    const body = this.body();
    body.innerHTML = "";

    if (top.length === 0 && around.length === 0) {
      const empty = document.createElement("p");
      empty.className = "lb-empty";
      empty.textContent = t("leaderboard_empty");
      body.appendChild(empty);
      return;
    }

    const showPlayer = this.shouldShowPlayerRow();
    const effectivePlayerRank = showPlayer ? playerRank : -1;

    const list = document.createElement("ol");
    list.className = "lb-list";
    top.forEach((entry) => {
      list.appendChild(this.buildRow(entry, entry.rank === effectivePlayerRank));
    });
    body.appendChild(list);

    const playerInTop = top.some((e) => e.rank === effectivePlayerRank);
    if (showPlayer && playerRank > 0 && !playerInTop) {
      const sepLabel = document.createElement("div");
      sepLabel.className = "lb-separator-label";
      sepLabel.textContent = t("hud_lb_your_position");
      body.appendChild(sepLabel);

      const ownList = document.createElement("ol");
      ownList.className = "lb-list lb-list--own";

      if (around.length > 0) {
        around.forEach((entry) => {
          ownList.appendChild(this.buildRow(entry, entry.rank === effectivePlayerRank));
        });
      } else {
        // Fallback: no neighbors available — show just the player row.
        ownList.appendChild(
          this.buildRow({ rank: playerRank, name: t("leaderboard_you"), score: 0 }, true),
        );
      }
      body.appendChild(ownList);
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
      const data = await this.lb.getLeaderboardData(10, 1);
      this.renderEntries(data.top, data.around, data.playerRank);
    } catch {
      this.renderError();
    }
  }
}
