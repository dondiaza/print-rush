# KART PAMPLING — TRACK VISUAL DNA

Documento de dirección visual para la construcción de circuitos. Es el resultado de la FASE 1 del
brief *Track Visual Generator V3*: extraer los **principios** del lenguaje visual del arcade kart
racing de gama alta y fijarlos como reglas propias de Kart Pampling, sin copiar contenido protegido.

## 0. Sobre las referencias — leer primero

El brief describe una biblioteca de más de cien capturas de referencia y pide analizarla completa.
Se buscó en el repositorio (`/references`, `/reference-images`, `/assets/references` y variantes) y
en el disco de trabajo: **no existe ninguna carpeta de referencias ni imágenes adjuntas**. Tampoco
hay herramienta de generación de imágenes en este entorno de trabajo (verificado de nuevo el
2026-09-03; consta también en `docs/ART_DIRECTION.md` §0).

Consecuencia honesta: este documento **no** es el análisis de esas imágenes. Es la codificación de
los principios de diseño del género que el propio brief enumera — legibilidad, escala, jerarquía,
capas, materiales creíbles, narrativa ambiental — contrastados con lo que se puede **medir en
pantalla** con la infraestructura de QA visual que se ha construido (capturas automáticas de la
escena real desde Chromium, sin HUD, en ocho vistas fijas por circuito). Cuando la biblioteca de
referencia exista en el repo, la sección 1 debe revisarse contra ella; el resto son decisiones de
producción y se mantienen.

Todo lo que sigue se ha aplicado ya al circuito dorado (Serigrafía) y está en código. Donde una regla
apunta a un módulo, ese módulo es la fuente de verdad.

---

## 1. PATRONES GENERALES DEL GÉNERO

Lo que un kart racer arcade de nivel comercial hace siempre, expresado como regla. No describe
ningún circuito concreto.

### 1.1 Formas
- **Todo está redondeado.** Aristas de 90° perfectas no existen en primer plano. La luz necesita un
  borde donde romperse: bisel en mobiliario, arquitectura, máquinas, barreras y carteles.
- **Silueta antes que textura.** Un objeto se reconoce por su contorno a 120 km/h en un tercio de
  segundo; el detalle de superficie es secundario y se lee sólo al pasar cerca.
- **Formas grandes, pocas.** Una zona la definen dos o tres masas grandes y un puñado de medianas,
  no cien pequeñas. La sensación de "lleno" viene de la jerarquía, no del recuento.

### 1.2 Proporción y escala
- **El kart es pequeño frente al mundo.** El techo está a 25–30 m, una máquina mide 12 m, un rotulador
  mide 7 m. La escala se comunica con objetos *familiares* exagerados (taza, rotulador, camiseta,
  caja), porque el ojo conoce su tamaño real y mide el mundo contra ellos.
- **La escala humana coexiste con la gigante.** Escaleras, barandillas, plataformas de acceso y
  señales a altura de persona junto a la máquina gigante son lo que la hace leerse como gigante.
- **Pista de 12–16 m**: ancha para adelantar, con puntos técnicos a 10 m y set-pieces a 18–24 m.

### 1.3 Arquitectura
- **Siempre hay un edificio.** Ningún circuito es una cinta sobre un plano. Suelo, muros perimetrales,
  columnas, techo y sus servicios (cerchas, lucernarios, conductos, lámparas) definen el volumen.
- **El techo es parte de la imagen.** El tercio superior del encuadre en cámara de carrera es techo;
  necesita ritmo (cerchas), luz (lucernarios/lámparas) y líneas de fuga (conductos).
- **Los muros tienen bandas.** Zócalo, banda de aviso, revestimiento, banda de ventana, remate. Un
  muro de una sola textura de 900 m lee como un texturado; uno con bandas lee como un edificio.

### 1.4 Materiales
- **Semirrealistas, no fotográficos.** Roughness/metallic coherentes por clase (`MaterialLibrary`),
  relieve visible en primer plano, variación tonal a baja frecuencia siempre.
- **Nada es de color plano.** Grano, desgaste, manchas estilizadas o al menos ruido de albedo.
- **Lo húmedo brilla y lo textil no.** La tinta refleja las lámparas (roughness 0,22); la camiseta
  nunca tiene un brillo puntual (roughness 0,92).
- **La textura repite a escala real.** Texel density coherente: una baldosa de 30 cm mide 30 cm.

### 1.5 Color
- **Un neutro dominante y acentos dosificados.** El mundo es neutro (grises, kraft, blanco cálido,
  hormigón) y el color vive en acentos: los acentos ocupan menos del 12 % del encuadre salvo donde el
  color *es* el decorado (feria, neón).
- **Color por zona.** Cada zona del recorrido tiene su propio balance; el jugador nota que ha
  cambiado de sitio antes de leer el cartel.
- **Los acentos de gameplay ganan siempre.** Boost, item, meta, rival: si un elemento decorativo
  compite en luminancia o saturación, el decorativo baja.

### 1.6 Iluminación
- **Key + fill + bounce + rim + prácticas.** Un solo hemisférico alto es la firma del prototipo. La
  forma se modela con temperatura (key cálido, fill frío), no con oscuridad.
- **Las prácticas son el alma del sitio.** Lámparas colgantes, lucernarios, pantallas, neones,
  resistencias del horno: son geometría emisiva y, en los landmarks, luz real.
- **Zonas interpoladas por progreso**, con transiciones de 8–12 m. La luz cuenta el recorrido.
- **Tone mapping ACES con blancos a 0,96 y negros a 0,04.** Nunca quemar, nunca perder sombra.

### 1.7 Contraste y legibilidad de pista (track ribbon)
Cinco bandas siempre distinguibles, de dentro hacia fuera:
1. **ROAD** — material del sector, línea de trazada pintada, marcas de uso.
2. **SHOULDER** — línea de borde pintada continua (color de señalización del tema) + bordillos
   biselados a rayas en el interior de curva.
3. **BARRIER** — perfil bajo (zócalo + banda de aviso + barandilla), ~1 m, para ver el mundo por
   encima.
4. **OFFTRACK** — arcén conducible 2 cm más bajo, textura distinta, penaliza agarre.
5. **BACKGROUND** — el edificio y su panorama.

No depender de flechas: la dirección la dan la línea de borde, los bordillos, las lámparas que siguen
la pista, los conductos que giran con ella y los carteles de chevrones antes de cada curva real.

### 1.8 Profundidad y capas
Cada vista importante tiene seis capas: L0 pista · L1 barrera y props de borde · L2 maquinaria y
mobiliario · L3 estructuras grandes (columnas, landmarks) · L4 muros lejanos con banda de ventana ·
L5 panorama visto a través y por encima. Nunca "pista + pared".

### 1.9 Densidad
- **Alta junto al recorrido** (0–25 m): algo con silueta cada 11–15 m por lado.
- **Media en el midground** (25–60 m): maquinaria, mobiliario, montones.
- **Baja en el fondo** (60 m+): arquitectura, siluetas, panorama.
- La escapatoria (arcén) queda **vacía**: nada con silueta donde el kart puede rodar.

### 1.10 Señalización
Integrada con el universo, nunca HUD flotante: puertas de zona con el nombre del sector, carteles de
chevrones en el exterior de cada curva 18 m antes del vértice, líneas de borde pintadas, banda de
aviso en la barrera, tablero de meta con marca y META, cinta de suelo.

### 1.11 Vegetación, interiores, exteriores
Los cinco mundos son interiores. Vegetación sólo como prop (plantas de oficina y tienda). El
"exterior" existe únicamente a través de la banda de ventana de los muros: el panorama se ve a
través de ella y por encima del remate.

### 1.12 Personajes ambientales y objetos móviles
- Público y figurantes: 3D simplificado en primer plano, sprites 2.5D en medio, nada al fondo.
- **Cinco sistemas animados por circuito como mínimo**: maquinaria giratoria, cintas que transportan,
  ventiladores, tapas que se abren, resistencias que pulsan, brazos que prensan.
- Los hazards pertenecen al proceso del lugar: una prensa que baja, una rejilla que suelta vapor.

### 1.13 VFX
Vapor, polvo en suspensión en los haces de luz, goteo de tinta, calor a la salida del horno. Siempre
con sprite suave, pocas partículas, aditivo sólo para polvo y calor. El presupuesto vivo lo fija
`VFXSystem` por calidad.

### 1.14 Fondos y skyboxes
El fondo es la continuación del edificio: panorama cilíndrico de 4096 px con el horizonte a la
altura del ojo, visto a través de la banda de ventana. Nunca un cielo genérico bajo techo.

### 1.15 Composición y jerarquía visual
Un encuadre de carrera se lee en este orden: pista y trazada → rival/ítem → barrera y borde → landmark
de la zona → arquitectura → fondo. Si un elemento salta de nivel (un prop más luminoso que la pista),
está mal.

---

## 2. DIRECCIÓN ARTÍSTICA DE KART PAMPLING

HIGH-END ARCADE KART RACING · STYLIZED 3D · SEMI-REALISTIC MATERIALS · ILLUSTRATED PERSONALITY ·
EXAGGERATED SCALE · VERY HIGH VISUAL READABILITY.

Mezcla 70 % claridad arcade (formas redondeadas, superficies limpias, color controlado, parque
temático) y 30 % agresividad (maquinaria, textura, riesgo, atmósfera, elementos gigantes).

Reglas absolutas:
1. **Ninguna primitiva desnuda en el resultado final.** Blockout con cajas, resultado con bisel,
   material, decal y luz. Todo lo repetido es instancia; todo lo único es loft/revolución/barrido.
2. **Cada circuito es un edificio** (`render/Hall.ts`) con 5–8 zonas y 5+ landmarks propios.
3. **Cada zona responde "qué ocurre aquí normalmente"** y la pista atraviesa el proceso en orden.
4. **La lectura de pista no depende del HUD.**

---

## 3. PIPELINE APLICADO (por circuito)

REFERENCE ANALYSIS → CONCEPT → TRACK LAYOUT (`game-core/tracks/circuits.ts`) → BLOCKOUT (nodos
horneados + `RoadMesh`) → MACRO ENVIRONMENT (`Hall.ts`) → LANDMARKS (`render/sets/*`) → MESO PROPS
(`PropLibrary` + `zoneProps`) → TEXTURES (`tools/assetgen`) → MICRO DETAIL (decals, bordillos,
líneas) → LIGHTING (`LightingRig` zonas + luces de landmark) → BACKGROUND (panorama) → ANIMATION
(`animators`) → VFX (partículas del set) → GAMEPLAY READABILITY (`Signage.ts`) → PERFORMANCE
(instancias, merge, presupuesto) → VISUAL QA (captura automática de 8 vistas + puntuación).

---

## 4. CIRCUITO DORADO: SERIGRAFÍA

Zonas y proceso (el orden de sectores es la narración):

| Sector | Zona | Qué ocurre | Landmarks | Movimiento |
|---|---|---|---|---|
| 1 | DISEÑO | El arte | Mesa de diseño gigante con monitor, rotulador y taza; mesa de luz con fotolitos; tablero de muestras | Pantalla del monitor |
| 2 | PANTALLAS | El esténcil | Racks en A con pantallas; unidad de insolación con tapa que se abre; cabina de revelado | Tapa UV, niebla de agua |
| 3 | TINTA | La impresión — **momento hero** | Pulpo-carrusel de 8 brazos sobre la pista, cubas CMYK, líneas de tinta aéreas, charcos, montañas de camisetas | Rotor, rasquetas, goteo, vapor, polvo |
| 4 | SECADO | El curado | Túnel de secado que envuelve la pista: resistencias, ventiladores, cinta con camisetas, chimeneas | Ventiladores, cinta, pulso de calor, calima |
| 5 | CONTROL | La camiseta terminada | Mesas de inspección con pilas dobladas, cartones, jaulas, tablero "Control de calidad" | — |

Hazards del mundo: **prensa** que baja sobre el carril (PRESS) y **rejilla de vapor** (STEAM),
sincronizados con la fase que usa la física.

Este circuito fija el estándar (calidad de material, densidad de props, luz, fondo, VFX y presupuesto)
que después se aplica a los demás. Los otros cuatro reciben ya la **misma infraestructura** —
edificio, barrera perfilada, líneas de borde, puertas de zona, chevrones, meta — y les falta su set
autoral, que se documenta en `docs/V5_PROGRESS.md` como trabajo pendiente.

---

## 5. VISUAL QA

Infraestructura: `window.__printRushQA` (activo con `print-rush.debug = "1"`) permite fijar la cámara
en cualquier progreso de vuelta, leer el coste del frame e inspeccionar mallas. El script de captura
fotografía START · TURN 1 · LANDMARK 1 · MIDDLE · SHORTCUT · HERO · FINAL TURN · FINISH más vistas
auxiliares (general, túnel, puerta de zona, mesa), sin HUD.

Se buscan: zonas vacías, repetición, luz plana, cubos visibles, texturas estiradas, props flotantes,
escala errónea, siluetas débiles, fondo pobre, mala legibilidad. Se puntúa 1–10 en Composition,
Materials, Lighting, Depth, Theme, Readability, Detail, Originality, Game feel y Polish; ninguna
categoría crítica por debajo de 7 y media ≥ 8 para dar la pista por buena. La puntuación vigente está
en `docs/V5_QUALITY_GATE.md`.
