# Testing

`npm run check` es la puerta completa: lint, typecheck, unit tests y build.

Los tests actuales cubren saneado/rate-limit de input, vueltas permitidas, drift/boost, transiciones de fase, checkpoints en orden, ranking, wrong-way y RNG reproducible.

La fase multiplayer añadirá fixtures Colyseus para 1–4 clientes, reconnect e inputs concurrentes, seguida de Playwright en Chrome desktop y emulación móvil landscape.
