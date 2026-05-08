import { t } from "./i18n";

export class DomPause {
  private root: HTMLElement;
  private onResume: () => void;
  private onMenu: () => void;

  constructor(onResume: () => void, onMenu: () => void) {
    this.onResume = onResume;
    this.onMenu = onMenu;

    this.root = document.createElement("div");
    this.root.id = "pause-screen";
    this.root.className = "ui-screen interactive";
    this.build();
  }

  mount(): void {
    const overlay = document.getElementById("ui-overlay");
    overlay?.appendChild(this.root);
    requestAnimationFrame(() => {
      this.root.classList.add("visible");
    });
  }

  unmount(): void {
    this.root.classList.remove("visible");
    setTimeout(() => this.root.remove(), 160);
  }

  private build(): void {
    const inner = document.createElement("div");
    inner.className = "pause-inner";

    const title = document.createElement("div");
    title.className = "pause-title";
    title.textContent = t("pause_title");

    const resumeBtn = document.createElement("button");
    resumeBtn.className = "btn btn-primary pause-btn";
    resumeBtn.innerHTML = `<i class="ph ph-play"></i> ${t("pause_resume")}`;
    resumeBtn.addEventListener("click", () => this.onResume());

    const menuBtn = document.createElement("button");
    menuBtn.className = "btn pause-btn";
    menuBtn.innerHTML = `<i class="ph ph-house"></i> ${t("pause_menu")}`;
    menuBtn.addEventListener("click", () => this.onMenu());

    inner.appendChild(title);
    inner.appendChild(resumeBtn);
    inner.appendChild(menuBtn);
    this.root.appendChild(inner);
  }
}
