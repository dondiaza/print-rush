# PRINT RUSH V5 — PROGRESO

Actualizado: 2026-09-02

Baseline: `docs/V5_BASELINE_AUDIT.md` (global 2,8/10)
Normativa visual: `docs/ART_BIBLE_V5.md`
Puerta de calidad: `docs/V5_QUALITY_GATE.md` (actual 7,6/10)

Estado del build: `npm run check` **verde** — lint, typecheck, **124 tests** y build de los cuatro
workspaces, incluido el export estático.

---

## DONE

### ETAPA 1 — AUDITORÍA
- Auditoría completa con medición determinista, no estimación.
- Los cinco circuitos medidos: **308–330 m reales, 10,6–11,4 s por vuelta**, 3–9 curvas. Objetivo
  V5: 2.500–5.000 m y 90–180 s. Factor 8–16×.
- Verificado: **0 texturas de imagen** y **0 features de post-procesado** en todo el proyecto.
- Verificado: `grip`, `driftGrip` y `mass` declarados en `VehicleConfig` y **nunca leídos**.
- Verificado: Rapier cargaba un WASM completo sin resolver ninguna colisión.
- Verificado: la spline `r(θ)·(cos θ, sin θ)` con θ monótona **no puede cruzarse consigo misma**, así
  que los cruces, túneles y pisos eran geométricamente imposibles.
- Escritos `V5_BASELINE_AUDIT.md`, `ART_BIBLE_V5.md` y `V5_QUALITY_GATE.md`.

### ETAPA 2 — CONDUCCIÓN + CÁMARA · puerta superada
- **`packages/game-core/src/vehicle.ts`** — modelo reescrito con vector velocidad en espacio mundo
  independiente del rumbo. El derrape es ahora una consecuencia del modelo, no un caso especial:
  ~8° de slip en curva de apoyo, ~24° derrapando, tope duro a 40° para que un error no sea un trompo.
- **Drift completo**: hop de entrada, ángulo sostenido por sí solo, modulación con el volante
  (girar hacia dentro cierra la trazada, hacia fuera la abre), bail-out por contravolante, 3 tiers
  de carga con boost al soltar, y scrub de velocidad para que la carga sea un trade real.
- **`collision.ts`** — muro con deslizamiento y pérdida proporcional al ángulo de impacto; contacto
  kart-kart con impulso circular. Ambos analíticos y deterministas, iguales en cliente y servidor.
- **Rapier eliminado** del `package.json`.
- **`apps/web/render/RaceCameraV5.ts`** — cámara por estados: FOV asimétrico 62°→78°→86°, boom
  8,4→11,2 m, offset de drift hacia el exterior, punch de boost, shake de impacto, dip de aterrizaje,
  look-ahead sobre la trazada y no sobre el morro, suelo, y perfil móvil propio.
- **`apps/web/game/InputControllerV5.ts`** — steering analógico real con curva expo y zona muerta
  rescalada, para gamepad, stick táctil y giroscopio; bindings remapeables.
- **`/dev/handling`** — laboratorio en circuito gris con telemetría en vivo a 20 Hz escrita por refs
  al DOM, sin re-render de React.
- Simulación a **120 Hz** (antes 60).

### ETAPA 2b — SISTEMA DE CIRCUITOS (dependencia de la etapa 2)
- **`blueprint.ts`** — baker de blueprints: Catmull-Rom cerrada, resampleo por longitud de arco a
  2,5 m, atributos heredados hacia delante, deduplicación de puntos coincidentes.
- **`path.ts`** — autoría tipo turtle: `straight`, `turn`, `chicane`, `hairpin`, `spiral`, `driveTo`.
- **`dubins.ts`** — uniones Dubins (RSR/LSL/RSL/LSR) para que `driveTo` y el cierre del circuito
  lleguen a una pose exacta con arcos y rectas reales. El primer intento de circuito gris cerraba a
  717 m y 20° de su propia meta; ahora cierra a 0.
- **`track.ts`** — sampler con ventana alrededor del último nodo y desambiguación por altura, que es
  lo que permite que un puente no capture al kart que pasa por debajo.
- **Analizador y validador**: longitud, vuelta estimada, curvas, hairpins, rectas, desnivel, cambios
  de elevación, anchura media, **cruces a distinta altura**, sectores, landmarks, atajos y set-pieces.
  Los umbrales del brief son asserts en los tests.
- **Los seis circuitos pasan con cero avisos** (tabla en `V5_QUALITY_GATE.md`).

### ETAPA 3 — PIPELINE GRÁFICO
- **`MaterialLibrary.ts`** — 15 clases del art bible con albedo y normal **procedurales** generados
  en canvas al arranque: trama de tejido, fibra de cartón, rayado direccional de metal, veta de
  madera, baldosa con junta y variación por celda, tinta con pooling, hormigón con manchas de baja
  frecuencia. Normal derivado por Sobel. Cacheado por clase+color+tiling para respetar el
  presupuesto de 40 materiales; la variación va por instancia.
- **`LightingRig.ts`** — key + fill + bounce + rim, **zonas de iluminación** interpoladas por
  progreso de vuelta (5–7 por tema, con las de Megastore como ejemplo normativo), sombras PCF a
  2048, ACES con exposición por zona, bloom con umbral 0,86 y kernel corto, SSAO2 por calidad, grain
  bajo, y énfasis de boost por aberración y viñeta.
- **`RoadMesh.ts`** — calzada y muros como vertex data explícito con peralte real y UV por distancia
  recorrida; los muros se abren donde hay atajo o cornisa.
- **`TrackBuilder.ts`** — reescrito: bordillos solo en el interior de curvas reales, línea de trazada
  pintada, props colocados **por distancia de vuelta** con variación por semilla, estanterías, palets
  y máquinas como geometría diseñada y fusionada, landmarks a escala hero, y casters de sombra
  seleccionados en lugar de todos.
- **`VFXSystem.ts`** — `ParticleSystem` reales con sprite suave generado: humo por rueda con color
  por tier de carga, tinta en superficie `INK`, llama de boost, polvo de suelo, y decals de derrape
  con fade de 6 s. Presupuestos por calidad que recortan cantidad, nunca qué efectos existen.
- **`AudioDirector.ts`** — motor en tres capas con cross-fade por carga, viento sobre el 60 % de
  velocidad, scrub de derrape, ambiente por tema, e impactos con timbre distinto según cartón,
  metal, madera o kart.
- **`BotDriver.ts`** — los rivales son karts simulados con el mismo `simulateKart`. Leen la curvatura
  de los 90 m siguientes con un intervalo de reacción por habilidad, calculan velocidad de paso con
  la misma relación que usa la física, derrapan cuando la curva lo justifica, y el rubber banding
  toca su velocidad objetivo, nunca la física.
- **`GameRuntime.ts`** — reconstruido sobre lo anterior.
- **Circuit Factory V5** (`/factory/track`) — el editor ya no expone parámetros de elipse; muestra
  metros, vuelta estimada, curvas, rectas, desnivel y cruces, con mapa cenital donde el grosor de
  trazo codifica la altura, y valida contra la puerta antes de dejar usar la pista.
- **Servidor** alineado: mismo blueprint, mismo sampler, misma resolución de suelo y muro; el estado
  replicado incorpora el vector velocidad y el estado de derrape, sin los cuales un kart remoto se
  dibujaría siempre apuntando a donde viaja.

### ETAPA 3b — GEOMETRÍA Y MATERIALES REALES
Petición explícita: *"no deben ser bloques sino figuras con texturas y renderizados"*.

- **`render/Geometry.ts`** — toolkit de modelado sobre una única operación, `loft`, que cose anillos
  cerrados en una superficie. De ahí salen `beveledBox` (bisel obligatorio del art bible),
  `revolve` (ruedas, tambores, tazas), `tube` (barridos: guardabarros, escapes, barandillas),
  `ellipsoid`, `lofted` (carrocerías por estaciones) y `mergeParts` (fusión multi-material).
- **`render/EnvironmentProbe.ts`** — **IBL procedural**. Es la corrección de mayor impacto de toda la
  auditoría: ningún material V4 tenía `environmentTexture`, y un shader PBR sin nada que reflejar no
  puede distinguir metal de plástico de tela. Se pintan las 6 caras del cubemap desde la paleta del
  tema: cielo, suelo, línea de horizonte, blob del key y prácticas.
- **`render/KartBuilder.ts`** — kart modelado: monocasco loftado que se estrecha, pontones,
  4 guardabarros barridos, paragolpes tubulares delantero y trasero, arco de seguridad, asiento con
  respaldo, **volante que gira**, motor con culata revolucionada, escape cónico, alerón con derivas,
  faros y ruedas de neumático revolucionado con hombros redondeados + llanta con radios. Pintura con
  clearcoat controlado. Suspensión que se comprime al aterrizar.
- **`render/CharacterBuilder.ts`** — conductor modelado: torso loftado con hombros reales,
  extremidades barridas con codo y rodilla, cabeza con ceja, pómulos, mentón, nariz y orejas,
  **ojos con párpado que parpadea**, pelo por volúmenes solapados en vez de un casquete, manos que
  agarran el volante. Y las cinco animaciones baratas del art bible, movidas por el estado real del
  vehículo: parpadeo, cabeza girando hacia la curva, brazos siguiendo el volante, inclinación del
  torso con el deslizamiento, y respingo al recibir un impacto.
- **`render/PropLibrary.ts`** — 11 tipos de prop modelados. La caja de cartón tiene solapas, cinta y
  etiqueta torcida; la estantería tiene montantes tubulares, diagonales, cuatro bandejas con carga y
  tira de etiquetas; el perchero tiene perchas con camisetas loftadas; el espectador tiene cabeza,
  hombros, brazos y piernas.
- **`render/HeroAssets.ts`** — 10 landmarks hero con silueta propia: pared de camisetas, caja
  registradora gigante, robot logístico con brazo articulado, torre de palets, carrusel de
  serigrafía con seis estaciones y sus tintas, batería de bidones, monitor gigante con teclado,
  cafetera, escenario con truss y altavoces, y batería de arcades.
- **Features del circuito rehechas**: bordillos biselados, plataformas de boost con chevrones
  direccionales, rampas como cuña real con raíles, cajas de item como cajón con marco y núcleo
  luminoso, hazards colgados de una cadena sobre un anillo de aviso pintado, meta a cuadros con
  pórtico trussado y **cinco semáforos que se encienden con la cuenta atrás**.
- **28 tests nuevos con `NullEngine`** que verifican lo que no se puede ver: posiciones finitas,
  normales unitarias, índices en rango, dimensiones correctas, y presupuestos de triángulos y draw
  calls. Encontraron tres defectos reales — un blink que habría saltado al origen de la cabeza tras
  la fusión, 150 draw calls en la parrilla, y un nivel LOW que costaba lo mismo que HIGH.

### ETAPA 3c — TECHO DE HABILIDAD, ITEMS REALES Y DEDUPLICACIÓN
Auditoría contra el master prompt V2: lo que pedía y el código no hacía.

- **`game-core/src/drift.ts` — sistema de encadenado (mejora 2.4).** Tres ventanas de ejecución se
  abren durante un derrape largo. Un toque dentro es `PERFECT` y banca `boostReserve`; cerca es
  `GOOD`; lejos es `MISS` y cuesta carga. El problema de input —"pulsar drift otra vez" no significa
  nada si el botón ya está pulsado— se resuelve con una gracia de 0,19 s: soltar menos de eso es un
  toque, no una salida. La reserva se convierte en boost al soltar, se multiplica por la cadena, y
  **se drena sola** fuera del derrape, así que hay que mantenerla viva. Nada de esto es obligatorio:
  quien solo mantiene el botón sigue teniendo mini-turbo, el más pequeño.
- **Tricks (mejora 2.5).** Un toque justo tras despegar arma un truco; aterrizarlo con aire real
  paga boost y suma al del aterrizaje limpio. Un salto de bordillo no cualifica.
- **Colisiones diferenciadas + `impactCooldown` (mejora 1.4).** `SCRAPE`, `FRONTAL`, `REAR` y
  `HEAVY`, cada una con su peso de cámara, sonido y partícula. El cooldown es lo que impide que
  rozar un muro dispare la respuesta completa 120 veces por segundo — el "25 impactos consecutivos"
  que el brief nombra explícitamente. Un impacto fuerte además rebota, porque sin rebote el kart se
  queda clavado contra el muro sin salida.
- **Cabeceo y sensación de masa (mejora 1.5).** El morro baja al frenar y sube al acelerar, derivado
  de la aceleración longitudinal real.
- **Tabla de superficies del brief.** ASPHALT 1,0 · pulido 0,90 · almacén 0,85 · WET 0,65 · GRASS
  0,45 · SAND 0,40 · INK/aceite 0,35, más CONVEYOR y OFFROAD.
- **`ItemManager` con proyectiles reales (área 6).** Esto era una **regresión**: `activateItem`
  aplicaba daño instantáneo al rival más cercano, sin proyectil en el mundo. Eso es exactamente
  "powers que solo tengan icono" de la lista de NO HACER, y no tenía contrajuego posible. Ahora todo
  lo que se dispara es un objeto con posición y velocidad, agrupado en pools: se puede esquivar
  porque tarda en llegar, el escudo lo consume porque hay algo que consumir, y una trampa se ve en
  el suelo. El homing gira despacio a propósito — un disparo que se pega al objetivo no se puede
  esquivar, y eso es la "muerte inevitable" que el brief prohíbe.
- **Progreso de carrera unificado (mejora 8.3).** Había **dos** sistemas de progreso en paralelo:
  `advanceRaceProgress` (con puertas de checkpoint) para el orden del HUD, y un `lapsCompleted`
  propio del runtime que se incrementaba en cualquier vuelta del spline para el balance de items y
  el rubber band. Podían discrepar, y el segundo **daba vuelta a quien cortara el circuito**. Ahora
  hay una sola función, `raceProgress()`, en `game-core`.
- **Modo debug (F3).** FPS, velocidad, slip, superficie, estado de derrape, ventana abierta, última
  nota, reserva, cadena, posición, sector y raceProgress. Escrito al DOM a 10 Hz, nunca visible para
  un jugador normal.
- **Resultados con estadísticas de habilidad**: turbos, drifts perfectos y velocidad máxima.
- **36 tests nuevos** (91 en total). Encontraron un doble disparo del sonido de boost y del contador
  de turbos, y documentaron un comportamiento que resultó ser bueno: contravolantear con el botón
  pulsado **invierte** el derrape en el mismo frame, que es justo la transición que necesita una
  S enlazada.

### ETAPA 4-8 — LOS CINCO CIRCUITOS, AUTORADOS
Sustituyen a los generados. El generador daba cinco circuitos del tamaño correcto pero era **una
plantilla con cinco semillas y cinco paletas**, que es exactamente el reskin que el brief prohíbe.
`themed.ts` se conserva, pero ahora es la herramienta del Circuit Factory, no el origen del
contenido.

| Circuito | m | Vuelta | Curvas | Ancho | Identidad mecánica |
|---|---:|---:|---:|---|---|
| T-Shirt Megastore | 2.533 | 106 s | 12 | 10–14 m | SLALOM: el más estrecho, dos plantas |
| Warehouse Express | 2.520 | 105 s | 12 | 13–19 m | SPEED: el más ancho, cintas que empujan |
| Ink & Print Factory | 2.539 | 106 s | 11 | 12,5–15 m | ENVIRONMENT: tinta a 0,35 de agarre, 4 hazards |
| Office Chaos | 3.664 | 153 s | 15 | 10,5–13 m | TECHNICAL: más curvas, moqueta, cruce sobre recepción |
| Manga Mega Con | 2.763 | 115 s | 10 | 14–20 m | SPECTACLE: 3 saltos, 23 m de desnivel, 3 tipos de atajo |

- Cada circuito sigue la ruta que pide el brief y declara su `character` en el blueprint.
- **Atajos por categoría** (ITEM / SKILL / RISK) según la mejora 4.4. Ningún circuito tiene todos
  sus atajos del mismo tipo; Manga tiene los tres.
- La puerta de calidad ahora también exige saltos, hazards y **dos categorías de atajo**, y los
  tests comparan los circuitos **entre sí**: el de slalom tiene que ser realmente el más estrecho,
  el de velocidad el más ancho, la tinta solo puede estar en la fábrica. Un reskin no puede pasar
  esas aserciones.

### ETAPA 5 (IA) — PERSONALIDADES Y RECUPERACIÓN
- Cinco personalidades reales: CAUTIOUS, BALANCED, AGGRESSIVE, TECHNICAL, CHAOTIC, con dials
  independientes de nivel: apetito de derrape, agresividad, apetito de atajo y **jitter** de
  dirección. Medido a 60 s: CAUTIOUS 0 % de derrape y 0 % fuera de pista, AGGRESSIVE 8 %,
  CHAOTIC el único que se sale.
- **Recuperación**: primero física (marcha atrás girando hacia la trazada), y solo si falla durante
  más de dos segundos, respawn. Detección por metros avanzados en una ventana de un segundo.
- Los tests encontraron **cinco bugs reales** en la IA, todos invisibles sin medir:
  1. Un bot parado en la parrilla se clasificaba como atascado y **daba marcha atrás desde la
     salida**, porque el detector no tenía periodo de gracia.
  2. El umbral de progreso era `1e-4` de vuelta, **más de lo que avanza un paso a 27 m/s**, así que
     los bots se declaraban atascados a toda velocidad.
  3. La estimación de velocidad de paso fijaba toda la ventana de 90 m a la curva más cerrada, lo
     que clavaba a los bots en el suelo de 11 m/s — por debajo del mínimo de derrape, así que
     **ningún bot derrapaba nunca**.
  4. El barrido empezaba 7,5 m delante, así que la curva en la que el bot ya estaba siempre tenía
     margen de frenada y nunca contaba como cerrada.
  5. La curvatura se dividía por 10 m cuando los dos arcos muestreados están a 5 m, lo que
     **duplicaba todas las velocidades de paso**.
- Además: la banda de ritmo era del 5 % y el límite del vehículo la aplanaba, así que CAUTIOUS y
  TECHNICAL recorrían la misma distancia con siete cifras de precisión. Ahora es del 36 %.

### ETAPA 13 y 17 — MÚSICA ADAPTATIVA Y META
- **Música por capas** sintetizada: bajo, arpegio y lead sobre un transporte común, con tonalidad,
  modo y tempo propios por tema. La última vuelta **no cambia de tema**: sube el tempo un 14 % y
  desmutea el lead sobre el mismo transporte, así que el cambio cae a tiempo.
- Stings de victoria y derrota distinguibles antes de leer la pantalla.
- **Secuencia de meta**: el kart sigue rodando en autopilot, la cámara pasa a una órbita lenta y
  alta reutilizando el mismo suavizado que la cámara de persecución (así el relevo es continuo, no
  un corte), y la música resuelve. Nada de esto toca la simulación.

---

### ETAPA 3d — ASSETS HORNEADOS E INTEGRADOS

Los cubos y los colores planos se sustituyen por ficheros de imagen reales. 121 PNG en
`apps/web/public/assets`, 10,0 MB en total, con manifiesto generado desde el disco.

**Lo horneado** — 29 materiales × 3 mapas (base color, normal, roughness), 21 decals RGBA en 7
familias, 7 liveries de kart, 6 panoramas de circuito.

**Lo integrado** — 91 de los 121 ficheros son alcanzables desde código, medido por
`tools/assetgen/audit.mjs` leyendo el fuente:

- `AssetCatalog` lee el manifiesto y precarga con **progreso medido**, no simulado;
- `MaterialLibrary` toma normal y roughness del horno para todas las clases, y el base color donde
  un tema lo nombra; el generador procedural queda como fallback real y comprobado;
- `BackdropDome` pone el panorama del circuito detrás de la pista — antes era un color plano;
- `DecalScatter` proyecta tinta, suciedad y marcas de neumático sobre la calzada;
- `KartBuilder` acepta livery; `LiveryId` tiene 8 valores y un control en el garaje que se ve en la
  vista previa.

**Costuras de los panoramas, resueltas.** Cuatro de los seis fondos tenían una costura vertical real
en el punto de cierre: 9 a 17 de diferencia media frente a un percentil 97 interior de 3 a 8. La
causa no era el ruido —que ya era periódico— sino que **todas** las características periódicas
(cerchas, bahías de estanterías, juntas de máquina, escalones de silueta) tenían su borde de celda
exactamente en u = 0, de modo que la columna de cierre era la única de la imagen donde cambiaban
todas a la vez. El helper `cell()` desplaza la fase de cada una: medido después, 0,00.

**Honestidad del manifiesto.** Escribía `status: "integrated"` en las 121 entradas mientras el juego
dibujaba todo procedimentalmente. Ahora escribe `status: "baked"` y la accesibilidad se deriva
aparte leyendo el fuente real.

### ETAPA 3e — TODO APLICADO

133 ficheros, **133 alcanzables desde código**. Lo que hizo falta:

- **Tela estampada, horneada.** Cuatro diseños —rayo, onda, semitono y salpicadura— sobre el tejido
  de punto: los expositores de camisetas del Megastore, las camisetas recién impresas del taller y
  el puesto de merchandising del hall. El estampado no toca el borde del tile, así que la costura es
  cloth contra cloth por construcción; y no aporta relieve, porque la tinta plastisol curada está a
  ras y un gradiente duro en el borde del dibujo arruinaría el normal map.
- **`materialClass` de los props deja de ser configuración muerta.** Los constructores usaban una
  clase fija e ignoraban la del tema. Ahora distinguen masa principal de guarnición
  (`ART_DIRECTION.md` §11).
- **Presupuesto medido de verdad.** El manifiesto tenía un solo campo de alcance, así que sumaba las
  siete liveries y los veintiún decals como "compartido": 5,64 MB que nadie descarga. Con tres
  niveles (`always` / `track` / `kart`) el objetivo declarado se cumple y se verifica: 3,47 MB
  compartidos (< 4), ≤ 1,90 MB por circuito (< 3), peor carrera 6,31 MB.
- **Cinco valores por defecto apuntaban a otro circuito.** `BAKED_DEFAULT` nombraba
  `mat_paintedmetal_press`, `mat_plastic_pallet`, `mat_wood_desk`, `mat_ink_violet` y
  `mat_floortile_store` como defecto de su clase — assets de un circuito concreto, que en los demás
  no se descargan nunca. Puestos a `null`, con la razón escrita, y un test impide que un tema nombre
  un asset de otro circuito.
- **La parrilla lleva sus liveries.** Antes sólo se precargaba la del jugador, así que los tres
  rivales iban casi siempre en pintura plana. Cuatro wraps son menos de un megabyte.
- **Carpet donde se conduce, baldosa en las columnas** (Megastore y Oficina), y tarima de madera en
  las estructuras del hall manga: las tres superficies que quedaban sin fichero.

**Tests** — 299 en `apps/web`, 386 en total. Nuevos: que el estampado existe de verdad (rango por
canal 164–236 frente a 61 de la tela lisa), que ningún tema nombra un asset de otro circuito, que
cada prop que un tema esparce resuelve a una fuente que existirá, y que el presupuesto declarado se
cumple por niveles.

**Tests** — 266 en `apps/web` (antes 249): costuras contra un control interior, alfa de borde,
rango por canal, validez de los normal maps, correspondencia manifiesto↔disco en ambos sentidos,
y —nuevo— que cada id que el código puede nombrar existe en el manifiesto, y que el fallback
procedural produce materiales completos con cero texturas residentes.

---

## IN PROGRESS

### ETAPA 4 — T-SHIRT MEGASTORE (GOLD STANDARD)
El circuito existe hoy como **generado** desde el blueprint temático: 2.564 m, 107 s, 14 curvas,
4 cruces, cero avisos. Lo que falta es que sea **autorado** siguiendo la ruta del brief
(escaparate → entrada → expositores → escaleras → planta superior → probadores → almacén interno →
zona cajas → salto sobre tienda → meta) y que reciba sus hero assets.

- [ ] Blueprint autorado con la ruta del brief
- [ ] 3 hero assets (pared de camisetas, escalera central, caja registradora gigante)
- [x] Capas de suelo con material horneado (`mat_floortile_store`, `mat_wood_store`) y decals de
      suelo proyectados (marcas, suciedad, pegatinas)
- [x] Diseños estampados sobre las camisetas de los expositores (4 motivos horneados)
- [ ] IBL propio y ajuste de las 7 zonas de luz sobre el circuito final
- [ ] Bucle de revisión visual: 10 capturas por vuelta, corregir, repetir

---

## NEXT

| Etapa | Contenido |
|---|---|
| 5-8 | Warehouse, Print Factory, Office, Manga autorados con el pipeline del gold standard |
| 9 | Avatar Photo System — ver BLOCKED |
| 10 | Kart visuals (hoy sin tocar, 3/10) |
| 11 | Items end-to-end |
| 12 | VFX premium |
| 13 | Audio |
| 14 | HUD |
| 15 | Mobile polish |
| 16 | Multiplayer polish |
| 17 | Finish / podium |
| 18 | Performance lab `/dev/performance` y presupuestos |
| 19 | QA |
| 20 | Pase final de calidad |

---

## BLOCKED

### ETAPA 9 — Persistencia de avatares (infraestructura y credenciales)

La Parte VIII exige base de datos, object storage **privado**, URLs firmadas temporales y audit log.
El proyecto es un **export estático sin backend** (`output: "export"` → `apps/web/out`), sin base de
datos y sin almacenamiento. Esto no se resuelve por código: es decisión de infraestructura y
credenciales, una de las excepciones explícitas del propio brief.

Lo que se hará en la etapa 9 sin desbloquear nada:
- Pipeline de cara, morph targets sobre malla base, editor de avatar y slider CARTOON ↔ LIKENESS.
- Entidad `EmployeeAvatar` completa con consentimiento, versionado y stripping de EXIF/GPS.
- Interfaz `AvatarStore` con dos implementaciones: `LocalAvatarStore` (IndexedDB, funciona hoy) y
  `RemoteAvatarStore` (contra la API, lista para enchufar).

Queda bloqueado el despliegue del backend, el bucket privado y las URLs firmadas.

### TEST FINAL DE 4 JUGADORES (PC + portátil + iPhone + Android)

Requiere dispositivos físicos y un servidor Colyseus desplegado. El servidor existe en
`apps/game-server` y está alineado con el modelo V5, pero no tiene destino: Vercel no aloja
WebSockets persistentes y las reglas del equipo dejan Coolify fuera de lo que se monta desde aquí.
Decisión de infraestructura pendiente.

---

## VERIFICACIÓN NO REALIZADA

Honestidad sobre el alcance de lo comprobado:

- **Verificado**: lint, typecheck, 124 tests, build de los cuatro workspaces, export estático, y que
  el servidor de desarrollo sirve `/`, `/dev/handling`, `/factory/track`, `/garage/kart` y
  `/garage/character` con 200 y sin errores en consola.
- **Verificado sin navegador**: la geometría se valida headless con `NullEngine` — posiciones
  finitas, normales unitarias, índices en rango, dimensiones dentro de tolerancia — y los
  presupuestos de triángulos y draw calls se **miden**, no se estiman: kart 9.252 tri / 14 draws,
  conductor 5.272 tri / 17 draws, parrilla completa 50.656 tri / 124 draws.
- **No verificado**: cómo se ve. No hay navegador en el entorno, así que no hay capturas ni FPS
  medidos. Las notas de VISUAL DENSITY, LIGHTING, VFX y SPEED FEEL son juicios sobre el código
  contra la normativa del art bible, no sobre frames observados.
- **No medido**: rendimiento en móvil real. El Performance Lab (`/dev/performance`, Parte XX) es
  entregable de la etapa 18 y no existe todavía; hasta entonces no hay cifra honesta de FPS que
  reportar y este documento no la inventa.
