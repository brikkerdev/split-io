import type Phaser from "phaser";
import { GameEvents } from "@events/GameEvents";
import type { Hero } from "@entities/Hero";
import type { BotAI } from "@systems/BotAI";
import type { PolygonTerritorySystem } from "@systems/PolygonTerritorySystem";
import type {
  LeaderboardEntry,
  LeaderboardUpdatePayload,
} from "@gametypes/events";
import { t } from "@ui/dom/i18n";

export interface LeaderboardDeps {
  hero: Hero;
  heroFill: () => number;
  botAI: BotAI;
  territory: PolygonTerritorySystem;
  isDemoPhase: () => boolean;
}

export class LeaderboardEmitter {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: LeaderboardDeps,
  ) {}

  emit(): void {
    const hero = this.deps.hero;
    const heroPct = this.deps.territory.getOwnerPercent(hero.id);
    const entries: LeaderboardEntry[] = [];

    if (!this.deps.isDemoPhase() || hero.alive) {
      entries.push({
        id: hero.id,
        name: t("hud_lb_you"),
        color: this.deps.heroFill(),
        percent: heroPct,
        isHero: true,
        alive: hero.alive,
      });
    }

    for (const bot of this.deps.botAI.getAll()) {
      entries.push({
        id: bot.id,
        name: bot.name,
        color: bot.color,
        percent: this.deps.territory.getOwnerPercent(bot.id),
        isHero: false,
        alive: bot.alive,
      });
    }

    entries.sort((a, b) => b.percent - a.percent);

    const heroIdx = entries.findIndex((e) => e.isHero);
    const heroRank = heroIdx === -1 ? -1 : heroIdx + 1;
    const payload: LeaderboardUpdatePayload = {
      entries,
      heroRank,
      totalPlayers: entries.length,
    };
    this.scene.events.emit(GameEvents.LeaderboardUpdate, payload);
  }
}
