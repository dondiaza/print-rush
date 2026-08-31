# Arquitectura

## Límites

- `apps/web`: presentación React, render Babylon, input y predicción local.
- `apps/game-server`: autoridad de sala. El cliente solo puede enviar `GameInput`.
- `packages/game-core`: configuración, tipos, simulación, validación de vueltas, ranking, RNG y reglas compartidas.

La lógica de carrera no vive en componentes React. `RaceExperience` mantiene UI y lifecycle; `GameRuntime` integra render/física; `game-core` decide reglas reproducibles.

## Flujo autoritativo

```text
input del dispositivo
  -> sanitize + sequence + rate limit
  -> tick servidor 30 Hz
  -> simulación compartida
  -> checkpoints/ranking servidor
  -> patch de estado 20 Hz
  -> reconciliación cliente / interpolación remota
```

El vertical slice offline usa el mismo modelo de input y la misma función `simulateKart`. Rapier mantiene el mundo de colisión del cliente; el transporte nunca acepta transformaciones declaradas por el navegador.

## Escalado

Cada `RaceRoom` posee timers y estado. Al quedar vacía se libera su simulación. La primera producción multiplayer puede ejecutar una instancia Node; el siguiente escalón usa RedisPresence/RedisDriver sin trasladar autoridad al host del lobby.
