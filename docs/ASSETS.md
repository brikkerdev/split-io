# Split.io — Asset Plan

Style: soft pastel minimalism, clean flat 2D vector, gentle rounded shapes, matte color fills, no neon, no glow, no gradients, no 3D, no outlines (or very thin same-tone outline only).

**Runtime palette (применяется через Phaser tint, не запекается в спрайт):**
sky-blue #A8D8EA (hero), warm pink #F7B7D2 (ghost), cream #FFF6E6 (bg highlight), muted charcoal #4A4E5C (UI text). Accent secondaries: mint #B8E0C2, peach #FFD8B1, lavender #D4C5F9, soft coral #F7A6A6.

## Pipeline note

ChatGPT (и большинство diffusion-моделей) не отдаёт transparent PNG. Нужен chromakey + локальный вырез.

**Ключевые правила пайплайна:**
1. **Иконки рисуем БЕЛЫМ силуэтом** (#FFFFFF) — без цвета. Цвет навешиваем в рантайме через `sprite.setTint(0xA8D8EA)` и т.п. Один спрайт `ic_speed` можно покрасить хоть в sky-blue, хоть в pink — переиспользуется на любую механику.
2. **Фон во ВСЕХ промптах — чистый magenta #FF00FF** (chromakey). Контрастный, не встречается в палитре игры, легко режется любым keyer-ом.
3. Генерируем в большом разрешении (1024×1024 для иконок, 1536×768 для лого) — чистый вектор, не пиксели.
4. Локально режем magenta в transparent: ImageMagick `magick in.png -fuzz 8% -transparent "#FF00FF" out.png` (или `rembg`, если силуэт сложный).
5. Финальный downscale до целевого pixel-размера делается уже после keying.

**Исключения (цветные ассеты, не белые):**
- `logo_splitio.png` — лого с конкретными цветами в буквах, нельзя tint-ить однородно.
- `icon_512.png` — финальная иконка для Яндекса, цветная, фон cream (не magenta), без вырезания.

---

## Common style block (вставлять префиксом в каждый промпт)

```
ART STYLE — match this EXACTLY:
Soft pastel minimalism, flat 2D vector illustration, matte color fills only.
NO neon, NO glow, NO bloom, NO gradients on surfaces, NO 3D shading,
NO photorealistic textures, NO drop shadows, NO outlines (or hairline same-tone
outline at most). Calm, friendly, unintimidating geometry — like a modern
mobile casual game from a Scandinavian studio. Gently rounded corners,
generous negative space, smooth curves.

BACKGROUND — CHROMAKEY:
Solid flat pure magenta color (#FF00FF, RGB 255,0,255) covering the entire
canvas edge to edge. NOT transparent, NOT checkered, NOT white, NOT a
gradient — one uniform bright magenta rectangle behind the subject. The
subject sits centered with generous padding around it. The magenta is a
chroma-key fill that will be removed in post — keep it absolutely uniform
and DO NOT let any magenta bleed into the subject shape.

RENDERING:
Clean smooth vector shape rendering, crisp curves, NOT pixel art, NOT a low-res
sprite, NOT mosaic / 8-bit / blocky. Render large and clean — fine downscaling
happens later in the pipeline.

NEGATIVE: no text, no watermark, no neon, no glow, no gradient mesh, no 3D,
no realistic textures, no drop shadow, no lens flare, no harsh contrast,
no pixel-art aesthetic, no checker pattern, no transparency, no other
background colors, no magenta tint or magenta highlights on the subject.
```

---

## Images

### 1. ic_player_marker.png
- **Final size:** 16x16 px (downscale after keying)
- **Generate at:** 1024x1024 px on solid magenta background
- **Subject color:** pure white #FFFFFF (tinted at runtime)
- **Purpose:** Arrow marker displayed on the hero unit. Recolored per-player via Phaser tint.
- **Used by:** `scenes/Game.ts`, `entities/Hero.ts`, Phaser texture key `ic_player_marker`
- **Prompt:**
  ```
  [insert ART STYLE block from above]

  Single rounded triangular arrow shape pointing upward, filled with solid
  pure white (#FFFFFF), gently rounded corners on all three points, slightly
  thicker base than tip, balanced and clearly readable silhouette. No outline,
  no inner detail, just one clean white shape centered on the magenta
  chromakey background with generous padding around it.
  ```

---

### 2. ic_speed.png
- **Final size:** 32x32 px
- **Generate at:** 1024x1024 px on solid magenta background
- **Subject color:** pure white #FFFFFF (tinted at runtime)
- **Purpose:** Reusable upgrade icon, semantically "speed". Tint applied per upgrade rarity.
- **Used by:** `scenes/UI.ts`, `systems/Progression.ts`, upgrade iconKey `ic_speed`
- **Prompt:**
  ```
  [insert ART STYLE block from above]

  A friendly stylized chubby chevron or soft cloud-puff with two short rounded
  motion lines trailing behind it, all parts filled solid pure white (#FFFFFF).
  Gently rounded corners, smooth curves, no sharp angles. Conveys "speed" in a
  calm, cute way — not aggressive. Centered on the magenta chromakey background
  with generous padding.
  ```

---

### 3. ic_homing.png
- **Final size:** 32x32 px
- **Generate at:** 1024x1024 px on solid magenta background
- **Subject color:** pure white #FFFFFF (tinted at runtime)
- **Purpose:** Reusable upgrade icon, semantically "homing / reach".
- **Used by:** `scenes/UI.ts`, `systems/Progression.ts`, upgrade iconKey `ic_homing`
- **Prompt:**
  ```
  [insert ART STYLE block from above]

  Two soft curved arcs forming a gentle horseshoe / loop shape, suggesting a
  long curving trajectory, filled solid pure white (#FFFFFF). Rounded line
  caps, smooth even thickness, no arrowheads or thin tapered ends — chunky
  friendly shape. Conveys "reach" or "extension". Centered on the magenta
  chromakey background with generous padding.
  ```

---

### 4. ic_split.png
- **Final size:** 32x32 px
- **Generate at:** 1024x1024 px on solid magenta background
- **Subject color:** pure white #FFFFFF (tinted at runtime)
- **Purpose:** Reusable upgrade icon, semantically "cooldown / timer".
- **Used by:** `scenes/UI.ts`, `systems/Progression.ts`, upgrade iconKey `ic_split`
- **Prompt:**
  ```
  [insert ART STYLE block from above]

  Cute round clock face with two short rounded clock hands, the entire shape
  including hands filled solid pure white (#FFFFFF). Soft chubby proportions,
  no tick marks, no numbers, no inner color separation — one unified white
  silhouette. The hands are slightly recessed into the body via subtle
  same-tone shape boundaries only. Centered on the magenta chromakey
  background with generous padding.
  ```

---

### 5. ic_shield.png
- **Final size:** 32x32 px
- **Generate at:** 1024x1024 px on solid magenta background
- **Subject color:** pure white #FFFFFF (tinted at runtime)
- **Purpose:** Reusable upgrade icon, semantically "shield / defense".
- **Used by:** `scenes/UI.ts`, `systems/Progression.ts`, upgrade iconKey `ic_shield`
- **Prompt:**
  ```
  [insert ART STYLE block from above]

  Soft rounded shield silhouette, classic heater shape with a fully rounded
  bottom point and a gently curved top, filled solid pure white (#FFFFFF).
  No rivets, no metallic detail, no inner crest — just one cute matte shape.
  Centered on the magenta chromakey background with generous padding.
  ```

---

### 6. ic_reserve_a.png
- **Final size:** 32x32 px
- **Generate at:** 1024x1024 px on solid magenta background
- **Subject color:** pure white #FFFFFF (tinted at runtime)
- **Purpose:** Reusable upgrade icon, semantically "bonus / reward star".
- **Used by:** Future `upgrades.ts` entry, iconKey `ic_reserve_a`
- **Prompt:**
  ```
  [insert ART STYLE block from above]

  Soft rounded four-point star or chubby diamond shape with rounded corners,
  filled solid pure white (#FFFFFF). Plump friendly geometry, no thin spikes,
  no inner cutouts. Reads as a "bonus / reward" marker. Centered on the
  magenta chromakey background with generous padding.
  ```

---

### 7. ic_reserve_b.png
- **Final size:** 32x32 px
- **Generate at:** 1024x1024 px on solid magenta background
- **Subject color:** pure white #FFFFFF (tinted at runtime)
- **Purpose:** Reusable upgrade icon, semantically "scan / radar pulse".
- **Used by:** Future `upgrades.ts` entry, iconKey `ic_reserve_b`
- **Prompt:**
  ```
  [insert ART STYLE block from above]

  Two concentric rounded arcs forming a simple radar / scan-pulse mark, with a
  small filled dot at the center, all parts filled solid pure white (#FFFFFF).
  Even rounded stroke thickness, no fading, no thin tails. Reads as
  "scan / detect". Centered on the magenta chromakey background with generous
  padding.
  ```

---

### 8. logo_splitio.png
- **Final size:** 512x256 px (downscale after keying)
- **Generate at:** 1536x768 px on solid magenta background (2:1 aspect)
- **Subject color:** **полноцветный** (cyan/pink/charcoal) — лого, не tint-ится
- **Purpose:** Game title logo displayed in Menu scene (Boot splash + main menu header).
- **Used by:** `scenes/Menu.ts`, `scenes/Boot.ts`, texture key `logo_splitio`
- **Prompt:**
  ```
  [insert ART STYLE block from above]

  Wordmark logo reading exactly "SPLIT.IO", rounded geometric sans-serif
  typeface with chunky friendly letterforms, the word "SPLIT" filled in soft
  sky-blue (#A8D8EA), the period "." filled in warm pink (#F7B7D2), the "IO"
  filled in muted charcoal (#4A4E5C). Letters sit on a single horizontal
  baseline, tight but readable spacing, centered horizontally on the magenta
  chromakey background with generous padding above and below. Flat matte
  fills, no glow, no shadow, no outline, no decorative ornaments.

  Important: the letter fill colors must NOT contain any magenta — those three
  pastel colors are reserved exclusively for the glyphs.

  NEGATIVE: no text other than the exact glyphs S P L I T . I O,
  no extra letters, no slogan, no neon, no drop shadow, no gradient,
  no pixel-art font, no rasterized blocky letters,
  no magenta tint anywhere on the letters.
  ```

---

### 9. icon_512.png
- **Final size:** 512x512 px (downscale from 1024)
- **Generate at:** 1024x1024 px on **solid cream (#FFF6E6) background — NOT magenta, no keying**
- **Subject color:** полноцветный (cyan + pink)
- **Purpose:** App icon for Yandex Games. Yandex requires a non-transparent square icon, cream stays as the visual background.
- **Used by:** `promo/icon_512.png`
- **Prompt:**
  ```
  ART STYLE: soft pastel minimalism, flat 2D vector, matte color fills, gently
  rounded geometry, no neon / glow / gradient / 3D / outline. Clean smooth
  vector rendering, NOT pixel art.

  BACKGROUND: solid flat cream color (#FFF6E6) covering the entire canvas
  edge to edge — this is the FINAL visual background, not a chromakey.

  Square app icon, centered composition: a chubby rounded sky-blue (#A8D8EA)
  arrow shape and a chubby rounded warm pink (#F7B7D2) arrow shape, both
  pointing slightly inward, with two soft curving pastel ribbons (one
  sky-blue, one pink) trailing from them and meeting to enclose a small
  rounded area in the middle. Reads as "two friends looping together".
  Generous padding around the silhouette — must remain readable at 64x64
  thumbnail size.

  NEGATIVE: no text, no letters, no watermark, no neon, no glow, no 3D,
  no drop shadow, no border frame, no magenta, no transparency,
  no checker pattern.
  ```

---

## Generation Checklist

- [ ] **1.** `ic_speed.png` (gen 1024 magenta, white silhouette, final 32x32)
- [ ] **2.** `ic_homing.png` (gen 1024 magenta, white silhouette, final 32x32)
- [ ] **3.** `ic_split.png` (gen 1024 magenta, white silhouette, final 32x32)
- [ ] **4.** `ic_shield.png` (gen 1024 magenta, white silhouette, final 32x32)
- [ ] **5.** `ic_reserve_a.png` (gen 1024 magenta, white silhouette, final 32x32)
- [ ] **6.** `ic_reserve_b.png` (gen 1024 magenta, white silhouette, final 32x32)
- [ ] **7.** `ic_player_marker.png` (gen 1024 magenta, white silhouette, final 16x16)
- [ ] **8.** `logo_splitio.png` (gen 1536x768 magenta, full-color letters, final 512x256)
- [ ] **9.** `icon_512.png` (gen 1024 cream bg, full-color, final 512x512 — без keying)

Post-processing for items 1-8:
1. Складываем raw output в `assets/sources/icons/`.
2. Магента → прозрачность:
   ```
   magick source.png -fuzz 8% -transparent "#FF00FF" -trim +repage cleaned.png
   ```
   Если по контуру остаётся розовый ореол — поднять `-fuzz` до 12-15% или добавить `-channel A -morphology Erode Disk:1`.
3. Downscale до целевого размера:
   ```
   magick cleaned.png -resize 32x32 -filter Lanczos final.png
   ```
4. Кладём в `assets/images/<name>.png`.

Item 9 (`icon_512.png`): только downscale 1024→512, фон cream остаётся, magenta-keying не запускаем.

After all 9 are placed:
- Verify no Cyrillic/spaces in filenames.
- Pack items 1-7 into a single sprite atlas: `assets/atlases/ui.atlas.png` + `ui.atlas.json` (free-tex-packer-cli or TexturePacker).
- `logo_splitio.png` and `icon_512.png` stay as standalone files (not in atlas).
- Final atlas texture key in Phaser Preload: `this.load.atlas("ui", "assets/atlases/ui.atlas.png", "assets/atlases/ui.atlas.json")`.
- Иконки в коде красим через `sprite.setTint(0xA8D8EA)` — палитра в `src/config/palette.ts`.
