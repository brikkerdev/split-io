import Phaser from "phaser";

interface AudioState {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

export class AudioManager {
  private state: AudioState = { musicVolume: 0.6, sfxVolume: 1, muted: false };
  private currentMusic: Phaser.Sound.BaseSound | null = null;

  constructor(private scene: Phaser.Scene) {}

  playMusic(key: string, loop = true): void {
    if (this.currentMusic?.key === key && this.currentMusic.isPlaying) return;
    this.currentMusic?.stop();
    const music = this.scene.sound.add(key, { loop, volume: this.state.musicVolume });
    music.play();
    this.currentMusic = music;
  }

  stopMusic(): void {
    this.currentMusic?.stop();
    this.currentMusic = null;
  }

  playSfx(key: string, opts?: Phaser.Types.Sound.SoundConfig): void {
    if (this.state.muted) return;
    this.scene.sound.play(key, { volume: this.state.sfxVolume, ...opts });
  }

  setMusicVolume(v: number): void {
    this.state.musicVolume = Phaser.Math.Clamp(v, 0, 1);
    if (this.currentMusic && "setVolume" in this.currentMusic) {
      (this.currentMusic as Phaser.Sound.WebAudioSound).setVolume(this.state.musicVolume);
    }
  }

  setSfxVolume(v: number): void {
    this.state.sfxVolume = Phaser.Math.Clamp(v, 0, 1);
  }

  setMuted(muted: boolean): void {
    this.state.muted = muted;
    this.scene.sound.mute = muted;
  }
}
