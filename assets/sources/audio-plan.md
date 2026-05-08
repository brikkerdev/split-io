# Audio Plan — Split.io (Minimalist remap)

Source: existing local packs in `C:\Users\Daniel\Documents\Assets\` (no API fetch).
All files normalised via ffmpeg `loudnorm` and dual-encoded as OGG (libvorbis) primary + M4A (AAC) Safari fallback.

## Music
| Key | File | Source |
|---|---|---|
| `mus_menu` | mus_menu.{ogg,m4a} | Cozy Tunes — `Drifting Memories.ogg` (90s + fade-out) |
| `mus_game` | mus_game.{ogg,m4a} | Cozy Tunes — `Sunlight Through Leaves.ogg` (90s + fade-out) |
| `mus_stinger` | mus_stinger.{ogg,m4a} | Shapeforms Arcane — `Arcane Wind Chime Gust.wav` |

Music encoding: `loudnorm I=-18`, vorbis q:a 2 / aac 80k, trimmed 90s with 2s fade-out tail for cleaner loop transition.

## SFX
| Key | File | Source |
|---|---|---|
| `sfx_capture` | sfx_capture.* | Shapeforms Arcane — `Glyph Activation Light 01.wav` |
| `sfx_split` | sfx_split.* | Shapeforms Arcane — `UI Message Appear 01.wav` |
| `sfx_upgrade` | sfx_upgrade.* | Shapeforms Arcane — `Glyph Activation Warm Aura.wav` |
| `sfx_victory` | sfx_victory.* | Shapeforms Arcane — `Arcane Symbol Activate 01.wav` |
| `sfx_warning` | sfx_warning.* | Shapeforms Arcane — `Arcane Beacon.wav` |
| `sfx_match_start` | sfx_match_start.* | Shapeforms Arcane — `Activate Glyph Forcefield.wav` |
| `sfx_death` | sfx_death.* | Shapeforms Cassette — `TAPE STOP_15.wav` |
| `sfx_countdown` | sfx_countdown.* | Shapeforms Cassette — `BUTTON_03.wav` |
| `sfx_ui_click` | sfx_ui_click.* | Shapeforms Cassette — `BUTTON_05.wav` |
| `sfx_ui_hover` | sfx_ui_hover.* | JDSherbert UI Pack — `Cursor - 3.ogg` |

SFX encoding: `loudnorm I=-16`, vorbis q:a 3 / aac 96k.

## Budget
- Total **5.5MB** (≪ 10MB Yandex limit).
- Music dominates: 2 × ~1.2MB ogg + small stinger; SFX ≈ 700KB combined.
- Further squeeze possible: drop music to q:a 1 + aac 64k → ~3MB total. Hold for now.

## Wiring (unchanged)
- `PreloadScene` loads via `AUDIO` registry as `[ogg, m4a]` array.
- `JuiceSystem` plays gameplay SFX on `GameEvents` (capture, death, ghost, upgrade, kill, warning).
- `GameScene` plays `sfx_match_start` and starts `mus_game` loop on round start.
- `MenuScene` plays `mus_menu` loop.
- `GameOverScene` plays `mus_stinger`.
- `DomUI` delegates click/mouseenter to play `sfx_ui_click` / `sfx_ui_hover`.

## Style note
Switched from cyberpunk Future-UI palette to **Arcane Activations + Cassette** for clean, minimal, almost ASMR-grade feedback. Music switched from Dystopia drones to Cozy Tunes lo-fi ambient — pairs better with minimalist visuals.
