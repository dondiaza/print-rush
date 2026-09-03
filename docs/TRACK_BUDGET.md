# PRESUPUESTO POR CIRCUITO

Medido en pantalla con `window.__printRushQA.stats()` (calidad HIGH, 1600 × 900, Chromium headless
con SwiftShader — el FPS de ese entorno no es representativo y no se registra; el resto de cifras sí
lo son: son las del frame que la GPU del jugador tendría que dibujar).

Fecha: 2026-09-03. Se re-mide al cerrar cada etapa que toque un circuito.

## Serigrafía (`ink-print-factory`) — circuito dorado

| Métrica | Salida (vista 01) | Momento hero (vista 06) | Límite de trabajo |
|---|---:|---:|---:|
| Draw calls | 301 | ~670 | 800 |
| Mallas activas | 719 | ~2.000 | 2.500 |
| Mallas totales en escena | 4.730 | 4.730 | 6.000 |
| Triángulos activos | 1,23 M | 1,1 M | 1,5 M |
| Materiales en escena | 452 | 452 | — (ver nota) |
| Materiales de la librería de pista | 125 | 125 | 140 |
| Texturas | 284 | 284 | 320 |
| Luces | 6 (key, fill, rim, carrusel, secador, UV) | 6 | 8 |
| Sistemas de partículas | 15 | 15 | 20 |
| Texturas horneadas descargadas | 2,29 MB (scope `screenprinting`) | | 3 MB |

Nota sobre materiales: de los 452, alrededor de 330 pertenecen a los ocho karts y sus pilotos (cada
kart con piloto son ~30 materiales), no al circuito. La librería de pista queda en 125 con el set
completo; el art bible pedía 40 para la V5 inicial y ese tope se revisa en esta etapa: un set autoral
con tintas CMYK, cinco zonas y señalización con texto no cabe en 40 sin perder identidad. El tope de
trabajo pasa a 140 y se mide, no se estima.

Dónde está el coste, por orden:
1. Karts y pilotos de la parrilla (8): ~124 draw calls y ~50 k triángulos (medido en `budget.test.ts`).
2. Props dispersos por zona (instanciados por fuente; ~30 fuentes multi-material).
3. Set: carrusel (rotor + 8 cabezales + platinas), túnel de secado (carcasa + costillas + cinta),
   mesas, racks. Cada hero es una malla fusionada por material.
4. Nave: ~18 draw calls para muros, techo, cerchas, lucernarios, columnas, lámparas y conductos.
5. Decals (22) y pósters (por diseño, no por póster).

## Los otros cuatro (estándar aplicado: nave, barrera, líneas, puertas, chevrones, meta)

| Circuito | Draw calls (01) | Mallas activas | Triángulos | Texturas horneadas |
|---|---:|---:|---:|---:|
| Tienda | 432 | 1.604 | 1,7 M | 1,85 MB |
| Almacén | 651 | 1.990 | 1,0 M | 1,05 MB |
| Oficinas | ~450 | ~1.600 | ~1,2 M | 1,13 MB |
| Salón Manga | ~500 | ~1.800 | ~1,3 M | 1,26 MB |

## Reglas que ya se cumplen y que la puerta de calidad vigila

- Solo se descarga el conjunto común y el circuito actual (`AssetCatalog.raceWeight`, test).
- Todo lo repetido es instancia con color por instancia; ningún hero se repite en un circuito.
- Casters de sombra: karts, heroes y mid assets cercanos. La nave y los pequeños no proyectan.
- Partículas: presupuesto vivo por calidad en `VFXSystem`; el set añade como máximo 15 sistemas de
  30–90 partículas y ninguno en LOW.
