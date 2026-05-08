export interface EconomyConfig {
  startingCoins: number;
  rewardMultiplier: number;
  costGrowthRate: number;
}

export class Economy {
  private coins: number;

  constructor(private config: EconomyConfig) {
    this.coins = config.startingCoins;
  }

  getCoins(): number {
    return this.coins;
  }

  add(amount: number): void {
    if (amount < 0) throw new Error("Use spend() for negative amounts");
    this.coins += Math.floor(amount * this.config.rewardMultiplier);
  }

  spend(amount: number): boolean {
    if (this.coins < amount) return false;
    this.coins -= amount;
    return true;
  }

  costAtLevel(baseCost: number, level: number): number {
    return Math.floor(baseCost * Math.pow(this.config.costGrowthRate, level));
  }
}
