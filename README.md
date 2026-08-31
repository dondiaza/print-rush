# Print Rush

Print Rush es un juego web 3D de carreras arcade ambientado en una tienda-taller de camisetas. Este repositorio contiene el vertical slice jugable y la base de servidor autoritativo del producto descrito en `docs/`.

## Estado actual

La versión actual incluye:

- circuito procedural **Flagship Store**, sin assets externos;
- personaje y kart paramétricos equipables, con ocho y cinco presets respectivamente;
- avatar desde foto con análisis local en worker, cámara, consentimiento y borrado;
- Circuit Factory con tres pistas por seed y edición de spline/anchura/tema;
- Asset Browser con 50 props y exportación JSON versionada;
- un kart controlable y tres bots visualmente distintos sobre racing spline;
- conducción arcade a paso fijo, freno/reversa, drift de tres niveles y boost;
- checkpoints en orden, vueltas 1/2/3/5, clasificación y resultados;
- diez items deterministas, item boxes, placas de boost y recovery;
- HUD, minimapa, sonido procedural, pausa y calidad dinámica;
- teclado, gamepad y controles táctiles específicos para landscape;
- PWA instalable y UI responsive;
- paquete `game-core` compartido por cliente y servidor;
- servidor Colyseus 0.18 autoritativo, hasta cuatro clientes, input validation/rate limiting, state sync y reconexión;
- perfiles LOW–ULTRA, dashboard de rendimiento, PWA offline y CI;
- tests unitarios de reglas críticas, factory, migraciones y determinismo.

Consulta [3D Factory V2/V3](docs/FACTORY_V2_V3.md) para las rutas, contratos y garantías de privacidad.

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

Ejecuta lint, typecheck, tests y builds de los cuatro workspaces.

## Estructura

```text
apps/
  web/             Next.js + React + Babylon.js + Rapier
  game-server/     Colyseus autoritativo + health endpoint
packages/
  game-core/       reglas, tipos, configuración y simulación compartida
  3d-factory/      schemas, generadores, presets, migraciones y registro
docs/              arquitectura y guías del proyecto
```

## Configuración

Copia `.env.example` a `.env.local` cuando conectes un servidor persistente. `NEXT_PUBLIC_GAME_SERVER_URL` es la única URL de networking expuesta al navegador; credenciales de PostgreSQL y Redis son siempre server-only.

## Multiplayer

`RaceRoom` acepta cuatro clientes, simula a 30 Hz, valida/rate-limita inputs, sincroniza hashes y definiciones cosméticas, y reserva asiento durante interrupciones móviles. El servidor WebSocket debe ejecutarse en infraestructura Node persistente; Vercel aloja el frontend estático.
