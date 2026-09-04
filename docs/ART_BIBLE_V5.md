# PRINT RUSH — ART BIBLE V5

Documento normativo. Define el lenguaje visual **STYLIZED 3D PREMIUM** de Print Rush.
Todo lo que se modele, ilumine, texturice o dibuje en la V5 se valida contra este documento.
Cuando el código y el Art Bible discrepan, gana el Art Bible o se actualiza el Art Bible — nunca se
deja la discrepancia abierta.

Los valores marcados como `TOKEN` existen como constante en código y no deben duplicarse a mano.
Origen de verdad: `apps/web/render/ArtDirection.ts`.

---

## 1. PRINCIPIO RECTOR

> Un almacén de camisetas visto por alguien que lo quiere.

Print Rush no es realismo industrial ni es cartoon plano. Es **producto real, proporción exagerada,
luz de cine**. Un palet es un palet reconocible; mide un 15 % más de lo que debería y está iluminado
como si importara.

Tres reglas que no se negocian:

1. **Nada tiene aristas perfectas.** Todo objeto principal lleva bevel. La luz necesita un borde
   sobre el que romperse. Un cubo sin bevel lee como "demo"; el mismo cubo con 2 cm de bevel lee
   como "objeto".
2. **Nada tiene color plano.** Toda superficie tiene variación: grano, desgaste, suciedad
   estilizada, o al menos ruido de albedo. El color plano es la firma del prototipo.
3. **El gameplay siempre gana en contraste.** Si un elemento decorativo compite en luminancia o
   saturación con la pista, un item o un rival, el elemento decorativo baja. Siempre.

---

## 2. PALETAS

### 2.1 Firma Print Rush

Presente en los cinco mundos. Es lo que hace que las cinco pistas se reconozcan como el mismo juego.

| Rol | Hex | Uso |
|---|---|---|
| `INK_MAGENTA` | `#FF3DA6` | Acento primario. Meta, boost, marca, UI activa |
| `PRESS_LIME` | `#B9FF45` | Acento secundario. Atajos, aciertos, carga de drift nivel 3 |
| `CYAN_SCREEN` | `#65D8FF` | Terciario. Pantallas, escudos, información |
| `PAPER` | `#F7F2E8` | Blanco cálido. Nunca `#FFFFFF` puro en superficie |
| `INK_BLACK` | `#12101A` | Negro azulado. Nunca `#000000` en superficie |

Regla de dosis: los acentos ocupan **menos del 12 % del área de pantalla** en un frame típico. Son
acentos, no fondo. Si la pantalla es rosa, el rosa deja de significar nada.

### 2.2 Paletas por mundo

Cada mundo tiene una tríada base (dominante / secundario / suelo) más una temperatura de luz. Los
acentos de firma se superponen encima, siempre.

#### T-SHIRT MEGASTORE — cálido, textil, acogedor

| Rol | Hex | Nota |
|---|---|---|
| Dominante | `#C98A52` | Madera de expositor |
| Secundario | `#E8DFD0` | Pared y techo, blanco roto |
| Suelo | `#6E6259` | Microcemento pulido |
| Metal | `#9FA6AD` | Percheros, raíles |
| Textil | `#FF3DA6` `#65D8FF` `#B9FF45` `#F7F2E8` `#2C3E70` | Las camisetas SON el color de la tienda |
| Temperatura | 4200 K key / 6500 K fill | |

#### WAREHOUSE EXPRESS — industrial, alto contraste, funcional

| Rol | Hex | Nota |
|---|---|---|
| Dominante | `#5A6068` | Estantería gris industrial |
| Secundario | `#B98A57` | Cartón |
| Suelo | `#4A4E54` | Hormigón sellado con líneas |
| Seguridad | `#FFC02E` | Amarillo de seguridad — solo en bordes y peligro |
| Frío | `#3E6E9E` | Azul de palet plástico y puertas de muelle |
| Temperatura | 5600 K nave / 7500 K muelle exterior | |

#### INK & PRINT FACTORY — saturado, técnico, húmedo

| Rol | Hex | Nota |
|---|---|---|
| Dominante | `#3A3F49` | Maquinaria pintada |
| Secundario | `#8F5CFF` | Tinta violeta |
| Suelo | `#2B2732` | Suelo epoxi con salpicaduras |
| Tintas | `#FF3DA6` `#FFD43B` `#65D8FF` `#12101A` | CMYK reinterpretado a la paleta de marca |
| Técnico | `#FF6B2C` | Luz de secado / calor |
| Temperatura | 5000 K general / 2200 K túnel de secado | |

#### OFFICE CHAOS — claro, doméstico, gigante

| Rol | Hex | Nota |
|---|---|---|
| Dominante | `#E6E1D8` | Blanco de oficina |
| Secundario | `#A2764B` | Madera de escritorio |
| Suelo | `#8C8378` | Moqueta — el suelo es la mesa |
| Vegetal | `#4C7A4E` | Plantas |
| Pantalla | `#65D8FF` | Monitores encendidos |
| Temperatura | 4000 K fluorescente / 6500 K ventanal | |

#### MANGA MEGA CON — nocturno, neón, denso

| Rol | Hex | Nota |
|---|---|---|
| Dominante | `#1B1630` | Oscuridad de pabellón |
| Secundario | `#FF3DA6` | Neón magenta |
| Suelo | `#252036` | Moqueta ferial oscura |
| Neón A | `#8F5CFF` | Violeta |
| Neón B | `#65D8FF` | Cyan |
| Temperatura | Sin key natural — todo son prácticas | |

Manga es el único mundo donde los acentos pueden superar el 12 %: ahí el neón **es** el decorado.
A cambio, el suelo y la arquitectura bajan a valores muy oscuros para mantener la legibilidad.

---

## 3. ILUMINACIÓN

### 3.1 Plantilla base (todos los mundos)

| Luz | Tipo | Intensidad | Función |
|---|---|---|---|
| KEY | Directional | 2,2–3,0 | Define la forma. Siempre a 35–50° de elevación, nunca cenital |
| FILL | Hemispheric | 0,35–0,55 | Levanta la sombra. Color complementario al key, nunca gris |
| BOUNCE | Hemispheric ground | — | `groundColor` = color del suelo del mundo, no negro |
| RIM | Directional | 0,8–1,4 | Detrás y arriba. Separa el kart del fondo. Solo HIGH/ULTRA |
| PRÁCTICAS | Point / Spot | variable | Fluorescentes, neones, pantallas. Son el alma del sitio |

Prohibido: iluminar la escena entera con una sola hemisférica alta. Es lo que hace la V4 y es la
razón de que nada tenga volumen.

### 3.2 Zonas de iluminación

Cada circuito se divide en **zonas** con su propio ambiente. La zona se interpola por progreso de
pista con una transición de 8–12 m, nunca de golpe.

Parámetros que interpola una zona: color e intensidad de key, color de fill, `groundColor`, color y
densidad de niebla, intensidad de entorno (IBL) y exposición.

Ejemplo normativo (T-Shirt Megastore):

```
0,00–0,14  ESCAPARATE     luz de calle fría, exposición alta, niebla mínima
0,14–0,30  PLANTA BAJA    cálido 4200 K, prácticas de raíl, sombras suaves
0,30–0,42  ESCALERAS      transición, key baja, rim sube
0,42–0,58  PLANTA ALTA    cálido claro, ventanal al fondo
0,58–0,68  PROBADORES     íntimo, key baja, prácticas cálidas puntuales
0,68–0,84  ALMACÉN        frío 5600 K, fluorescentes, contraste alto
0,84–1,00  CAJAS Y META   cálido + magenta de marca, exposición alta, bloom
```

La ruta de la V5 es exactamente esta: la luz cuenta el recorrido antes que el cartel.

### 3.3 Sombras

- Cascaded shadow map, 2 cascadas en MEDIUM, 3 en HIGH, 4 en ULTRA.
- Resolución: 1024 (LOW/MEDIUM) · 2048 (HIGH) · 2048 con PCF alto (ULTRA).
- **Casters seleccionados**: karts, hero assets y mid assets cercanos a pista. Los small props y el
  background **no proyectan**. Es la diferencia entre 140 casters y 20.
- Contact shadow falsa bajo cada kart: un decal oscuro que siempre está, aunque el shadow map falle.
  Un kart sin sombra de contacto flota, y flotar lee como demo.

### 3.4 Tonemapping y exposición

| Parámetro | Valor |
|---|---|
| Tone mapping | ACES |
| Exposición base | 1,0 (por zona: 0,85–1,25) |
| Contraste | 1,15 |
| Clamp de blancos | 0,96 — **nunca 1,0** |
| Suelo de negros | 0,04 — **nunca 0,0** |

No quemar blancos, no perder sombras. Un blanco a 1,0 y un negro a 0,0 en la misma escena es la
firma de "no hay grading".

### 3.5 Bloom

Umbral alto y radio corto. Bloom **solo** sobre: neones, boost, pantallas, luces prácticas, items y
la línea de meta.

| Parámetro | Valor |
|---|---|
| Threshold | 0,86 |
| Weight | 0,42 |
| Kernel | 32 (HIGH) · 24 (MEDIUM) · off (LOW) |
| Scale | 0,5 |

Prohibido el bloom global de escena. Si el suelo brilla, el umbral está mal.

### 3.6 Ambient occlusion

- ULTRA / HIGH: SSAO2, radio 1,4, 16 samples, blur activo.
- MEDIUM: SSAO2, radio 1,2, 8 samples.
- LOW / móvil medio: desactivado. Se compensa con AO horneada en el albedo de los props y con la
  sombra de contacto.

---

## 4. MATERIALES

### 4.1 Librería normativa

Toda superficie del juego pertenece a una de estas quince clases. No se crea una decimosexta sin
añadirla aquí. Origen de verdad: `apps/web/render/MaterialLibrary.ts`.

| Clase | Roughness | Metallic | Albedo | Normal | Nota de identidad |
|---|---:|---:|---|---|---|
| `FABRIC` | 0,92 | 0,00 | tejido | fuerte | El más importante. Ver §4.2 |
| `CARDBOARD` | 0,88 | 0,00 | fibra + print | medio | Pliegues, cinta, etiqueta |
| `PAINTED_METAL` | 0,42 | 0,85 | pintura + desgaste | suave | Maquinaria, estanterías |
| `RAW_METAL` | 0,28 | 1,00 | rayado direccional | medio | Raíles, tornillería |
| `RUBBER` | 0,95 | 0,00 | negro con grano | fuerte | Neumáticos, cintas |
| `PLASTIC` | 0,35 | 0,00 | liso con ruido | mínimo | Palets, sillas, cascos |
| `GLASS` | 0,08 | 0,00 | alpha 0,18 | ninguno | Escaparate, monitores |
| `WOOD` | 0,72 | 0,00 | veta | medio | Expositores, escritorios |
| `CONCRETE` | 0,90 | 0,00 | grano + manchas | fuerte | Suelo de almacén |
| `INK` | 0,22 | 0,00 | saturado + emisivo bajo | ninguno | Tinta húmeda |
| `PAPER` | 0,86 | 0,00 | fibra fina | mínimo | Folios, etiquetas, carteles |
| `SCREEN` | 0,18 | 0,00 | emisivo | ninguno | Pantallas. Nunca recibe sombra |
| `NEON` | — | — | emisivo puro | ninguno | `disableLighting`. Alimenta el bloom |
| `ASPHALT` | 0,94 | 0,00 | grano grueso + marcas | fuerte | Calzada exterior |
| `FLOOR_TILE` | 0,55 | 0,00 | baldosa + junta | medio | Suelo de tienda y oficina |

### 4.2 FABRIC — la textura que más importa

Una camiseta que parece plástico rompe todo el juego, porque las camisetas son el tema.

Requisitos mínimos:

- **Microdetalle de tejido** en el normal map: trama visible a 30 cm de cámara, invisible a 3 m.
- **Roughness 0,90–0,94** y `metallic = 0`. Sin excepción.
- **Variación de luz por fibra**: el normal debe producir un micro-moteado bajo el key, no una
  superficie uniforme.
- **Sin specular concentrado.** Si aparece un brillo puntual, el material está mal.
- El diseño impreso va como **capa de decal sobre** el albedo, con el mismo normal de tejido
  atravesándolo — la tinta se mete en la trama, no flota encima.

### 4.3 CARDBOARD

Un cartón plano es tan delator como una camiseta de plástico. Toda caja lleva, por seed:

pliegues en las aristas · cinta adhesiva en una de las 4 orientaciones · etiqueta con código ·
impresión de una tinta desalineada 1–2 mm · variación de tono ±6 % · bordes ligeramente desgastados.

### 4.4 Suelo

El suelo del circuito **nunca** es una superficie de un color. Composición obligatoria por capas:

1. Base de la clase de material del sector.
2. Variación de tono a baja frecuencia (manchas grandes, ±8 %).
3. Suciedad estilizada en los bordes y en el interior de las curvas.
4. Marcas de uso en la trazada ideal — el suelo recuerda por dónde se pasa.
5. Señalización integrada: flechas, líneas de carril, numeración de sector, pintadas en el suelo,
   no como cartel flotante.
6. Skid marks dinámicas encima, con fade.

### 4.5 Presupuesto de materiales

Un material nuevo es un draw call nuevo. Regla dura:

- La escena de carrera **no supera 40 materiales únicos**.
- Toda variación de color dentro de una clase se hace por **instancia** (`instancedBuffers.color`),
  no por material nuevo.
- Los small props comparten atlas por mundo: **un** material para cables, tazas, folios, post-it,
  perchas, etiquetas y pegatinas.

### 4.6 Texturas: resolución y compresión

| Uso | Desktop | Móvil |
|---|---|---|
| Hero asset albedo | 1024 | 512 |
| Material tileable | 512 | 256 |
| Small prop atlas | 1024 | 512 |
| Normal maps | mitad del albedo | mitad del albedo |
| Screens / señalética | 512 | 256 |

La V5 usa un pipeline **mixto y horneado**. Materiales PBR, decals e iconos se generan de forma
procedural offline; panoramas, cartelería, sprites ambientales y wraps de producción usan másteres
originales autorados. Todo se publica como asset estático descrito por manifiesto, se precarga por
circuito y conserva generación procedural en runtime como fallback. Los límites reales de descarga
están en `ART_DIRECTION.md` §3.

---

## 5. GEOMETRÍA Y PROPORCIÓN

### 5.1 Escala

| Elemento | Medida |
|---|---|
| Kart (largo × ancho × alto) | 2,9 × 1,9 × 1,4 m |
| Conductor sentado | 1,25 m sobre el suelo |
| Anchura de pista, general | 12–16 m |
| Anchura de pista, técnica | 9–11 m |
| Anchura de pista, set-piece | 18–24 m |
| Altura libre mínima (túnel) | 6 m |
| Altura de barrera | 0,9 m |

La pista de la V5 es **más ancha que la de la V4** (12–16 m contra 10–11,5 m) porque los circuitos
son más largos y rápidos y hay cuatro karts adelantando.

### 5.2 Bevel — obligatorio

| Tamaño del objeto | Bevel |
|---|---|
| < 0,5 m (small prop) | 8 mm |
| 0,5–2 m (mid asset) | 20 mm |
| > 2 m (hero, arquitectura) | 40–60 mm |

Excepción única: superficies de calzada y planos de señalización.

### 5.3 Jerarquía de props

| Nivel | Cantidad por sector | Triángulos | Ejemplo |
|---|---|---|---|
| **HERO** | 1–3 | 4.000–12.000 | Carrusel de serigrafía, escenario, pared de camisetas, robot logístico |
| **MID** | 8–20 | 600–2.500 | Estantería, perchero, escritorio, máquina, mostrador |
| **SMALL** | 40–200 (instanciados) | 40–300 | Caja, taza, folio, post-it, percha, etiqueta, cable, bolsa |

Un HERO asset no se repite nunca dentro del mismo circuito. Un MID puede repetirse con variación
procedural. Un SMALL se instancia siempre.

### 5.4 Densidad en capas

| Capa | Distancia | Regla |
|---|---|---|
| **GAMEPLAY** | 0–25 m | Pista, rivales, items, obstáculos, boosts. Máximo contraste, silueta limpia |
| **CONTEXT** | 5–60 m | Dice qué sitio es. Detalle alto, no compite en contraste |
| **BACKGROUND** | 40 m+ | Arquitectura, público, máquinas, ventanas. Baja saturación, alto valor de silueta |

Ningún tramo de pista puede tener menos de **4 objetos de capa CONTEXT visibles** a cada lado. Los
huecos vacíos junto a la pista son el motivo principal de que la velocidad no se perciba (§8).

---

## 6. PERSONAJES

Proporción caricatura controlada: **5,5 cabezas** de alto (el realismo es 7,5). Cabeza grande,
manos grandes, silueta legible a 40 m.

| Zona | Regla |
|---|---|
| Cabeza | Morph targets sobre una malla base común. Nunca esferas apiladas |
| Cara | Estilizada siempre. El slider CARTOON ↔ LIKENESS mueve la geometría, no el estilo del shader |
| Ojos | Con párpado y parpadeo. Un ojo sin párpado es una canica |
| Pelo | Volumen de mechones, no un casquete |
| Ropa | `FABRIC` obligatorio. La camiseta admite decal de diseño real |
| Animación mínima | parpadeo · cabeza mirando a la curva · manos en el volante · inclinación en drift · reacción a impacto |

Los cinco últimos puntos son lo que separa "muñeco" de "personaje", y cuestan muy poco.

---

## 7. VEHÍCULOS

Un kart de la V5 tiene, como mínimo, estas piezas separadas:

chasis con bevel · morro · parachoques delantero y trasero · guardabarros × 4 · pontones laterales ·
asiento con respaldo · volante (que gira) · torreta de dirección · motor con culata visible ·
escape (que vibra) · alerón · faros · numeración · 4 llantas + 4 neumáticos independientes.

| Aspecto | Regla |
|---|---|
| Ruedas | Neumático `RUBBER` + llanta `RAW_METAL`, mínimo 24 lados. Rotación real, giro visual del eje delantero, compresión en aterrizaje |
| Suspensión | Visible. Cada rueda tiene recorrido vertical independiente |
| Pintura | Shader estilizado con clearcoat controlado: `clearCoat.intensity = 0,45`, `roughness = 0,18`. No cromado espejo |
| Personalización | body · wheels · rims · paint · decals · spoiler · exhaust · number |

---

## 8. PERCEPCIÓN DE VELOCIDAD

La V4 va a 104 km/h y parece lenta. La velocidad no es un número, es la suma de estos siete
factores, y hay que aplicarlos todos:

| Factor | Regla V5 |
|---|---|
| FOV | 62° parado → 78° a tope → 86° en boost. Interpolación asimétrica: sube rápido, baja lento |
| Distancia de cámara | 8,4 m → 11,2 m con la velocidad |
| Objetos cercanos | Algo a menos de 6 m de la pista **cada 15 m de recorrido**. Sin esto no hay velocidad |
| Parallax lateral | Tres profundidades distintas visibles a cada lado |
| Detalle de suelo | Marcas y juntas cada 4–8 m: el suelo tiene que pasar |
| Motion | Speed lines radiales a partir del 78 % de velocidad punta; motion blur ligero solo en boost |
| Audio | Capa de viento a partir del 60 %, altura del motor ligada a la velocidad, no a la RPM fingida |

---

## 9. VFX

| Efecto | Regla de identidad |
|---|---|
| `TIRE_SMOKE` | Densidad y color según superficie. En `INK` sale tinta, no humo |
| `DRIFT_SMOKE` | Cambia de color con el nivel de carga: blanco → cyan → magenta → lima |
| `SKID_MARK` | Decal continuo sobre el suelo con fade de 6 s. Nunca cajas flotantes |
| `SPARK` | Solo en metal e impacto fuerte. Naranja cálido, vida corta |
| `INK_SPLASH` | Firma del juego. Salpicadura de tinta con el color del sector |
| `BOOST_FIRE` | Cono corto en el escape + distorsión. Color por nivel de boost |
| `SPEED_LINE` | Radiales desde el centro, solo en el tercio exterior de la pantalla |
| `CONFETTI` | Meta. Recortes de tela y papel, no cuadrados de color |

Presupuesto de partículas vivas: LOW 120 · MEDIUM 350 · HIGH 900 · ULTRA 1.600.
Cuando se recorta por calidad, **el feedback esencial nunca se elimina**: se reduce el conteo. Drift,
boost e impacto siempre son visibles, incluso en LOW.

---

## 10. UI Y SEÑALIZACIÓN

### 10.1 HUD

Arcade premium: pocas piezas, muy grandes, muy legibles, con peso.

| Elemento | Posición | Regla |
|---|---|---|
| Posición | Inferior izquierda | La pieza más grande del HUD. Numeral con ordinal |
| Vuelta | Superior izquierda | Con "FINAL LAP" destacado |
| Item | Superior derecha | Cápsula con la ruleta animada |
| Minimapa | Inferior derecha | Trazado real del circuito, no barras |
| Tiempo | Superior centro | Discreto |
| Aviso de impacto | Borde de pantalla | Direccional |

- Tipografía: una sola familia, pesos 700 y 900. Números tabulares siempre.
- Todo elemento de HUD lleva contorno o sombra: tiene que leerse sobre fondo claro y oscuro.
- **Ningún componente de HUD se re-renderiza por frame.** El HUD se actualiza por mutación directa
  del DOM o por canvas; React solo monta y desmonta.
- Entrada y salida siempre animadas, 120–200 ms, con easing de salida.

### 10.2 Señalización en el mundo

La navegación se comunica **en el mundo antes que en el HUD**:

flechas pintadas en el suelo · paneles direccionales colgados · color del acento del sector en las
barreras · luz que cambia antes de un giro ciego · un landmark visible desde el punto de decisión.

Si el jugador necesita el minimapa para no perderse, el circuito está mal señalizado.

---

## 11. VARIACIÓN PROCEDURAL

Todo se genera con `seed`. Nada se repite idéntico dos veces en pantalla.

| Objeto | Ejes de variación |
|---|---|
| Estantería | contenido · color de balda · nº de cajas · camisetas colgadas · cartel · desgaste |
| Caja | tamaño (3 formatos) · etiqueta · posición de la cinta · rotación ±4° · tono ±6 % |
| Espectador | avatar · ropa · fase de animación · altura · dirección de la mirada |
| Camiseta en expositor | diseño · color base · pliegue · rotación de percha |

Regla: si el jugador puede ver dos copias idénticas del mismo objeto en un frame, falta variación.

---

## 12. ENVIRONMENT STORYTELLING

Cada circuito cuenta un proceso mientras se corre. El orden de los sectores **es** la narración.

| Circuito | Historia |
|---|---|
| T-Shirt Megastore | El recorrido del cliente: escaparate → prueba → compra → trastienda |
| Warehouse Express | El recorrido del pedido: recepción → almacenaje → picking → packing → expedición |
| Ink & Print Factory | El recorrido del diseño: arte → fotolito → pantalla → tinta → secado → doblado |
| Office Chaos | El recorrido de la idea: recepción → boceto → revisión → aprobación |
| Manga Mega Con | El recorrido del fan: entrada → artist alley → cosplay → escenario → merch |

Un sector que no aporta un paso de la historia es un sector que sobra.
