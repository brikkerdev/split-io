# Audio Plan — Split.io (Warm tactile, SFX-only)

No background music. All SFX in a unified warm/dull tactile palette: physical button presses, card taps, cassette mechanics. Lowpass filter (2.5–5kHz) on every clip kills brightness/sparkle so repeats stay pleasant.

All files: `loudnorm=I=-16:LRA=11:TP=-1.5` then per-clip lowpass, dual-encoded OGG (libvorbis q:a 4) + M4A (AAC 96k).

## SFX
| Key | Source | Lowpass |
|---|---|---|
| `sfx_capture` | The Mint — `Bank Card Placed Down 03` | 3.5 kHz |
| `sfx_split` | Cassette — `BUTTON_05` | 3.5 kHz |
| `sfx_upgrade` | The Mint — `Coins Placed Down Hardcover Pitched` | 3.5 kHz |
| `sfx_victory` | Cassette — `OPEN_CASE_02` | 4.0 kHz |
| `sfx_warning` | Cassette — `BUTTON_STOP_02` | 2.5 kHz (deepest) |
| `sfx_death` | Cassette — `TAPE STOP_15` | 2.5 kHz |
| `sfx_match_start` | Cassette — `LOAD_CASSETTE_08` | 4.0 kHz |
| `sfx_countdown` | Cassette — `BUTTON_03` | 3.0 kHz |
| `sfx_ui_click` | Kenney UI Audio — `click4` (CC0) | 4.5 kHz |
| `sfx_ui_hover` | Kenney UI Audio — `rollover3` (CC0) | 5.0 kHz |

Lowpass scale rationale:
- 2.5–3.0 kHz → ominous/grave events (death, warning, countdown).
- 3.5–4.0 kHz → main gameplay feedback (capture, split, upgrade, victory, match start).
- 4.5–5.0 kHz → UI (still warm, but a hair brighter so micro-clicks remain readable).

## Pitch / volume variation (in code)
Every SFX is played with random detune + volume jitter:
- Capture (very frequent): ±350¢, ±10% volume.
- Kill victory: ±250¢, ±8%.
- Default (split, death, upgrade, warning, ghost): ±150¢, ±8% (`JuiceSystem.playSfx`).
- UI click: ±200¢, ±5%. UI hover: ±250¢, ±5%.
- Match start: ±100¢ (subtle).

## Budget
- Total **232 KB** (~0.2% of 100MB Yandex limit).

## Wiring
- `PreloadScene` loads `AUDIO.sfx` keys as `[ogg, m4a]` arrays.
- `JuiceSystem` plays gameplay SFX on `GameEvents` (capture, death, ghost, upgrade, kill, warning).
- `GameScene` plays `sfx_match_start` on round start.
- `MenuScene` / `GameOverScene` — silent.
- `DomUI` delegates click/mouseenter on overlay buttons → `sfx_ui_click` / `sfx_ui_hover`.
