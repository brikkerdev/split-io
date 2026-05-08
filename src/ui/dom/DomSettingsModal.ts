import { saves } from "@systems/SaveManager";
import { locale } from "@systems/Locale";
import type { SaveV1 } from "@/types/save";
import type { Lang } from "@config/game";
import { SUPPORTED_LANGS } from "@config/game";
import { t } from "./i18n";

const VOLUME_STEP = 0.05;

export class DomSettingsModal {
  private overlay: HTMLElement;
  private game: Phaser.Game;
  private onClose: () => void;

  constructor(game: Phaser.Game, onClose: () => void) {
    this.game = game;
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
      "settings_music",
      save.settings.musicVolume,
      (val) => {
        saves.patch({ settings: { ...saves.get<SaveV1>().settings, musicVolume: val } });
      },
    ));

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
    overlay.appendChild(box);

    return overlay;
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

  private buildLangRow(currentLang: Lang | null): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row";

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
        if (radio.checked) {
          locale.setLang(lang);
          const s = saves.get<SaveV1>().settings;
          saves.patch({ settings: { ...s, lang } });
          this.game.events.emit("lang:changed", lang);
        }
      });

      radioLabel.appendChild(radio);
      radioLabel.appendChild(document.createTextNode(lang.toUpperCase()));
      group.appendChild(radioLabel);
    });

    row.appendChild(label);
    row.appendChild(group);
    return row;
  }
}
