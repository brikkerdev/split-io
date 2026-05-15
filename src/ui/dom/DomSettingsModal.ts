import { saves } from "@systems/SaveManager";
import { locale } from "@systems/Locale";
import type { SaveV1 } from "@/types/save";
import { DEFAULT_SAVE } from "@/types/save";
import type { Lang } from "@config/game";
import { SUPPORTED_LANGS } from "@config/game";
import { t } from "./i18n";
import { GameEvents } from "@events/GameEvents";
import { GlobalEvents } from "@events/GlobalEvents";

const VOLUME_STEP = 0.05;

const LANG_NATIVE_NAMES: Record<Lang, string> = {
  ru: "Русский",
  en: "English",
  tr: "Türkçe",
};

export class DomSettingsModal {
  private overlay: HTMLElement;
  private box: HTMLElement | null = null;
  private game: Phaser.Game;
  private onClose: () => void;

  private readonly onLangChanged = (): void => {
    if (this.box) this.populateBox(this.box);
  };

  constructor(game: Phaser.Game, onClose: () => void) {
    this.game = game;
    this.onClose = onClose;
    this.overlay = this.build();
  }

  mount(): void {
    document.getElementById("ui-overlay")?.appendChild(this.overlay);
    requestAnimationFrame(() => this.overlay.classList.add("visible"));
    this.game.events.on(GlobalEvents.LangChanged, this.onLangChanged);
  }

  unmount(): void {
    this.overlay.classList.remove("visible");
    this.game.events.off(GlobalEvents.LangChanged, this.onLangChanged);
    setTimeout(() => this.overlay.remove(), 160);
  }

  private close(): void {
    this.unmount();
    this.onClose();
  }

  private build(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const box = document.createElement("div");
    box.className = "modal-box panel settings-modal";
    this.box = box;
    this.populateBox(box);

    overlay.appendChild(box);
    return overlay;
  }

  private populateBox(box: HTMLElement): void {
    box.innerHTML = "";

    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close-btn";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());

    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = t("settings_title");

    const body = document.createElement("div");
    body.className = "modal-body settings-body";

    const save = saves.get<SaveV1>();

    body.appendChild(this.buildVolumeRow(
      "settings_sfx",
      save.settings.sfxVolume,
      (val) => {
        saves.patch({ settings: { ...saves.get<SaveV1>().settings, sfxVolume: val } });
        this.game.sound.volume = val;
      },
    ));

    body.appendChild(this.buildControlRow(save.settings.controlScheme));
    body.appendChild(this.buildLangRow(save.settings.lang));

    body.appendChild(this.buildResetRow());

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const closeActionBtn = document.createElement("button");
    closeActionBtn.className = "btn btn-primary";
    closeActionBtn.textContent = t("settings_close");
    closeActionBtn.addEventListener("click", () => this.close());
    actions.appendChild(closeActionBtn);

    box.appendChild(closeBtn);
    box.appendChild(titleEl);
    box.appendChild(body);
    box.appendChild(actions);
  }

  private buildVolumeRow(labelKey: string, initial: number, onChange: (val: number) => void): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row";

    const label = document.createElement("label");
    label.className = "settings-label";
    label.textContent = t(labelKey);

    const sliderWrap = document.createElement("div");
    sliderWrap.className = "settings-slider-wrap";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = String(VOLUME_STEP);
    slider.value = String(initial);
    slider.className = "settings-slider";

    const valueLabel = document.createElement("span");
    valueLabel.className = "settings-value";
    valueLabel.textContent = Math.round(initial * 100) + "%";

    slider.addEventListener("input", () => {
      const val = parseFloat(slider.value);
      valueLabel.textContent = Math.round(val * 100) + "%";
      onChange(val);
    });

    sliderWrap.appendChild(slider);
    sliderWrap.appendChild(valueLabel);
    row.appendChild(label);
    row.appendChild(sliderWrap);
    return row;
  }

  private buildControlRow(current: "swipe" | "joystick"): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row";

    const label = document.createElement("div");
    label.className = "settings-label";
    label.textContent = t("settings_controls");

    const group = document.createElement("div");
    group.className = "settings-radio-group";

    const schemes: Array<"swipe" | "joystick"> = ["swipe", "joystick"];
    const labelKeys: Record<"swipe" | "joystick", string> = {
      swipe: "settings_control_swipe",
      joystick: "settings_control_joystick",
    };

    schemes.forEach((scheme) => {
      const radioLabel = document.createElement("label");
      radioLabel.className = "settings-radio-label";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "control-scheme";
      radio.value = scheme;
      radio.checked = scheme === current;

      radio.addEventListener("change", () => {
        if (radio.checked) {
          const s = saves.get<SaveV1>().settings;
          saves.patch({ settings: { ...s, controlScheme: scheme } });
          this.game.events.emit(GameEvents.ControlSchemeChanged, scheme);
        }
      });

      radioLabel.appendChild(radio);
      radioLabel.appendChild(document.createTextNode(t(labelKeys[scheme])));
      group.appendChild(radioLabel);
    });

    row.appendChild(label);
    row.appendChild(group);
    return row;
  }

  private buildResetRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row settings-row--reset";

    const label = document.createElement("div");
    label.className = "settings-label";
    label.textContent = t("settings_reset");

    const btn = document.createElement("button");
    btn.className = "btn btn-danger settings-reset-btn";
    btn.textContent = t("settings_reset_btn");
    btn.addEventListener("click", () => this.openResetConfirm());

    row.appendChild(label);
    row.appendChild(btn);
    return row;
  }

  private openResetConfirm(): void {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay reset-confirm-overlay";

    const box = document.createElement("div");
    box.className = "modal-box panel reset-confirm";

    const close = (): void => {
      overlay.classList.remove("visible");
      setTimeout(() => overlay.remove(), 160);
    };

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const icon = document.createElement("div");
    icon.className = "reset-confirm__icon";
    icon.innerHTML = `<i class="ph-fill ph-warning"></i>`;

    const title = document.createElement("div");
    title.className = "reset-confirm__title";
    title.textContent = t("reset_confirm_title");

    const body = document.createElement("div");
    body.className = "reset-confirm__body";
    body.textContent = t("reset_confirm_body");

    const actions = document.createElement("div");
    actions.className = "reset-confirm__actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-primary";
    cancelBtn.textContent = t("reset_confirm_cancel");
    cancelBtn.addEventListener("click", close);

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn btn-danger";
    confirmBtn.textContent = t("reset_confirm_ok");
    confirmBtn.addEventListener("click", () => {
      saves.resetTo(DEFAULT_SAVE);
      try {
        locale.setLang(DEFAULT_SAVE.settings.lang ?? locale.getLang());
      } catch { /* ignore */ }
      this.game.sound.volume = DEFAULT_SAVE.settings.sfxVolume;
      // Persist the reset before reloading; otherwise the debounced flush
      // races the reload and the next session may still see the old save
      // (incl. tutorialShown=true, so tutorial wouldn't replay).
      saves.flush().finally(() => window.location.reload());
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    box.appendChild(icon);
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(actions);
    overlay.appendChild(box);

    document.getElementById("ui-overlay")?.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("visible"));
  }


  private buildLangRow(currentLang: Lang | null): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row settings-row--stacked";

    const label = document.createElement("div");
    label.className = "settings-label";
    label.textContent = t("settings_lang");

    const group = document.createElement("div");
    group.className = "settings-radio-group";

    const effectiveLang = currentLang ?? locale.getLang();

    SUPPORTED_LANGS.forEach((lang) => {
      const radioLabel = document.createElement("label");
      radioLabel.className = "settings-radio-label";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "lang-select";
      radio.value = lang;
      radio.checked = lang === effectiveLang;

      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        if (lang === locale.getLang()) return;
        locale.setLang(lang);
        const s = saves.get<SaveV1>().settings;
        saves.patch({ settings: { ...s, lang } });
        this.game.events.emit(GlobalEvents.LangChanged, lang);
      });

      radioLabel.appendChild(radio);
      radioLabel.appendChild(document.createTextNode(LANG_NATIVE_NAMES[lang]));
      group.appendChild(radioLabel);
    });

    row.appendChild(label);
    row.appendChild(group);
    return row;
  }
}
