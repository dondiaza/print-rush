# Print Rush

Print Rush es un juego web 3D de carreras arcade ambientado en una tienda-taller de camisetas. Este repositorio contiene el vertical slice jugable y la base de servidor autoritativo del producto descrito en `docs/`.

## Estado actual

El vertical slice incluye:

- circuito procedural **Flagship Store**, sin assets externos;
- un kart controlable y tres bots sobre racing spline;
- conducción arcade a paso fijo, freno/reversa, drift de tres niveles y boost;
- checkpoints en orden, vueltas 1/2/3/5, clasificación y resultados;
- item box funcional con **Thread Boost**, placas de boost y recovery;
- HUD, minimapa, sonido procedural, pausa y calidad dinámica;
- teclado y controles táctiles específicos para landscape;
- PWA instalable y UI responsive;
- paquete `game-core` compartido por cliente y servidor;
- servidor Colyseus 0.18 autoritativo, hasta cuatro clientes, input validation/rate limiting, state sync y reconexión;
- tests unitarios de reglas críticas y CI.

El servidor WebSocket se despliega por separado en infraestructura Node persistente. Vercel aloja el frontend y no sustituye ese runtime.

## Arranque

Requisitos: Node.js 22 o superior.

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

Servidor multiplayer:

```bash
npm run dev:server
```

Health check: `http://localhost:2567/health`.

## Controles

| Acción | Teclado |
| --- | --- |
| Acelerar | W / ↑ |
| Frenar / reversa | S / ↓ |
| Girar | A/D / ←/→ |
| Drift | Espacio |
| Objeto | E |
| Recovery | R |
| Pausa | Esc |

En móvil se muestran controles táctiles y opción de auto-aceleración.

## Verificación

```bash
npm run check
```

Ejecuta lint, typecheck, tests y builds de los tres workspaces.

## Estructura

```text
apps/
  web/             Next.js + React + Babylon.js + Rapier
  game-server/     Colyseus autoritativo + health endpoint
packages/
  game-core/       reglas, tipos, configuración y simulación compartida
docs/              arquitectura y guías del proyecto
```

## Configuración

Copia `.env.example` a `.env.local` cuando conectes un servidor persistente. `NEXT_PUBLIC_GAME_SERVER_URL` es la única URL de networking expuesta al navegador; credenciales de PostgreSQL y Redis son siempre server-only.

## Siguiente hito

El orden de expansión se mantiene deliberadamente: conectar el cliente visual al `RaceRoom`, cerrar prediction/reconciliation para dos navegadores, validar cuatro clientes y, solo después, ampliar objetos, avatares, garaje, persistencia y admin. Véase [ARCHITECTURE.md](docs/ARCHITECTURE.md).
