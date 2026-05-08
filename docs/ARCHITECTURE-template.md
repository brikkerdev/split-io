# Architecture

## Scene flow
Boot → Preload → Menu → Game (+ UI overlay) → GameOver

## Systems

| System | Responsibility | Owns | Reads |
|---|---|---|---|
| Economy | coins/gems баланс | save | configs |
| ... | | | |

## Events

| Event | Payload | From | To |
|---|---|---|---|
| score:update | number | Game | UI |

## Save schema

```ts
interface SaveV1 {
  version: 1;
  coins: number;
  // ...
}
```

## Balance configs
- `src/config/economy.ts` — costs, multipliers
- `src/config/levels.ts` — thresholds
- ...

## Performance budget
- 60 FPS на mid-tier mobile (Snapdragon 6xx, 4GB RAM)
- < 50 спрайтов на экране одновременно
- < 100 партиклов одновременно
- Текстурный атлас в RAM ≤ 32MB
