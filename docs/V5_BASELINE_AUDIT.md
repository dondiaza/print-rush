# PRINT RUSH — V5 BASELINE AUDIT

Fecha: 2026-09-01 · Commit base: `94539ff` (feat: ship Print Rush V4 race experience)

Método: lectura completa del repositorio (4.586 líneas de fuente), medición determinista de los
generadores de circuito, y conteo estático de geometría, materiales y features de render.

---

## 0. RESUMEN EJECUTIVO

El proyecto es un prototipo técnicamente limpio y funcionalmente completo (flujo de carrera
end-to-end, 13 items, 5 circuitos, avatar desde foto, PWA, servidor autoritativo). Su problema no
es que esté mal hecho: es que **está construido sobre tres decisiones de arquitectura que ponen un
techo duro a la calidad**, y ninguna de las tres se puede levantar parcheando.

| # | Techo estructural | Consecuencia observable | Veredicto |
|---|---|---|---|
| 1 | El circuito es una **elipse paramétrica 2D** (`cos/sin · radiusX/radiusZ` + 2 senos de ruido) | 311 m de longitud, **10,7 s por vuelta**, imposible tener cruces, túneles ni pisos | REESCRIBIR |
| 2 | El kart es un **modelo tanque sin velocidad lateral** (`pos += sin(rot)·speed`) | Cero inercia, cero slip angle, el "drift" es solo un contador con multiplicador de giro | REESCRIBIR |
| 3 | **Cero texturas y cero post-procesado** en todo el proyecto | Todo son primitivas de color plano bajo 2 luces; de ahí el aspecto de demo | REESCRIBIR |

Puntuación interna global de partida: **2,8 / 10** (detalle en §7).

---

## 1. VISUAL

### 1.1 Calidad actual

Medición estática sobre los cuatro constructores de geometría:

| Fichero | Box | Sphere | Cylinder | Capsule | Torus | Plane | Ribbon | Ground |
|---|---|---|---|---|---|---|---|---|
| `game/TrackBuilder.ts` | 15 | 1 | 2 | – | 2 | 1 | 1 | 1 |
| `game/createKart.ts` | 7 | 1 | 2 | – | – | 1 | – | – |
| `factory/GeneratedCharacter.ts` | 5 | 10 | – | 5 | 3 | 1 | – | – |
| `factory/GeneratedKart.ts` | 3 | 1 | 3 | 2 | – | 1 | – | – |

**El 100 % de la geometría del juego son primitivas de `MeshBuilder`.** No existe un solo mesh
diseñado, importado ni generado por extrusión/loft más allá del ribbon de la calzada. Ningún objeto
tiene bevel: todas las aristas son matemáticamente perfectas, así que no hay ningún borde sobre el
que la luz pueda reaccionar. Es la causa raíz directa del "aspecto de primitivas 3D de demo".

### 1.2 Iluminación

`GameRuntime.ts:161-172`. La escena entera tiene **dos luces**:

- `HemisphericLight` intensidad 0,7 (diffuse `#e3dcff`, ground `#372333`)
- `DirectionalLight` intensidad 2,7 (diffuse `#ffe5f4`), con `ShadowGenerator` de **1024 px**,
  `useBlurExponentialShadowMap`, kernel 14.

No hay fill, no hay rim, no hay luces prácticas, no hay emissive más allá de `createEmissiveMaterial`
(un `StandardMaterial` con specular negro). La iluminación es **uniforme en todo el circuito**: no
hay zonas, no hay transición tienda → pasillo → almacén → muelle. El escenario no tiene volumen
porque no hay nada que lo module.

### 1.3 Materiales

- `PBRMaterial` con `albedoColor` plano, `roughness` fija (0,66–0,98), `metallic` 0,04–0,06.
- `StandardMaterial` para todo lo emisivo y los carteles.
- **`environmentTexture` = ninguna.** Sin IBL, el `PBRMaterial` de Babylon no tiene nada que
  reflejar: metal, tela, cartón y suelo reaccionan a la luz prácticamente igual. La diferenciación
  de materiales que pide la V5 hoy es literalmente inobservable.

### 1.4 Texturas

```
Texturas de imagen en todo el proyecto ......... 0
DynamicTexture .................................. 1  (solo texto de carteles, createTextSign)
Normal maps ..................................... 0
Roughness / metallic maps ....................... 0
Atlas ........................................... 0
```

No hay tela, ni cartón, ni pintura, ni suelo. El suelo del circuito es exactamente lo que la V5
prohíbe: `PBRMaterial` con `albedoColor #15131a` sobre un ribbon.

### 1.5 Geometría

Kart del jugador: chasis (box) + morro (box) + parachoques (box) + asiento (box) + alerón (box) +
4 ruedas (cylinder de 12 lados) + plano de número. Conductor: cápsulas y esferas.

Una estantería de almacén hoy no existe como concepto: el decorado son 42 `venue-prop-N`, cajas de
tamaño aleatorio colocadas en un anillo elíptico (`TrackBuilder.ts:262-276`).

### 1.6 Animaciones

Tres, todas procedurales por código: rotación de rueda (`rotation.x += distance·0,035`), giro visual
del eje delantero (`rotation.y = steer·0,32`) y balanceo del kart (`rotation.z`). El conductor **no
tiene ninguna animación**: no parpadea, no mira a la curva, no gira el volante, no se inclina. No
hay esqueleto ni morph targets en runtime.

### 1.7 VFX

Pools fijos creados en el constructor: 42 esferas de 4 segmentos (`fx-N`) y 54 cajas de skid.
El humo son esferas emisivas con gravedad. No hay sistema de partículas de Babylon, no hay
soft particles, no hay trails, no hay decals reales (los skid marks son cajas flotantes a `y-0,68`).

### 1.8 UI

HUD en React re-renderizado a 16,6 Hz (`emitHud` con throttle de 60 ms → `setHud` → re-render del
árbol). Estética de panel web. Sin iconografía propia, sin animaciones de entrada/salida, sin
minimapa dibujado (solo barras de progreso).

### 1.9 Cámara

`FreeCamera` con lerp doble (`GameRuntime.ts:530-548`): posición `Lerp(…, 1-e^{-dt·6})`, target
`Lerp(…, 1-e^{-dt·8})`, FOV 0,88 → 1,02 en boost, y un shake por seno. **No hay look-ahead real**
(mira a `target + forward·(3+speedRatio·2)`, que es hacia donde apunta el kart, no hacia donde va la
pista), no hay compensación de drift, no hay colisión de cámara, no hay perfil móvil.

---

## 2. GAMEPLAY

Toda la conducción vive en `packages/game-core/src/simulation.ts` (88 líneas) y
`config.ts:VehicleConfig`.

| Parámetro | Valor | Lectura |
|---|---|---|
| `maxSpeed` | 29 m/s (104 km/h) | razonable |
| `boostedMaxSpeed` | 37 m/s (133 km/h) | razonable |
| `acceleration` | 21,5 m/s² | 0 → max en 1,35 s — muy nervioso |
| `brakingPower` | 28 m/s² | frenada más fuerte que la aceleración |
| `steeringLowSpeed` / `steeringHighSpeed` | 2,42 / 1,18 rad/s | curva de dirección **sí existe** y es correcta |
| `grip` / `driftGrip` | 8,5 / 2,6 | **declarados pero nunca leídos por el simulador** |
| `mass` | 82 | **nunca leído** |

### 2.1 El defecto central

```ts
state.position.x += Math.sin(state.rotation) * state.speed * dt;
state.position.z += Math.cos(state.rotation) * state.speed * dt;
```

El kart se mueve **exactamente hacia donde apunta**, siempre. No existe vector velocidad
independiente del vector heading, por lo tanto:

- no hay slip angle, no hay contravolante, no hay inercia, no hay transferencia de peso;
- `grip`, `driftGrip` y `mass` son constantes muertas;
- el drift **no desliza**: es un contador `driftCharge` que sube mientras mantienes espacio + giro,
  aplica `driftTurnMultiplier = 1,34` al giro y suelta boost al soltar. Visualmente se finge con
  `player.rotation.z = -steer·0,13`.

Esto es exactamente lo que la V5 describe como "conducción poco satisfactoria" y "drift que no
resulta divertido", y no es afinable: falta el término que hace que un kart racer se sienta bien.

### 2.2 Resto de sistemas de gameplay

- **Colisión con pared**: no existe. Salirse es un test de distancia al spline
  (`applyTrackSurface`): si `d > (halfWidth·0,9)²` te frena un 82 % de golpe, te empuja al centro y
  te mete camera shake. No hay deslizamiento contra pared, solo castigo.
- **Colisión kart-kart**: **no existe en absoluto.** Los bots se atraviesan.
- **Bots**: no son karts. Son nodos sobre raíl con un escalar `totalProgress`, velocidad
  17,2–18,3 m/s, `catchup` proporcional a la distancia al jugador y un seno de variación. No
  simulan, no derrapan, no chocan, no cogen items.
- **Salto**: `verticalSpeed = 7,2` fijo si pisas una rampa a más de 12 m/s, gravedad 17. Sin control
  aéreo, sin suspensión, sin control de aterrizaje. El landing boost sí existe (0,24 s si caes a más
  de 3,8 m/s).
- **Items**: 13 definidos, funcionan, con ruleta y balance por posición. El homing es un `Lerp` de
  velocidad y la detección de impacto un `DistanceSquared < 4`. Los bots disparan uno cada ~9 s
  desde un temporizador global, no por decisión.
- **Rapier**: `@dimforge/rapier3d` se carga (WASM completo) para crear **un suelo de 112×84 m y un
  cuerpo cinemático que solo copia la posición del kart**. No resuelve ninguna colisión. Es peso
  muerto puro en el bundle y en el arranque.

---

## 3. TRACKS

Medición exacta reproduciendo `generateTrack()` (240 muestras; curva significativa = cambio de rumbo
acumulado > 25° en el mismo sentido; recta = 10 o más muestras con menos de 1,2°/muestra):

| Circuito | Metros | Vuelta @29 m/s | Curvas | Rectas | Desnivel | Cambios elev. | Anchura |
|---|---|---|---|---|---|---|---|
| T-Shirt Store Grand Prix | **311** | **10,7 s** | **3** | 6 | 3,24 m | 6 | 11,2 m |
| Warehouse Mayhem | 326 | 11,2 s | 6 | 4 | 5,36 m | 6 | 10,4 m |
| Print Factory Panic | 319 | 11,0 s | 8 | 3 | 6,78 m | 6 | 10,8 m |
| Office Overdrive | 308 | 10,6 s | 4 | 5 | 4,42 m | 6 | 10,2 m |
| Manga Convention Madness | 330 | 11,4 s | 9 | 3 | 7,56 m | 6 | 11,5 m |
| **Objetivo V5** | **2.500–5.000** | **90–180 s** | **10–20** | **2–5** | — | **3–7** | — |

**Los circuitos son entre 8 y 16 veces más cortos que el objetivo.** Una vuelta dura 11 segundos.
`measureTrack` reporta `estimatedLapSeconds = length/21` ≈ 15 s, así que el propio editor ya sabía
que las vueltas eran de 15 segundos.

Además, por construcción de la fórmula:

- **Topología**: la spline es `r(θ)·(cos θ, sin θ)` con θ monótona → es una curva estrellada convexa.
  Es **geométricamente imposible** que se cruce consigo misma. No puede haber crossovers, ni pasar
  por debajo, ni pisos, ni túneles, ni verticalidad real.
- **Desnivel**: `y = sin(2θ)·elev·0,62 + sin(5θ)·elev·0,19`, máximo 7,5 m en el circuito más
  agresivo. Es ondulación, no verticalidad.
- **Sectores**: 5 por circuito, definidos como `floor(progress·5)` — cinco quintos iguales del
  recorrido. No responden a la geometría ni al espacio. La única diferencia entre sectores es el
  color del suelo y el `speedProfile`.
- **Landmarks**: 5, colocados en `(i+0,48)/5`. Son una caja + un cartel de texto + un cilindro.
- **Shortcuts**: 2, hardcodeados a `0,285 → 0,35` y `0,675 → 0,735` en todos los circuitos. Son 12
  losas rectas interpoladas entre dos puntos del spline.
- **Hazards**: 1 por sector, un torus de aviso + una caja que sube y baja.
- **Densidad visual**: 42 cajas en un anillo exterior + 5 landmarks. El interior de la elipse tiene
  un cilindro y un toro. Es, literalmente, un circuito vacío.

Los cinco circuitos son **el mismo circuito** con distinto `seed`, `radius` y paleta. No existe el
recorrido escaparate → entrada → expositores → escaleras → planta superior que pide la V5, ni puede
existir con este generador.

---

## 4. PERFORMANCE

No hay instrumentación en el proyecto: no existe contador de draw calls, ni de triángulos, ni de
frame time expuesto. `PerformanceManager.ts` (48 líneas) solo hace *device profiling* estático
(`deviceMemory`, `hardwareConcurrency`, `pointer: coarse`) y devuelve un `hardwareScalingLevel`.
El único control dinámico es `adjustQuality()` (`GameRuntime.ts:1008`), que sube o baja el hardware
scaling entre 1 y 2 según un frame time medio suavizado.

Conteo estático de la escena de carrera (circuito 0, desktop):

| Concepto | Cantidad | Nota |
|---|---|---|
| Meshes del circuito | ~160 | + 150 instancias (barreras y dashes, sí instanciados) |
| Meshes por kart | ~35 | × 4 karts = 140 |
| Pool de VFX | 42 esferas + 54 skids | siempre en escena, `isVisible = false` |
| Trails + escudo | 4 | |
| **Total aproximado** | **~400 meshes** | |
| Materiales únicos | ~90 | uno nuevo por prop, proyectil y skid; sin compartir |
| Texturas | ~10 | solo `DynamicTexture` de carteles, 1024×256 cada una |
| Shadow casters | todos los meshes de los 4 karts | ~140 casters en un mapa de 1024 |

El problema de rendimiento hoy **no es la carga**: es que no hay LOD, no hay culling configurado, no
hay merge de estáticos, no hay atlas, y cada material nuevo es un draw call nuevo. La escena es
barata porque está vacía. En cuanto se densifique como pide la V5, esta arquitectura de materiales
(uno por objeto) se convierte en el cuello de botella inmediato.

Cifras de FPS reales pendientes: se medirán con el Performance Lab instrumentado
(`/dev/performance`), que es entregable de la propia V5 (Parte XX). Sin él no hay número honesto que
reportar, y este documento no va a inventarlo.

---

## 5. MOBILE

- **Render scale**: `getHardwareScalingLevel(profile)` + ajuste dinámico 1,0–2,0.
- **Calidad**: `window.innerWidth < 800` → `quality: "MEDIUM"` para el jugador y `"LOW"` para bots;
  el decorado baja de 42 a 24 props. Es el único LOD del proyecto y es una decisión binaria por
  ancho de ventana tomada **una sola vez en el constructor**.
- **Touch**: cinco botones booleanos (`left`, `right`, `throttle`, `brake`, `drift`) enviados por
  `setTouchControl`. **No hay stick analógico**: girar es digital, `steer = ±1` interpolado a 0,2.
  No hay volante, no hay giroscopio, no hay háptica.
- **Orientación**: `requestFullscreen` + `orientation.lock("landscape")` al entrar en carrera.
- **HUD**: mismo layout que desktop, escalado por CSS.

Mobile es hoy una adaptación, no la plataforma principal que la V5 exige.

---

## 6. INFRAESTRUCTURA Y PERSISTENCIA

| Aspecto | Estado |
|---|---|
| Frontend | Next.js 16 `output: "export"` → estático en `apps/web/out` |
| Backend | **Ninguno desplegado.** `apps/game-server` (Colyseus) existe pero no tiene destino |
| Base de datos | **Ninguna.** `DATABASE_URL` y `REDIS_URL` están en `.env.example` como "reservado" |
| Object storage | **Ninguno** |
| Persistencia de avatares | `localStorage`, claves `print-rush.characters.v2` (máx. 40) |
| Fotos originales | **Nunca se guardan.** `originalRetained: false`; la foto se analiza en un worker y se descarta |

Esto es relevante para la Parte VIII de la V5: hoy los avatares **sí desaparecen** (se van con el
localStorage del navegador), y el requisito de "object storage privado, persistencia indefinida,
URLs firmadas, audit log" **no tiene ninguna pieza construida**. Es el único bloque de la V5 que
depende de infraestructura externa y credenciales.

Nota positiva de partida: el pipeline de foto actual ya es privacy-first por diseño (análisis 100 %
local en un Web Worker, sin subida, sin retención, sin reconocimiento biométrico). El schema
`CharacterDefinition` ya tiene el campo `photo` con `mode`, `strength` y `landmarkModel`.

---

## 7. COMPARADOR INTERNO DE CALIDAD — BASELINE

Escala 0–10. Puerta de calidad V5: ningún apartado por debajo de 7, global 8 o más.

| Apartado | Baseline | Justificación medida |
|---|---:|---|
| VISUAL DENSITY | 2 | 42 cajas en anillo + 5 landmarks; interior vacío |
| LIGHTING | 2 | 2 luces, sin zonas, sin IBL, sin post |
| MATERIAL QUALITY | 1 | 0 texturas, 0 normal maps; sin IBL los PBR no diferencian |
| TRACK COMPLEXITY | 1 | 311 m, 3 curvas, elipse convexa sin cruces posibles |
| TRACK READABILITY | 6 | lo único que salva: es tan simple que se lee sola |
| SPEED FEEL | 3 | FOV 0,88 → 1,02, sin objetos cercanos, sin líneas de velocidad |
| DRIFT FEEL | 2 | sin deslizamiento real; contador + multiplicador de giro |
| CAMERA | 3 | doble lerp, sin look-ahead real, sin colisión, sin perfil móvil |
| VFX | 3 | pools de esferas y cajas; sin sistema de partículas |
| AUDIO | 2 | 1 oscilador sawtooth + beeps cuadrados; sin música ni ambiente |
| CHARACTERS | 4 | schema excelente, render en cápsulas, sin animación |
| KARTS | 3 | 7 cajas y 4 cilindros de 12 lados |
| ENVIRONMENT | 2 | no hay entorno, hay un anillo de props |
| ITEM FEEDBACK | 5 | los 13 items funcionan; el feedback es un beep y esferas |
| FINISH EXPERIENCE | 4 | hay autopiloto, banner y podio; sin confeti, público ni cámara |
| MOBILE EXPERIENCE | 3 | steering digital, sin háptica, sin stick |
| **GLOBAL** | **2,8** | |

La cifra encaja con la percepción del brief ("un 10 % de la sensación buscada"). El comparador vive
en `docs/V5_QUALITY_GATE.md` y se re-puntúa al cierre de cada etapa.

---

## 8. DECISIÓN: CONSERVAR / REFACTORIZAR / REEMPLAZAR

### CONSERVAR

- Monorepo y separación `apps/` + `packages/` — correcta.
- `CharacterDefinition` / `KartDefinition` (`packages/3d-factory/src/types.ts`): schemas ricos,
  versionados, con `normalize`, `validate` y `migrate`. Es lo mejor del proyecto. Se conserva y se
  extiende; no se rompe la forma existente.
- `packages/game-core/src/race.ts` (progreso, checkpoints, ranking, wrong-way) e `items.ts`
  (13 definiciones + `pickWeightedItem` con balance por posición). Sólidos.
- `SeededRandom` y el enfoque procedural con semilla.
- Pipeline de foto privacy-first (worker local, sin retención, sin biometría).
- Colyseus + Next.js + Babylon.js como stack.
- CI y el gate `cerbero` antes de push y deploy.

### REFACTORIZAR

- `PerformanceManager`: de perfilado estático a presupuesto de calidad con niveles
  LOW / MEDIUM / HIGH / ULTRA y métricas en vivo.
- HUD: mismo contrato `HudState`, nueva presentación, y sacarlo del re-render por frame.
- `apps/game-server`: la sala y el estado sirven; hay que alinearlos con el nuevo modelo de vehículo.

### REEMPLAZAR / REESCRIBIR

| Sistema | Motivo |
|---|---|
| `simulation.ts` | falta el vector velocidad; el drift no puede existir sin él |
| `TrackFactory.ts` | la elipse paramétrica impide longitud, cruces y verticalidad |
| `TrackBuilder.ts` | construye primitivas; hace falta calzada extruida, bordillos, muros y props |
| Cámara (dentro de `GameRuntime`) | necesita ser un controlador propio con estados |
| Materiales | de color plano a librería con texturas procedurales + IBL + post |
| Audio | de 2 osciladores a un director con capas de motor, ambiente y música |
| VFX | de pools de esferas a sistema de partículas con presupuesto por calidad |
| Bots | de raíl a karts simulados con el mismo modelo que el jugador |

### ELIMINAR

- `@dimforge/rapier3d`. Sustituido por colisión analítica contra la geometría del circuito
  (cápsula contra muros del spline + karts como círculos), que es más rápida, determinista y
  sincronizable con el servidor autoritativo. Hoy carga un WASM completo y no resuelve ni una sola
  colisión.

---

## 9. ORDEN DE EJECUCIÓN

Se sigue el orden mandado en la Parte XXII. La regla que gobierna las dos primeras etapas:
**no se toca el apartado gráfico hasta que el kart sea divertido en un circuito gris.**

El progreso vivo está en `docs/V5_PROGRESS.md`.
