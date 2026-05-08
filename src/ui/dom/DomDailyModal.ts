import { DailyRewardSystem } from "@systems/DailyRewardSystem";
import { ECONOMY } from "@config/economy";
import { t } from "./i18n";

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export class DomDailyModal {
  private root: HTMLElement;
  private system: DailyRewardSystem;
  private onClose: () => void;
  private onClaimed: () => void;
  private tickId: ReturnType<typeof setInterval> | null = null;
  private countdownEl: HTMLElement | null = null;
  private claimBtn: HTMLButtonElement | null = null;

  constructor(onClose: () => void, onClaimed: () => void) {
    this.onClose = onClose;
    this.onClaimed = onClaimed;
    this.system = new DailyRewardSystem();
    this.root = this.build();
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.root);
    requestAnimationFrame(() => this.root.classList.add("visible"));
    this.startTick();
  }

  unmount(): void {
    this.stopTick();
    this.root.remove();
  }

  // ── Private ────────────────────────────────────────────────

  private build(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const box = document.createElement("div");
    box.className = "modal-box panel daily-modal";

    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close-btn";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());

    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = t("daily_title");

    const icon = document.createElement("i");
    icon.className = "ph ph-gift daily-modal__icon";

    const amountEl = document.createElement("div");
    amountEl.className = "daily-modal__amount";
    amountEl.textContent = t("daily_amount", { amount: String(ECONOMY.dailyRewardCoins) });

    const claimBtn = document.createElement("button");
    claimBtn.className = "btn btn-primary daily-modal__claim";
    this.claimBtn = claimBtn;

    const countdown = document.createElement("div");
    countdown.className = "daily-modal__countdown";
    this.countdownEl = countdown;

    claimBtn.addEventListener("click", () => this.handleClaim());

    this.renderState(claimBtn, countdown);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    actions.appendChild(claimBtn);

    box.appendChild(closeBtn);
    box.appendChild(titleEl);
    box.appendChild(icon);
    box.appendChild(amountEl);
    box.appendChild(countdown);
    box.appendChild(actions);
    overlay.appendChild(box);
    return overlay;
  }

  private renderState(claimBtn: HTMLButtonElement, countdown: HTMLElement): void {
    const nowMs = Date.now();
    const can = this.system.canClaim(nowMs);

    if (can) {
      claimBtn.textContent = t("daily_claim", { amount: String(ECONOMY.dailyRewardCoins) });
      claimBtn.disabled = false;
      claimBtn.style.opacity = "1";
      countdown.textContent = "";
      countdown.style.display = "none";
    } else {
      claimBtn.textContent = t("daily_claimed");
      claimBtn.disabled = true;
      claimBtn.style.opacity = "0.5";
      const remaining = this.system.getNextClaimMs(nowMs);
      countdown.textContent = t("daily_next", { time: formatMs(remaining) });
      countdown.style.display = "";
    }
  }

  private handleClaim(): void {
    const result = this.system.claim(Date.now());
    if (!result.success) return;

    this.stopTick();
    if (this.claimBtn) {
      this.claimBtn.textContent = t("daily_claimed");
      this.claimBtn.disabled = true;
      this.claimBtn.style.opacity = "0.5";
    }
    if (this.countdownEl) {
      this.countdownEl.style.display = "none";
    }

    this.onClaimed();
    setTimeout(() => this.close(), 800);
  }

  private startTick(): void {
    this.tickId = setInterval(() => {
      if (this.claimBtn && this.countdownEl) {
        this.renderState(this.claimBtn, this.countdownEl);
      }
    }, 1000);
  }

  private stopTick(): void {
    if (this.tickId !== null) {
      clearInterval(this.tickId);
      this.tickId = null;
    }
  }

  private close(): void {
    this.unmount();
    this.onClose();
  }
}
