# PRESUPUESTO POR CIRCUITO

Medido en pantalla con `window.__printRushQA.stats()` (calidad HIGH, 1600 × 900, Chromium headless
con SwiftShader — el FPS de ese entorno no es representativo y no se registra; el resto de cifras sí
lo son: son las del frame que la GPU del jugador tendría que dibujar).

Fecha: 2026-09-04. Se re-mide al cerrar cada etapa que toque un circuito.

## Serigrafía (`ink-print-factory`) — circuito dorado

| Métrica | Vista diagnóstica HIGH | Límite de trabajo |
|---|---:|---:|
| Draw calls | 354 | 800 |
| Mallas activas | 1.197 | 2.500 |
| Mallas totales en escena | 4.618 | 6.000 |
| Triángulos activos | 0,50 M | 1,5 M |
| Materiales en escena | 453 | — (ver nota) |
| Materiales de la librería de pista | 126 | 140 |
| Texturas | 283 | 320 |
| Luces | 6 (key, fill, rim, carrusel, secador, UV) | 8 |
| Sistemas de partículas | 15 | 20 |
| Bindings de texturas horneadas | 124 | — |

Nota sobre materiales: de los 453, alrededor de 330 pertenecen a los ocho karts y sus pilotos (cada
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

## Los otros cuatro (set autoral completo)

| Circuito | Draw calls | Mallas activas | Triángulos | Bindings horneados |
|---|---:|---:|---:|---:|
| Tienda | 417 | 1.860 | 0,68 M | 72 |
| Almacén | 348 | 1.319 | 0,56 M | 61 |
| Oficinas | 332 | 2.021 | 0,67 M | 59 |
| Salón Manga | 363 | 1.217 | 0,37 M | 56 |

Las cifras son la última tanda `output/visualqa/ref100-*`, por eso no sustituyen un perfil de
vuelta completa; sirven como caso amplio y comparable. SwiftShader produjo 6–7 FPS y p95 de 250 ms:
ese tiempo no representa una GPU de usuario, pero ya no se oculta tras el clamp de simulación.

## Reglas que ya se cumplen y que la puerta de calidad vigila

- Solo se descarga el conjunto común y el circuito actual (`AssetManager.planRace`, test); una
  categoría o librea crítica ausente bloquea `RACE_READY`, una opcional queda registrada y degrada.
- Todo lo repetido es instancia con color por instancia; ningún hero se repite en un circuito.
- Casters de sombra: karts, heroes y mid assets cercanos. La nave y los pequeños no proyectan.
- Partículas: presupuesto vivo por calidad en `VFXSystem`; el set añade como máximo 15 sistemas de
  30–90 partículas y ninguno en LOW.
- Los módulos de media distancia usan una sola silueta/material por instancia. La primera versión
  multi-material sumaba ~120 draws en Tienda y se descartó durante QA.
