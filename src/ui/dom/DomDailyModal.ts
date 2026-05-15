import { DailyRewardSystem, type DailyStatus } from "@systems/DailyRewardSystem";
import { applyStreakBonus, type DailyRewardEntry } from "@config/dailyRewards";
import { SKINS } from "@config/skins";
import { patternCss } from "@config/skinPatterns";
import { t } from "./i18n";

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function skinSwatchHtml(skinId: string): string {
  const skin = SKINS.find((s) => s.id === skinId);
  if (!skin) return "";
  const bg = patternCss(skin.pattern, skin.fill, skin.fillSecondary);
  return `<span class="daily-skin-swatch" style="background:${bg}"></span>`;
}

export class DomDailyModal {
  private root: HTMLElement;
  private system: DailyRewardSystem;
  private onClose: () => void;
  private onClaimed: () => void;
  private tickId: number | null = null;
  private bodyEl: HTMLElement | null = null;
  private boxEl: HTMLElement | null = null;
  private game: Phaser.Game | null = null;
  private celebrating = false;
  private onVisibilityChange: (() => void) | null = null;
  private chimeTimers: number[] = [];
  private countRaf = 0;

  constructor(onClose: () => void, onClaimed: () => void, game: Phaser.Game | null = null) {
    this.onClose = onClose;
    this.onClaimed = onClaimed;
    this.game = game;
    this.system = new DailyRewardSystem();
    this.root = this.build();
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.root);
    requestAnimationFrame(() => this.root.classList.add("visible"));
    this.startTick();
  }

  unmount(): void {
    this.cancelChime();
    this.stopTick();
    if (this.countRaf) {
      cancelAnimationFrame(this.countRaf);
      this.countRaf = 0;
    }
    if (this.onVisibilityChange) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
    this.root.remove();
  }

  // ── Build ──────────────────────────────────────────────

  private build(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const box = document.createElement("div");
    box.className = "modal-box panel daily-modal";
    this.boxEl = box;

    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close-btn";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());

    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = t("daily_title");

    const body = document.createElement("div");
    body.className = "daily-modal__body";
    this.bodyEl = body;

    box.appendChild(closeBtn);
    box.appendChild(titleEl);
    box.appendChild(body);
    overlay.appendChild(box);

    this.renderBody();
    return overlay;
  }

  private renderBody(): void {
    if (!this.bodyEl) return;
    const status = this.system.getStatus(Date.now());
    this.bodyEl.innerHTML = "";

    this.bodyEl.appendChild(this.buildStreakRow(status));
    this.bodyEl.appendChild(this.buildTodayCard(status));
    this.bodyEl.appendChild(this.buildStrip(status));
    this.bodyEl.appendChild(this.buildClaimRow(status));
  }

  private buildStreakRow(status: DailyStatus): HTMLElement {
    const row = document.createElement("div");
    row.className = "daily-streak-row";
    if (status.streak >= 7) row.classList.add("daily-streak-row--hot");
    if (status.streak >= 14) row.classList.add("daily-streak-row--blaze");

    const flame = document.createElement("div");
    flame.className = "daily-streak-flame";
    flame.innerHTML = `<i class="ph-fill ph-fire"></i><span>${status.streak}</span>`;

    const label = document.createElement("div");
    label.className = "daily-streak-label";
    if (status.streak === 0) {
      label.textContent = t("daily_streak_idle");
    } else {
      label.textContent = t("daily_streak_label", { n: String(status.streak) });
    }

    if (status.bestStreak > status.streak) {
      const best = document.createElement("div");
      best.className = "daily-streak-best";
      best.textContent = t("daily_streak_best", { n: String(status.bestStreak) });
      label.appendChild(best);
    }

    if (status.streakExpired && status.streak === 0) {
      const expired = document.createElement("div");
      expired.className = "daily-streak-expired";
      expired.textContent = t("daily_streak_expired");
      label.appendChild(expired);
    }

    row.appendChild(flame);
    row.appendChild(label);
    return row;
  }

  private buildTodayCard(status: DailyStatus): HTMLElement {
    const card = document.createElement("div");
    card.className = "daily-today";
    // During cooldown show the just-claimed entry so its day number matches
    // the streak counter; otherwise show the next claimable entry.
    const e = status.canClaim ? status.nextEntry : status.currentEntry;
    const streakForReward = status.canClaim
      ? Math.max(1, status.streak + 1)
      : Math.max(1, status.streak);

    const header = document.createElement("div");
    header.className = "daily-today__header";
    header.textContent = t("daily_day_n", { n: String(e.dayNumber) });

    const reward = document.createElement("div");
    reward.className = "daily-today__reward";

    if (e.kind === "skin" && e.skinId) {
      const skin = SKINS.find((s) => s.id === e.skinId);
      const bg = skin ? patternCss(skin.pattern, skin.fill, skin.fillSecondary) : "#fff";
      const name = skin ? t(skin.nameKey) : e.skinId;
      const bonus = applyStreakBonus(e.bonusCoins ?? 0, streakForReward, e.dayIndex);
      reward.innerHTML = `
        <div class="daily-today__skin" style="background:${bg}"></div>
        <div class="daily-today__text">
          <div class="daily-today__title">${name}</div>
          <div class="daily-today__sub"><i class="ph ph-coins"></i> +${bonus}</div>
        </div>`;
    } else {
      const coins = applyStreakBonus(e.baseCoins, streakForReward, e.dayIndex);
      reward.innerHTML = `
        <div class="daily-today__coins"><i class="ph-fill ph-coins"></i></div>
        <div class="daily-today__text">
          <div class="daily-today__title">+${coins}</div>
          <div class="daily-today__sub">${t("daily_coins_label")}</div>
        </div>`;
    }

    card.appendChild(header);
    card.appendChild(reward);
    return card;
  }

  private buildStrip(status: DailyStatus): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "daily-strip";

    status.preview.forEach((entry: DailyRewardEntry, i: number) => {
      const cell = document.createElement("div");
      cell.className = "daily-strip__cell";
      if (i === 0) cell.classList.add("daily-strip__cell--current");
      if (entry.kind === "skin") cell.classList.add("daily-strip__cell--skin");

      const dayLabel = document.createElement("div");
      dayLabel.className = "daily-strip__day";
      dayLabel.textContent = t("daily_day_short", { n: String(entry.dayNumber) });

      const icon = document.createElement("div");
      icon.className = "daily-strip__icon";
      if (entry.kind === "skin" && entry.skinId) {
        icon.innerHTML = skinSwatchHtml(entry.skinId);
      } else {
        icon.innerHTML = `<i class="ph-fill ph-coins"></i>`;
      }

      const amt = document.createElement("div");
      amt.className = "daily-strip__amt";
      if (entry.kind === "skin") {
        amt.textContent = t("daily_strip_skin");
      } else {
        amt.textContent = `+${entry.baseCoins}`;
      }

      cell.appendChild(dayLabel);
      cell.appendChild(icon);
      cell.appendChild(amt);
      wrap.appendChild(cell);
    });

    return wrap;
  }

  private buildClaimRow(status: DailyStatus): HTMLElement {
    const row = document.createElement("div");
    row.className = "daily-claim-row";

    const btn = document.createElement("button");
    btn.className = "btn btn-primary daily-modal__claim";

    const countdown = document.createElement("div");
    countdown.className = "daily-modal__countdown";

    if (status.canClaim) {
      btn.textContent = t("daily_claim_now");
      btn.disabled = false;
      btn.addEventListener("click", () => this.handleClaim());
      countdown.style.display = "none";
    } else {
      btn.textContent = t("daily_claimed");
      btn.disabled = true;
      btn.style.opacity = "0.5";
      countdown.textContent = t("daily_next", { time: formatMs(status.nextClaimMs) });
    }

    row.appendChild(btn);
    row.appendChild(countdown);
    return row;
  }

  // ── Actions ────────────────────────────────────────────

  private handleClaim(): void {
    if (this.celebrating) return;
    const result = this.system.claim(Date.now());
    if (!result.success) return;

    this.celebrating = true;
    this.onClaimed();
    this.celebrate(result.amount, result.skinId);
  }

  // ── Celebration ────────────────────────────────────────
  private celebrate(amount: number, skinId?: string): void {
    const box = this.boxEl;
    if (!box) {
      this.celebrating = false;
      this.renderBody();
      return;
    }

    box.classList.add("daily-modal--celebrating");

    const overlay = document.createElement("div");
    overlay.className = "daily-celebrate";

    const backdrop = document.createElement("div");
    backdrop.className = "daily-celebrate__backdrop";

    const ring = document.createElement("div");
    ring.className = "daily-celebrate__ring";

    const stage = document.createElement("div");
    stage.className = "daily-celebrate__stage";

    const icon = document.createElement("div");
    if (skinId) {
      const skin = SKINS.find((s) => s.id === skinId);
      const bg = skin ? patternCss(skin.pattern, skin.fill, skin.fillSecondary) : "#fff";
      icon.className = "daily-celebrate__icon daily-celebrate__icon--skin";
      icon.style.background = bg;
    } else {
      icon.className = "daily-celebrate__icon daily-celebrate__icon--coin";
      icon.innerHTML = `<i class="ph-fill ph-coins"></i>`;
    }

    const title = document.createElement("div");
    title.className = "daily-celebrate__title";
    if (skinId) {
      const skin = SKINS.find((s) => s.id === skinId);
      title.textContent = skin ? t(skin.nameKey) : skinId;
    } else {
      title.textContent = t("daily_claim_now");
    }

    const amountEl = document.createElement("div");
    amountEl.className = "daily-celebrate__amount";
    amountEl.innerHTML = `<i class="ph-fill ph-coins"></i><span class="daily-celebrate__num">0</span>`;

    stage.appendChild(icon);
    stage.appendChild(title);
    stage.appendChild(amountEl);

    const confetti = document.createElement("div");
    confetti.className = "daily-celebrate__confetti";
    const colors = ["#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#f78c6b", "#c79bff"];
    for (let i = 0; i < 18; i++) {
      const piece = document.createElement("span");
      piece.className = "daily-celebrate__piece";
      const angle = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.4;
      const distance = 110 + Math.random() * 90;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      const rot = (Math.random() * 720 - 360).toFixed(0);
      const delay = Math.floor(Math.random() * 120);
      piece.style.setProperty("--dx", `${dx.toFixed(0)}px`);
      piece.style.setProperty("--dy", `${dy.toFixed(0)}px`);
      piece.style.setProperty("--rot", `${rot}deg`);
      piece.style.background = colors[i % colors.length] ?? "#ffd166";
      piece.style.animationDelay = `${delay}ms`;
      confetti.appendChild(piece);
    }

    overlay.appendChild(backdrop);
    overlay.appendChild(ring);
    overlay.appendChild(confetti);
    overlay.appendChild(stage);
    box.appendChild(overlay);

    this.playClaimSfx(skinId);

    // Count-up the coin amount.
    const countDuration = 700;
    const countDelay = 220;
    const numEl = amountEl.querySelector<HTMLElement>(".daily-celebrate__num");
    this.animateCount(numEl, amount, countDuration, countDelay);
    this.playCoinChime(countDelay, countDuration, !!skinId);

    // Tap-to-skip.
    overlay.addEventListener("click", () => this.endCelebration(overlay), { once: true });

    // Auto-dismiss.
    setTimeout(() => this.endCelebration(overlay), 1900);
  }

  private endCelebration(overlay: HTMLElement): void {
    if (!overlay.isConnected) return;
    this.cancelChime();
    overlay.classList.add("daily-celebrate--out");
    const box = this.boxEl;
    setTimeout(() => {
      overlay.remove();
      box?.classList.remove("daily-modal--celebrating");
      this.celebrating = false;
      this.renderBody();
    }, 220);
  }

  private animateCount(el: HTMLElement | null, target: number, duration: number, delay: number): void {
    if (!el) return;
    const start = performance.now() + delay;
    const tick = (now: number): void => {
      // Bail if modal was unmounted mid-animation.
      if (!el.isConnected) {
        this.countRaf = 0;
        return;
      }
      const elapsed = now - start;
      if (elapsed < 0) {
        this.countRaf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, elapsed / duration);
      const eased = 1 - (1 - p) * (1 - p);
      const v = Math.round(target * eased);
      el.textContent = `+${v}`;
      if (p < 1) {
        this.countRaf = requestAnimationFrame(tick);
      } else {
        this.countRaf = 0;
      }
    };
    this.countRaf = requestAnimationFrame(tick);
  }

  private playCoinChime(delayMs: number, durationMs: number, skinFinale: boolean): void {
    const game = this.game;
    if (!game) return;
    const cache = game.cache.audio;
    const tickKey =
      cache.exists("sfx_capture") ? "sfx_capture" :
      cache.exists("sfx_ui_click") ? "sfx_ui_click" : null;
    if (!tickKey) return;

    const steps = 9;
    const startDetune = -200;
    const endDetune = 900;
    const startVolume = 0.18;
    const endVolume = 0.42;

    for (let i = 0; i < steps; i++) {
      const p = i / (steps - 1);
      // Ease-out so ticks bunch slightly toward the front, matching count-up easing.
      const eased = 1 - (1 - p) * (1 - p);
      const at = delayMs + eased * durationMs;
      const detune = startDetune + (endDetune - startDetune) * p;
      const volume = startVolume + (endVolume - startVolume) * p;
      const id = window.setTimeout(() => {
        try {
          game.sound.play(tickKey, { volume, detune });
        } catch { /* silent */ }
      }, at);
      this.chimeTimers.push(id);
    }

    // Sparkle finale on the last beat for skin rewards.
    if (skinFinale && cache.exists("sfx_capture")) {
      const id = window.setTimeout(() => {
        try {
          game.sound.play("sfx_capture", { volume: 0.5, detune: 1200 });
        } catch { /* silent */ }
      }, delayMs + durationMs + 80);
      this.chimeTimers.push(id);
    }
  }

  private cancelChime(): void {
    for (const id of this.chimeTimers) clearTimeout(id);
    this.chimeTimers = [];
  }

  private playClaimSfx(skinId?: string): void {
    const game = this.game;
    if (!game) return;
    try {
      const cache = game.cache.audio;
      // Soft warm chime — prefer capture pop, then ui click, then a damped upgrade as last resort.
      const primary =
        cache.exists("sfx_capture") ? "sfx_capture" :
        cache.exists("sfx_ui_click") ? "sfx_ui_click" :
        cache.exists("sfx_upgrade") ? "sfx_upgrade" : null;
      if (primary) {
        game.sound.play(primary, {
          volume: primary === "sfx_upgrade" ? 0.32 : 0.5,
          detune: -180 + (Math.random() * 2 - 1) * 40,
        });
      }
      // Gentle echo tail for skin reward only.
      if (skinId && cache.exists("sfx_capture")) {
        setTimeout(() => {
          try {
            game.sound.play("sfx_capture", { volume: 0.28, detune: -360 });
          } catch { /* silent */ }
        }, 180);
      }
    } catch { /* silent */ }
  }

  private tick(): void {
    if (document.hidden) {
      this.tickId = null;
      return;
    }
    const status = this.system.getStatus(Date.now());
    if (this.bodyEl) {
      const cd = this.bodyEl.querySelector<HTMLElement>(".daily-modal__countdown");
      if (cd && !status.canClaim) {
        cd.textContent = t("daily_next", { time: formatMs(status.nextClaimMs) });
      }
      const btn = this.bodyEl.querySelector<HTMLButtonElement>(".daily-modal__claim");
      if (btn?.disabled && status.canClaim) this.renderBody();
    }
    this.tickId = window.setTimeout(() => this.tick(), 1000);
  }

  private startTick(): void {
    this.tickId = window.setTimeout(() => this.tick(), 1000);

    this.onVisibilityChange = () => {
      if (document.hidden) {
        this.stopTick();
      } else {
        if (this.tickId === null) {
          this.tickId = window.setTimeout(() => this.tick(), 0);
        }
      }
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  private stopTick(): void {
    if (this.tickId !== null) {
      clearTimeout(this.tickId);
      this.tickId = null;
    }
  }

  private close(): void {
    this.unmount();
    this.onClose();
  }
}
