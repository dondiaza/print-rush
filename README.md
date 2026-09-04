# Print Rush V5

Print Rush es un videojuego web 3D de carreras arcade ambientado en el universo de impresión y camisetas de Pampling. El frontend jugable está construido con Next.js y Babylon.js; la simulación determinista compartida y el servidor autoritativo viven en workspaces independientes.

## V5 jugable

- Cinco circuitos extensos: T-Shirt Store Grand Prix, Warehouse Mayhem, Print Factory Panic, Office Overdrive y Manga Convention Madness.
- Cinco sectores por circuito con superficies, elevación, peralte, landmarks, hazards, rampas, boost pads y dos atajos transitables.
- Circuit Factory V5 con métricas de longitud, desnivel, dificultad, tiempo estimado y validación antes de guardar.
- Conducción arcade determinista a 120 Hz con dirección progresiva, ayuda suave de trazada, salida turbo, rebufo, saltos, recuperación y autopiloto después de meta.
- Derrape de tres niveles con boost al soltar, inclinación del kart, humo, partículas y skid marks mediante pools reutilizables.
- Trece power-ups V5 con ruleta, balance por posición y distancia, proyectiles, trampas, áreas, escudo, indicadores y lanzamiento hacia atrás.
- Feedback completo de velocidad e impacto: FOV, cámara, chispas, tinta periférica, aviso de proyectil, audio procedural y efectos de superficie.
- Flujo completo: configuración, selección de pista, briefing y controles, parrilla, carrera, meta, autopiloto, podio, revancha, siguiente pista y pista aleatoria.
- Teclado, gamepad y controles táctiles landscape con auto-aceleración, pausa y panel de ayuda.
- Personaje y kart paramétricos, avatar desde foto procesado localmente, Asset Browser, PWA y perfiles de calidad adaptativos elegidos antes de presentar la carrera.
- Carga bloqueante real: manifiesto por circuito, assets críticos/opcionales, compilación de shaders, calentamiento GPU y contrato explícito `RACE_READY` antes del 3-2-1.
- Sets autorales para los cinco circuitos, con landmarks, hazards y arquitectura temática; materiales con UVs físicas y QA visual reproducible.

## Arranque

Requiere Node.js 22 o superior.

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

Servidor multijugador:

```bash
npm run dev:server
```

Health check: `http://localhost:2567/health`.

## Controles

| Acción | Teclado | Móvil |
| --- | --- | --- |
| Acelerar | W / ↑ | GAS / AUTO |
| Frenar o reversa | S / ↓ | FRENO |
| Girar | A/D / ←/→ | Flechas |
| Derrape | Espacio | DRIFT |
| Usar objeto | E | ITEM |
| Lanzar hacia atrás | S + E | FRENO + ITEM |
| Recuperar | R | Menú de pausa |
| Pausa | Esc | Menú del dispositivo |

## Verificación

```bash
npm run check
```

El comando ejecuta lint, comprobación de tipos, todas las suites y builds de los cinco workspaces.

## QA visual

Cada circuito se fotografía sin HUD desde ocho vistas fijas (salida, curva 1, landmark, mitad, atajo, momento hero, última curva, meta) a través del hook de depuración del runtime:

```bash
npm run dev
npm run qa:shots -- ink-print-factory PRINT_FACTORY output/visualqa/factory HIGH
```

El script necesita Playwright (`PLAYWRIGHT_MODULE` apunta a su `index.mjs` si no está instalado como dependencia) y deja las capturas y `stats.json` con coste y frame pacing en la carpeta indicada. `npm run qa:flow` cubre menú, briefing, loader real, HUD y pausa en un viewport configurable; `npm run qa:memory` reconstruye y destruye diez carreras para detectar retenciones. La dirección visual está en `docs/TRACK_VISUAL_DNA.md` y el presupuesto medido en `docs/TRACK_BUDGET.md`.

## Estructura

```text
apps/
  web/             Next.js + React + Babylon.js
  game-server/     Colyseus autoritativo + health endpoint
packages/
  game-core/       reglas, tipos, configuración y simulación compartida
  3d-factory/      schemas, generadores, presets, migraciones y registro
  character-core/  schema y reglas compartidas de personajes
docs/              arquitectura y guías del proyecto
```

## Despliegue

Vercel aloja el frontend estático. El servidor WebSocket Colyseus requiere infraestructura Node persistente y se configura mediante `NEXT_PUBLIC_GAME_SERVER_URL`; PostgreSQL, Redis y cualquier credencial permanecen exclusivamente en servidor.
