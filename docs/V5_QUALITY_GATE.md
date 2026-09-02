# PRINT RUSH V5 — PUERTA DE CALIDAD

Comparador interno inspirado en el nivel de acabado del género, sin copiar contenido de ningún
juego. Se re-puntúa al cierre de cada etapa.

**Regla de cierre:** la V5 no se da por terminada con ningún apartado por debajo de **7/10**.
Objetivo global: **8/10 o superior**. La puntuación es una puerta, no un sustituto del playtesting.

---

## PUNTUACIÓN

| Apartado | Baseline V4 | Actual | Objetivo | Evidencia del cambio |
|---|---:|---:|---:|---|
| VISUAL DENSITY | 2 | **8** | 8 | Props por distancia de vuelta (uno cada 11 m por lado) con variación por semilla; 11 tipos modelados; antes 42 cajas en un anillo exterior |
| LIGHTING | 2 | **8** | 8 | Key + fill + bounce + rim, 5-7 zonas interpoladas por vuelta, sombras PCF 2048, ACES, bloom umbral 0,86, SSAO2, **y ahora IBL procedural** |
| MATERIAL QUALITY | 1 | **8** | 8 | 15 clases con albedo y normal procedurales + **environment cubemap enlazado**: sin él el término especular no tenía fuente y las 15 clases eran indistinguibles |
| TRACK COMPLEXITY | 1 | **8** | 8 | 2.564–3.251 m (antes 308–330), 14–18 curvas (antes 3–9), 2–4 cruces a distinta altura (antes imposibles) |
| TRACK READABILITY | 6 | **8** | 8 | Bordillos biselados solo en interior de curva, línea de trazada pintada, meta a cuadros con pórtico y 5 semáforos, chevrones direccionales en los boost |
| SPEED FEEL | 3 | **7** | 8 | FOV 62°→78°→86° asimétrico, boom 8,4→11,2 m, look-ahead sobre la trazada, capa de viento, props cercanos garantizados |
| DRIFT FEEL | 2 | **9** | 8 | Vector velocidad real (~8° apoyando, ~24° derrapando), modulable, 3 tiers, **y encadenado con ventanas PERFECT/GOOD/MISS + reserva que se drena**. Dos jugadores en la misma curva ya no obtienen lo mismo |
| CAMERA | 3 | **8** | 8 | `RaceCameraV5` por estados: velocidad, drift, boost, impacto, aterrizaje, look-ahead, suelo, perfil móvil |
| VFX | 3 | **6** | 8 | `ParticleSystem` reales con sprite suave, humo por rueda con color por tier, decals de derrape con fade de 6 s |
| AUDIO | 2 | **8** | 8 | Motor en 3 capas, viento, scrub, ambiente por tema, impactos por superficie **y música adaptativa por capas con tonalidad propia y última vuelta a +14 % de tempo sobre el mismo transporte** |
| CHARACTERS | 4 | **7** | 7 | Torso con hombros reales, extremidades barridas con codo, cara con ceja, pómulos, mentón y **párpados que parpadean**, manos al volante, LOD real |
| KARTS | 3 | **8** | 8 | Monocasco loftado, pontones, 4 guardabarros, paragolpes tubulares, arco de seguridad, motor con culata, escape, volante que gira, ruedas revolucionadas con llanta y radios |
| ENVIRONMENT | 2 | **8** | 8 | 10 hero assets con silueta propia; antes **el mismo cubo de 7×13×7 con una banda** para todos los landmarks de todos los circuitos |
| ITEM FEEDBACK | 5 | **7** | 8 | **Proyectiles reales con pool**: esquivables, bloqueables por escudo, trampas visibles en el suelo. Antes el daño era instantáneo sin proyectil |
| FINISH EXPERIENCE | 4 | **7** | 8 | Autopilot + **órbita cinematográfica continua** + sting de resultado + estadísticas de habilidad. Pendiente el podio con los tres karts |
| MOBILE EXPERIENCE | 3 | **6** | 8 | Stick analógico con curva y zona muerta, perfil de cámara propio, giroscopio, LOD real por tier |
| **GLOBAL** | **2,8** | **7,6** | **8,0** | |

---

## MEDICIONES DURAS

### Circuitos

| Circuito | Metros | Vuelta est. | Curvas | Rectas | Desnivel | Cambios | Cruces | Avisos |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| T-Shirt Megastore | 2.564 | 107 s | 14 | 8 | 22,9 m | 3 | 4 | 0 |
| Warehouse Express | 3.103 | 129 s | 18 | 10 | 24,9 m | 3 | 2 | 0 |
| Ink & Print Factory | 2.760 | 115 s | 17 | 10 | 26,1 m | 3 | 4 | 0 |
| Office Chaos | 2.589 | 108 s | 15 | 7 | 18,6 m | 3 | 2 | 0 |
| Manga Mega Con | 3.251 | 135 s | 14 | 10 | 25,4 m | 3 | 2 | 0 |
| Handling Lab (gris) | 3.522 | 147 s | 17 | 9 | 21,8 m | 3 | 5 | 0 |
| **Baseline V4** | **308–330** | **11 s** | **3–9** | **3–6** | **3,2–7,6 m** | **6** | **0** | — |

Factor de mejora en longitud: **8,3× a 10,5×**. En tiempo de vuelta: **9,7× a 12,3×**.

### Geometría — medida con `NullEngine`, no estimada

`apps/web/tests/budget.test.ts` imprime estas cifras en cada ejecución y falla si se superan.

| Asset | V4 | V5 LOW | V5 MEDIUM | V5 HIGH | Draw calls | Meshes |
|---|---|---:|---:|---:|---:|---:|
| Kart | 7 cajas + 4 cilindros de 12 lados | 6.648 | 7.940 | **9.252** | 14 | 10 |
| Conductor | 10 esferas + 5 cápsulas + 5 cajas + 3 toros | 3.134 | 4.104 | **5.272** | 15–17 | 15–17 |
| **Parrilla completa** (4 karts + 4 conductores) | — | — | — | **50.656 tri** | **124** | — |

Tope del art bible para asset hero: 12.000 triángulos. Ambos entran con margen.

La primera versión costaba **150 draw calls** en la parrilla. El test de presupuesto lo detectó y se
corrigieron tres causas reales: el buje de rueda tenía material propio (tercer submesh en cada una de
las 16 ruedas), manos y pulgares eran meshes separados, y los dos párpados eran dos draws cuando
siempre parpadean juntos. Además el nivel LOW costaba **exactamente los mismos 18 draw calls** que
HIGH, lo que hacía inútil el tier justo donde importa: ahora baja a 15 al retirar párpados e iris
como grupos propios.

### Modelo de vehículo

| Propiedad | V4 | V5 |
|---|---|---|
| Vector velocidad independiente del rumbo | no existe | sí |
| Slip angle en curva de apoyo | 0° por construcción | ~8° |
| Slip angle derrapando | 0° por construcción | ~24°, tope 40° |
| Constantes declaradas y no usadas | `grip`, `driftGrip`, `mass` | ninguna |
| Colisión con muro | test de distancia + frenazo del 82 % | deslizamiento con pérdida por ángulo |
| Colisión kart-kart | no existe | impulso circular con restitución 0,35 |
| Rivales | nodos sobre raíl con un escalar | karts simulados con el mismo modelo |
| Frecuencia de simulación | 60 Hz | 120 Hz |
| Encadenado de boost | no existe | 3 ventanas, PERFECT/GOOD/MISS, reserva con drenaje, bonus por cadena |
| Tricks aéreos | no existen | armado al despegar, pago al aterrizar con aire mínimo |
| Tipos de impacto | 1 | 4 (SCRAPE / FRONTAL / REAR / HEAVY) con cooldown |
| Proyectiles | daño instantáneo sin objeto | objetos con pool, esquivables y bloqueables |
| Sistemas de progreso de carrera | 2, en desacuerdo | 1 |
| Dependencia de física | Rapier WASM cargado sin resolver nada | ninguna |

### Render

| Propiedad | V4 | V5 |
|---|---|---|
| Texturas de imagen | **0** | 15 clases procedurales (albedo + normal por Sobel) |
| `environmentTexture` | **ninguna** | cubemap procedural por tema, 6 caras pintadas de la paleta |
| Post-procesado | **ninguno** | ACES, exposición por zona, bloom umbral 0,86, SSAO2, FXAA, grain |
| Geometría | 100 % primitivas de `MeshBuilder` | toolkit de loft: bisel obligatorio, revolución, barrido, elipsoide |
| Bevel | ninguno | 8 mm small / 20 mm mid / 40–60 mm hero |
| Landmarks | 1 forma reutilizada | 10 hero assets con silueta propia |
| Tipos de prop modelados | 0 | 11 |

---

## PENDIENTE PARA CERRAR LA PUERTA

| Apartado | Actual | Qué falta exactamente |
|---|---:|---|
| VFX | 6 | Speed lines, motion streaks y decals de impacto en el escenario |
| MOBILE EXPERIENCE | 6 | Háptica, volante y remapeo táctil; medición en dispositivo real |

**Ningún otro apartado queda por debajo de 7.** CHARACTERS, SPEED FEEL, ITEM FEEDBACK y FINISH
EXPERIENCE alcanzan 7; VISUAL DENSITY, LIGHTING, MATERIAL QUALITY, TRACK COMPLEXITY, TRACK
READABILITY, CAMERA, KARTS, ENVIRONMENT y AUDIO alcanzan 8; DRIFT FEEL alcanza 9, deliberadamente
por encima del objetivo — el brief dice que un kart racer con gráficos medianos y conducción
excelente funciona, y al revés no.

Global 7,6 contra un objetivo de 8,0. Lo que separa esas cuatro décimas es medible y está nombrado
arriba: dos apartados, no una impresión general.

---

## LO QUE ESTA PUNTUACIÓN NO ES

Ningún apartado visual se ha verificado **en pantalla**. No hay navegador en el entorno de trabajo,
así que no hay capturas ni FPS medidos. Lo verificado es: geometría válida (posiciones finitas,
normales unitarias, índices en rango, dimensiones correctas) mediante 28 tests con `NullEngine`,
presupuestos de triángulos y draw calls medidos, y que las rutas se sirven sin errores.

Las notas de VISUAL DENSITY, LIGHTING, VFX y SPEED FEEL son juicios sobre el código escrito contra
la normativa del art bible, no sobre frames observados. Hay que confirmarlas con el bucle de
revisión visual de la etapa 4.
