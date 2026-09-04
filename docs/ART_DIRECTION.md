# KART PAMPLING — DIRECCIÓN ARTÍSTICA

Documento normativo para todo asset visual del proyecto. Complementa `ART_BIBLE_V5.md`, que define
paletas, iluminación y proporciones; este documento define **cómo se producen los assets**: qué se
modela, qué se textura, qué se resuelve con sprite, con decal o con fondo, y con qué presupuesto.

---

## 0. ESTADO DE LAS CAPACIDADES — LEER PRIMERO

Desde el 2026-09-04 el proyecto usa un pipeline **mixto**: las imágenes de alto impacto se autoran
con generación de imagen, se revisan visualmente, se recortan/compensan para su uso real y se
hornean como WebP; los mapas que exigen precisión matemática siguen siendo procedurales. El
generador procedural permanece como fallback cuando un máster autorado no existe.

| Clase de asset | Cómo se produce hoy | Estado |
|---|---|---|
| Materiales tileables | **Generación procedural offline** a fichero real | Resuelto |
| Decals (tinta, arañazos, suciedad, cinta) | Generación procedural offline con alpha | Resuelto |
| Wraps de kart | 7 másteres originales autorados + ajuste de costura UV | Resuelto |
| Fondos panorámicos | 5 másteres originales autorados, 4096×2048 y costura 360° | Resuelto |
| Geometría (karts, personajes, props, heroes) | Modelada por código con el toolkit de loft | Resuelto |
| Ilustración: pósters y señalética ficticia | 5 atlas autorados, 40 diseños | Resuelto |
| Sprites de público, producto y vegetación | 4 atlas autorados, 38 recortes | Resuelto |
| Retratos de avatar desde foto | Procesado local existente; no forma parte de este pase | Resuelto |
| **Logotipos de marca reales** | No hay ficheros oficiales en el repo | **Bloqueado** |

Las 100 referencias aportadas se analizaron como lenguaje abstracto —composición, escala, ritmo,
profundidad y legibilidad—, no como catálogo para copiar. No se reprodujo ningún personaje,
vehículo, circuito, objeto, icono, logotipo ni geometría identificable de otra franquicia. Los
prompts y la correspondencia de salidas se registran en `generated-asset-prompts.md`.

**Regla dura:** nadie declara un asset como generado si el fichero no existe en el repositorio. El
manifiesto se genera desde el disco, no a mano.

---

## 1. ESTILO

**Arcade 3D ilustrado, semi-realista.** No hiperrealista, no infantil, no genérico de asset store.

Lo que define el estilo, en orden de importancia:

1. **Silueta legible a 120 km/h.** Si un objeto no se reconoce en el tercio de segundo que dura al
   pasar, su detalle es decorado inútil. La silueta se decide antes que la textura.
2. **Materiales creíbles, no fotográficos.** Un cartón tiene que responder a la luz como cartón. No
   necesita ser un escaneo de cartón.
3. **Color intenso pero jerarquizado.** El gameplay siempre gana en contraste. Ver §5.
4. **Detalle sin ruido.** Tres escalas deliberadas (§6), no microdetalle uniforme.

### Descripción base reutilizable

Todo prompt de asset autorado arranca de esta base para que el set no se disperse en cinco estilos:

> Stylized semi-realistic arcade racing game asset, polished commercial videogame art direction,
> believable materials, slightly exaggerated proportions, clean readable silhouette, colourful but
> controlled palette, detailed without visual noise, no copyrighted characters or brands, designed
> for the Pampling Kart universe.

Y para cualquier textura destinada a repetirse, se añade:

> Seamless tileable texture, orthographic, no perspective, even lighting, no cast shadows, nothing
> cut off at the edges.

---

## 2. QUÉ SE RESUELVE CON QUÉ

La decisión no es estética, es funcional: depende de si la silueta importa y de a qué distancia se
ve el objeto.

### TIPO A — Geometría 3D real

Cuando la silueta importa y el jugador pasa cerca: karts, conductores, estanterías, máquinas,
mesas, ordenadores, carruseles de serigrafía, carretillas, rampas, barreras, mobiliario.

Se modela con el toolkit de `render/Geometry.ts`. **Bisel obligatorio** — la luz necesita un borde
sobre el que romperse. Presupuestos en `ART_BIBLE_V5.md` §5.3.

Una caja de cartón puede ser una caja biselada. Una mesa completa no puede ser un cubo. Un kart no
puede ser una colección de cajas. Un personaje tampoco.

### TIPO B — Sprite 2.5D con alpha

Cuando el volumen no se percibe a la distancia a la que se ve: público, plantas, ropa colgada de
lejos, siluetas de fondo, pequeño merchandising.

Nunca en primer plano. Orientación billboard solo cuando el objeto es aproximadamente simétrico en
planta. Los cuatro atlas WebP cubren asistentes, compradores, camisetas colgadas y plantas. El
público muy cercano conserva geometría simplificada (`PropLibrary.CROWD`) para que el plano no se
delate cuando el kart pasa junto a él.

### TIPO C — Decals

Grafitis, señales pintadas, números, pegatinas, manchas, marcas de suelo, huellas, desgaste,
salpicaduras de tinta. Con alpha, proyectados sobre la superficie. Generados proceduralmente.

Uso con moderación: un decal cada pocos metros lee como suciedad de uso; un decal cada metro lee
como ruido.

### TIPO D — Texturas tileables

Suelo, paredes, techo, y cualquier superficie extensa: asfalto, hormigón, baldosa, madera, moqueta,
metal, cartón, tejido. La repetición no debe ser evidente: se consigue con ruido periódico de varias
octavas más variación de baja frecuencia, no con un patrón pequeño repetido.

### TIPO E — Fondos y panoramas

Para lo que está lo bastante lejos como para que la geometría sea absurda. Los cinco mundos de
producción usan panoramas cilíndricos autorados, graduados de techo claro a base oscura y corregidos
para cerrar horizontalmente. Greybox conserva el gradiente procedural como fallback y herramienta
de diagnóstico.

---

## 3. RESOLUCIONES Y PRESUPUESTO

No se genera todo a 4K. La resolución la decide el tamaño en pantalla, no la importancia del objeto.

| Clase | Resolución | Canales |
|---|---|---|
| Material tileable | 512 | basecolor RGB + normal RGB + roughness gris |
| Material hero (suelo de pista) | 1024 | igual |
| Decal | 512 | RGBA |
| Wrap de kart | 1024 | RGB |
| Atlas de props pequeños | 1024 | RGBA |
| Panorama de fondo | 4096 × 2048 | RGB WebP |
| Icono de UI | 128 | RGBA |

**Presupuesto de descarga:** los assets se cargan **por circuito**, nunca los cinco a la vez.

```
ALWAYS  (materiales compartidos + iconos + ambiente)       objetivo < 4 MB   real 3,72 MB
TRACK   (materiales, panorama, decals, carteles, sprites)  objetivo < 3 MB   real ≤ 2,62 MB
KART    (las liveries que hay en la parrilla)              objetivo < 1,2 MB real ≤ 0,67 MB
```

El circuito piloto (serigrafía) es el más pesado con 2,62 MB, y una carrera allí descarga 7,00 MB en
total. **No se comprueba un total agregado**: una versión anterior de los tests asertaba «menos de
7 MB por carrera», un número que no aparece en ninguna parte de este documento. Los límites
declarados son por nivel; eso es lo que se verifica.

**Tres niveles, no dos.** La primera versión de esta tabla metía decals y wraps en `COMMON`, y el
manifiesto sólo tenía un campo `circuit`: todo lo que no pertenecía a un circuito contaba como
compartido. Eso daba 5,64 MB de "compartido" que **ningún jugador ha descargado nunca**, porque una
carrera se lleva un circuito, las cuatro o cinco familias de decals que ese tema esparce, y las
liveries de su propia parrilla — no las siete. El manifiesto lleva ahora un campo `download` con el
nivel, y `AssetCatalog.raceWeight()` calcula lo que de verdad se pide. Peor carrera medida:
**7,00 MB** en el taller de serigrafía, con las cuatro liveries más pesadas.

Una regla que se comprueba en los tests: **un tema sólo puede nombrar assets del conjunto
compartido o de su propio circuito.** `mat_paintedmetal_press` es un fichero real, y nombrarlo desde
el tema Manga compilaría, pasaría la comprobación de "ningún id inventado", y caería al generador
procedural para siempre sin que nada lo dijera.

El preloader muestra progreso **real** — bytes descargados sobre bytes esperados, tomados del
manifiesto. Nunca una barra ficticia.

---

## 4. NOMENCLATURA Y ESTRUCTURA

```
apps/web/public/assets/
  common/
    materials/    mat_<clase>_<variante>_{basecolor,normal,roughness}.png
    decals/       decal_<familia>_<nn>.png
    wraps/        kart_wrap_<nombre>_basecolor.webp
    sprites/      sprite_{hanging_shirt,plant}_atlas.webp
    ui/           ui_icon_<nombre>.png
  tracks/
    <circuito>/
      backdrop_<circuito>_panorama.webp   (greybox sigue en .png)
      poster_<circuito>_atlas.webp
      sprite_<familia>_atlas.webp         (tienda y convención)
      materials/  mat_<clase>_<variante>_*.png
  assets.manifest.json
```

Nombres descriptivos y estables. Prohibido `image1.png`, `final2.png`, `new.png`,
`generated-image.png`. El nombre de un asset **no cambia** cuando se sustituye su contenido: eso es
lo que permite cambiar procedural por ilustrado sin tocar código.

La extensión es parte del nombre. Rebakear los cinco panoramas de PNG a WebP fue un renombrado, y
un renombrado rompe a cualquier cliente que siga creyendo el manifiesto anterior: pedía los `.png`
que el despliegue ya no publica, el backdrop es un asset obligatorio y la carrera se quedaba en
"PISTA NO PREPARADA". Por eso `AssetCatalog.load` revalida el manifiesto en cada arranque en vez de
aceptar la copia guardada. Si hay que cambiar de formato, sigue siendo la vía correcta — pero es un
cambio visible en el despliegue, no una sustitución de contenido.

---

## 5. ILUMINACIÓN Y JERARQUÍA

Nunca iluminar todas las superficies a intensidad máxima. Tres niveles, y se respetan:

```
GAMEPLAY     pista, rivales, items, obstáculos     máximo contraste, silueta limpia
DECORACIÓN   contexto cercano                       detalle alto, no compite en contraste
FONDO        arquitectura, público, panoramas       saturación baja, valor de silueta alto
```

Sombras por clase:

| Clase | Sombra |
|---|---|
| HERO (karts, conductores) | dinámica |
| IMPORTANTE (mid assets cercanos) | dinámica simplificada |
| DECORACIÓN | horneada en el albedo, o ninguna |
| FONDO | ninguna |

Y una sombra de contacto falsa bajo cada kart, siempre: un kart sin sombra de contacto flota, y
flotar lee como demo.

---

## 6. TRES ESCALAS DE DETALLE

Se diseña de grande a pequeño. Rellenar de microdetalle sin macroformas produce ruido, no riqueza.

- **MACRO** — las grandes formas que dan identidad: estanterías, carrusel, escenario, pared de
  camisetas, monitor gigante. 1–3 por sector.
- **MEDIO** — lo que cuenta qué ocurre en el sitio: cajas, monitores, percheros, señales, palets.
- **MICRO** — lo que da uso: pegatinas, cables, papeles, arañazos, etiquetas.

---

## 7. VARIEDAD CONTROLADA

Si el jugador puede ver dos copias idénticas del mismo objeto en un frame, falta variación.

La variación se consigue **por instancia y por semilla**, no duplicando assets:

- color por instancia (`instancedBuffers.color`);
- escala y rotación con jitter determinista;
- variantes de textura del mismo material con distinta semilla;
- contenido distinto en el mismo mueble.

Una estantería varía por contenido, color de balda, número de cajas y desgaste. Una caja varía por
formato, etiqueta, posición de la cinta y tono. Nunca se instancia la misma combinación dos veces
seguidas.

---

## 8. LANDMARKS Y NAVEGACIÓN

Cada circuito necesita **cinco landmarks** como mínimo, cada uno con silueta propia — no el mismo
volumen con distinta decoración. El jugador se orienta por el escenario.

La señalización va **dentro del mundo**, no flotando: vinilos en el suelo de la tienda,
señalización logística en el almacén, cinta adhesiva en serigrafía, cartelería interna en oficinas,
cartelería de recinto en el salón. Las flechas flotantes genéricas se reducen al mínimo.

---

## 9. QA VISUAL

Tras integrar cada circuito se comprueba, en el propio juego: salida, primera curva, interior,
exterior, atajo, salto y meta. Se busca específicamente:

texturas estiradas · UV incorrecto · caras negras · z-fighting · assets flotando · halos en sprites ·
resolución insuficiente · repetición obvia · escala incorrecta · iluminación incoherente.

**Una mejora gráfica que baje el juego a 20 FPS no es una mejora.** El presupuesto medido de
triángulos y draw calls está en `V5_QUALITY_GATE.md` y se verifica en cada ejecución de los tests.

### Limitación honesta del QA actual

No hay navegador en el entorno de desarrollo, así que el QA visual **no se ha podido ejecutar**. Lo
que sí se verifica automáticamente: que los ficheros existen, sus dimensiones y canales, que el
manifiesto coincide con el disco, que la geometría tiene normales válidas e índices en rango, y que
el juego construye y sirve. La revisión en pantalla queda pendiente de una sesión con navegador.

---

## 11. INTEGRACIÓN: DE LOS FICHEROS A LA PANTALLA

Hornear los assets no era el objetivo; usarlos, sí. Esta sección describe cómo llegan al motor y
qué pasa cuando no llegan.

### La cadena

```
tools/assetgen  →  public/assets/**  +  assets.manifest.json
                            ↓
                   AssetCatalog (lee el manifiesto, precarga con progreso real)
                            ↓
        MaterialLibrary · BackdropDome · DecalScatter · KartBuilder
```

`AssetCatalog` es el único punto que traduce un id a una URL. No construye rutas a partir de
convenciones salvo en tres casos enumerados —livery, circuito y familia de decals—, y esos tres
están cubiertos por tests que comprueban que cada valor del enum resuelve a un fichero real del
manifiesto. **Ningún nombre de fichero se inventa: si no está en el manifiesto, `has()` dice que no
y el llamante cae al generador procedural.**

### Qué toma cada superficie del horno

| Capa | Base color | Normal | Roughness |
|---|---|---|---|
| Carteles de pared | atlas por circuito | — | — |
| Público y ambiente | atlas de rejilla, con alpha | — | — |
| Iconos de UI | atlas compartido, con alpha | — | — |
| Calzada y muros de circuito | del fichero nombrado por el tema | del fichero | del fichero |
| Props, kerbs, estructuras | color del tema (procedural, teñido) | del fichero de su clase | del fichero |
| Props (masa principal) | del fichero nombrado por el tema | del fichero | del fichero |
| Props (guarnición) | color del tema | de su clase | de su clase |
| Kart | livery si hay; si no, `primaryColor` | — | — |
| Fondo | panorama cilíndrico | — | — |
| Decals | RGBA proyectado sobre la calzada | — | — |

La distinción de la segunda fila es deliberada. Normal y roughness son independientes del color: una
pared magenta y una gris se comportan igual ante la luz, así que **todas** las clases toman esos dos
mapas del horno. El base color horneado sólo se usa donde un tema lo nombra explícitamente, de forma
que el `color` del tema nunca se convierte en configuración muerta.

### El fallback es real, no decorativo

Si el manifiesto no se puede leer, o una textura falla al descargarse, el generador procedural cubre
la superficie y la carrera arranca. Está comprobado en `apps/web/tests/catalog.test.ts`: con el
catálogo cargado y **ninguna** textura residente, cada material sigue siendo completo y conserva su
color. Perder el horno cuesta fidelidad, no la partida.

### Progreso de carga medido

La pantalla de carga leía `CARGANDO TALLER…` sobre una frase fija: decía lo mismo tardara 200 ms o
se quedara colgada para siempre. Ahora cada incremento corresponde a un asset que Babylon ha
reportado como cargado o fallado, el total es el número de ficheros que realmente se van a pedir, y
la etiqueta dice de qué tipo de asset se trata. **Si la barra se detiene, algo está genuinamente
detenido.**

### Estado: `baked`, no `integrated`

El manifiesto escribía `status: "integrated"` en sus 121 entradas mientras el juego seguía dibujando
todas las superficies con el generador procedural. Era falso. Ahora escribe `status: "baked"`, que es
lo único que el horno puede afirmar, y la accesibilidad desde el código se deriva aparte en
`tools/assetgen/audit.mjs` leyendo el fuente real.

Alcance medido: **143 de 143 ficheros** referenciados desde código de aplicación. Nada se hornea
para quedarse en disco.

Llegar al 100 % exigió dos cosas que valían la pena por sí mismas:

- **`materialClass` en un `PropSpec` era configuración muerta.** Los constructores de props
  ignoraban la clase que el tema declaraba y usaban una fija. Ahora cada prop distingue su *masa
  principal* —lo que el tema realmente está especificando cuando escribe
  `{ materialClass: "INK", kind: "BOX" }`: eso es un bidón de tinta— de su *guarnición*, cuyo
  material lo decide lo que la pieza es físicamente. Las camisetas colgadas de un percherío son
  tela sea el percherío de lo que sea; tomar la clase del tema ahí colgaría camisetas de madera.
- **Una fuente de malla por tipo *y estampado*.** El color por instancia permite que una malla
  sirva a seis colores, que es lo que salva el presupuesto de materiales. Un estampado horneado no
  se puede compartir así: el dibujo está en la textura. Dos props que difieren en estampado son dos
  fuentes; los que difieren sólo en color siguen compartiendo una.

---

## 12. FORMAS: SDF, ATLASES Y SPRITES

Las texturas de §2 TIPO D se describen bien como función por píxel: ruido, trama, agregado. Los
iconos, los carteles y las figuras **no**. Son *formas*, y una forma dibujada umbralizando ruido
parece exactamente eso.

`tools/assetgen/shapes.mjs` añade campos de distancia con signo. Compran tres cosas que este
pipeline no tenía manera de conseguir: bordes nítidos a cualquier resolución, antialiasing gratis
(la cobertura sale de la distancia, no de la rejilla de píxeles) y composición — unión, intersección
y resta son mínimo, máximo y negación, así que un icono es una expresión corta en lugar de una
rutina de rasterizado.

### Lo que se dibuja así

**23 iconos** — 13 de objeto y 10 de sistema. Sustituyen al hueco del HUD que imprimía la primera
letra del nombre del objeto: el T-Shirt Cannon, el Tape Trap y el Thread Boost eran los tres «T», y
la Sticker Mine y el Size Tag los dos «S». Cada icono es una silueta legible a 34 px con un solo
color de acento, dibujada a partir de los objetos del propio juego: una camiseta, una caja de envío,
una percha, una rasqueta.

**40 carteles** en cinco familias, una por circuito. Son ilustraciones originales con lenguaje propio:
gráfica editorial para la tienda, señalética cinética para el almacén, pruebas de tinta para el
taller, composición modernista para la oficina y energía de viñeta para la convención. El packer
procedural conserva una alternativa determinista si falta un máster.

**38 sprites** con alpha: público de convención y de tienda, plantas en maceta y
camisetas colgadas.

### Dos empaquetadores, porque hay dos consumidores

`packAtlas` empaqueta por estanterías con un canal de un píxel entre frames, y devuelve UV con medio
téxel de margen. Sin ese canal el filtrado bilineal muestrea el frame vecino, que es el halo que el
brief señala. Lo usan iconos y carteles.

`packGrid` empaqueta en rejilla uniforme sin canal. Lo pide `SpriteManager` de Babylon, que dibuja
miles de sprites billboard en **un** draw call y selecciona el frame por índice de celda — no sabe
leer un mapa de frames irregular. Ese draw call único es toda la razón por la que un hall de
convenciones puede estar lleno. Aquí el canal no hace falta porque cada sprite ya lleva su margen
transparente dentro de la celda, y eso está asertado.

### Coste

Un cartel es un quad cuyas UV se reescriben al frame; los quads que comparten diseño se fusionan. Una
pared de treinta carteles sacados de diez diseños cuesta como máximo **diez draw calls y un material**. El
público de 160 personas cuesta **uno**. El prop `CROWD` en 3D se mantiene con peso bajo para las
figuras pegadas a la pista, donde un sprite plano se delataría: modelado de cerca, sprites para la
masa, nada más allá del punto en que una persona son dos píxeles.

---

## 10. CRITERIO PARA `BoxGeometry`

Encontrar una caja en el código no implica un defecto. Lo que decide es la función:

| Uso | Veredicto |
|---|---|
| Caja de cartón, pared, panel, baldosa, marca de suelo | Correcto — con bisel donde sea un objeto |
| Mesa completa, ordenador completo, máquina, mueble | Incorrecto — necesita geometría diseñada |
| Kart, personaje | Incorrecto — necesita modelo |

Superficies de calzada y planos de señalización están exentos del bisel obligatorio.

---

## 13. EL MUNDO FUERA DE LA CARRETERA Y EL GRADO DE IMAGEN

Esta sección documenta la reconstrucción visual del 3 de septiembre de 2026. Existe porque cinco
defectos reportados —"sigue sin tener fondos completos", "debo poderme salir de la carretera", "los
elementos de background salen medio invisibles", "tiene partes que desaparecen los elementos" y "en
mobile se ve mal el texturizado"— resultaron tener **ocho causas concretas y localizables**, ninguna
de ellas un problema de assets. Los assets estaban bien; el mundo que los contenía, no.

### 13.1 No había suelo

Un circuito era una cinta de carretera con un muro a cada lado y un panorama detrás. Más allá de los
muros no había geometría de ningún tipo. De ahí salen dos quejas a la vez: el mundo parecía
incompleto *y* no se podía salir de la pista, porque no había a dónde salir.

`render/Terrain.ts` construye ahora tres cosas, en tres draw calls, en todos los niveles de calidad
incluido el más bajo:

| Elemento | Qué es | Por qué |
|---|---|---|
| **Arcén** (`verge`) | Banda conducible de 5 m a cada lado, con la misma superficie lofteada que la carretera y 2 cm por debajo | Hereda el alabeo y la elevación del eje exactamente. Una tira plana aparte se separaría en cada rasante. A la misma altura se leería como un cambio de pintura; mucho más baja, como un bordillo del que el kart se cae |
| **Campo** (`field`) | Un **heightfield** que sigue la elevación del trazado y cubre el circuito y 300 m más allá | El horizonte pasa a ser suelo contra cielo, no geometría que se termina. Por qué no es un plano: §13.1.1 |
| **Banda sonora** (`rumble`) | Bloques alternos instanciados en el borde del asfalto | Es lo que comunica el límite a velocidad. Un cambio de color no lo hace; una vibración que se ve, sí — el ojo lee la frecuencia del parpadeo como una tasa de avance |

`TerrainConfig` fija los tres números: `vergeMetres: 5`, `recoveryMetres: 12`,
`visualMarginMetres: 300`.

Los dos primeros son proporción de circuito, no gusto: los circuitos tienen carreteras de 11,7 a
14 m, y la regla es que la escapatoria de un lado no supere la **semianchura** de la carretera —
medida contra el circuito más estrecho (Office Chaos, 11,7 m), no contra el más ancho. Cinco metros
son dos anchos y medio de kart: suficiente para irse largo y volver, insuficiente para dejar de ser
una pista.

El tercero se deriva de la resolución del heightfield y del backdrop. La cúpula está a 820 m de la
cámara, y el borde del suelo tiene que quedar a menos de un grado del horizonte visto desde el ojo
del piloto (5,1 m sobre la pista) y **dentro** de los 820 m, porque la cúpula es relativa a la cámara
y un suelo que la atravesara lo haría de forma distinta cada fotograma. Con 300 el radio queda en
676 m: 0,43° bajo el horizonte. `tests/terrain.test.ts` asserta esas dos cotas, no el número.

#### 13.1.1 El plano plano: la regresión que se desplegó

La primera versión de este campo **era** un plano, colocado a la altura **media** del circuito, con
este razonamiento escrito al lado: *"el arcén se encarga de la altura local; el campo solo tiene que
ser plausible donde de verdad se ve, que es más allá del arcén"*. Todo en esa frase es cierto salvo
la conclusión, porque estos circuitos no son planos.

| Circuito | minY | maxY | Plano (media − 0,35) | Kart en meta | Ojo de cámara |
|---|---|---|---|---|---|
| T-Shirt Megastore | −3,6 | 15,5 | **4,48** | 0,42 → **debajo** | 5,12 → **encima** |
| Warehouse Express | −4,0 | 14,0 | 1,41 | 0,42 → debajo | 5,12 → encima |
| Ink & Print Factory | −4,0 | 12,0 | 0,88 | 0,42 → debajo | 5,12 → encima |
| Office Chaos | 0,0 | 10,0 | 3,84 | 0,42 → debajo | 5,12 → encima |
| Manga Mega Con | −5,0 | 18,0 | 2,55 | 0,42 → debajo | 5,12 → encima |

En el Megastore el plano quedaba **4,48 m sobre la línea de meta**, con el **61 % de la carretera
enterrada** debajo de una lámina opaca de más de un kilómetro. Y el reparto de alturas es lo que
convierte eso en el síntoma exacto que se reportó: `RaceCameraV5` pone el ojo en
`kart.y + 1.2 + 3.5`, y el kart rueda 0,42 m sobre el asfalto, así que **en los cinco circuitos el
kart quedaba debajo del plano y el ojo encima** — a 0,64 m en el Megastore. Un punto de vista rozando
una superficie lisa, sin vehículo propio y sin pista a la vista.

Se reportó como *"se ve en primera persona pero no hay una carretera definida… campo libre"*. Era una
descripción exacta del render: una sola causa explicando las tres cosas a la vez.

El campo es ahora un heightfield cuyo vértice toma la altura de la carretera **más baja** que tenga
cerca, no de la más cercana. Esa distinción es la segunda mitad del arreglo: estos circuitos se
cruzan sobre sí mismos —el Megastore salta sobre su propia planta, la nave corre pasarelas sobre los
pasillos—, y con la más cercana el suelo bajo un puente se construiría a la altura del tablero,
enterrando la carretera que pasa por debajo. El mismo fallo otra vez, local en lugar de global. El
mínimo garantiza que el suelo está en o por debajo de toda carretera próxima.

El radio de ese mínimo **se deriva del tamaño de celda de la malla**, no se elige aparte, y eso es lo
que hace que la garantía valga para lo que se dibuja y no solo para los vértices: la superficie entre
vértices es un parche bilineal, acotado por sus cuatro esquinas, así que basta con que el radio supere
la diagonal de la celda para que toda la celda quede bajo cualquier carretera cercana. Escribir el
radio como constante al lado de un número de celdas elegido por separado es exactamente cómo esa
garantía se rompe en la siguiente edición del margen.

Y el radio quiere ser lo más **pequeño** que la cota permita, porque es un mínimo sobre un disco: en
pendiente, la carretera más baja del disco está más abajo de la cuesta, y el suelo se hunde. A 45 m
la subida de Manga abría una zanja de **ocho metros** junto a la pista. A una celda y media son unos
dos.

`tests/ground.test.ts` fija las dos invariantes contra los cinco circuitos reales y contra el búfer
de vértices, no contra la función: el suelo nunca por encima de la carretera, nunca por encima del
ojo de la cámara, y hundido solo donde hay carretera genuinamente más baja cerca. La tercera tardó
dos intentos en enunciarse bien — *"el hundimiento es pequeño"* falla honestamente en el cruce de
Manga, donde el suelo **debe** bajar al nivel inferior; lo correcto es *"el hundimiento está
explicado por carretera más baja cercana"*, que sigue fallando ante una zanja de pendiente.

### 13.2 El corredor era un valor por defecto

`wallLeft` y `wallRight` tenían `?? true` en `blueprint.ts` y `path.ts`, y ningún blueprint los
declara. Todo nodo heredaba muro en ambos lados, así que `queryWall` paraba el kart en el borde del
asfalto y las entradas `GRASS`, `SAND` y `OFFROAD` de `SurfaceConfig` eran **código muerto**:
configurado, ajustado, documentado e inalcanzable.

Los muros siguen en `?? true`, y eso fue una decisión deliberada tras probar lo contrario: un
circuito sin muros es un plano infinito, que es peor que un pasillo — al menos el pasillo te dice
dónde está la pista. Lo que se movió es el límite. `queryWall` mide desde el borde del arcén:

```ts
const halfWidth = sample.node.width * 0.5 + TerrainConfig.vergeMetres;
```

Y la barrera visible se construye con nodos ensanchados en la misma cantidad, para que lo que el
jugador ve y lo que la física impone sean la misma línea. Con la barrera a 16 m, 1,1 m de altura era
un bordillo en el horizonte, así que pasa a 2,4 m.

Consecuencias que hubo que perseguir, y esta es la parte que no se ve venir: **todo lo que se
anclaba al borde del asfalto estaba de pronto dentro de la zona conducible**. El público a 7–16 m,
la vegetación, los props a 2,6–7,6 m y los landmarks a 9 m quedaban de pie en la escapatoria, sin
collider, para que un kart los atravesara. Todos ellos se miden ahora desde la barrera. La
escapatoria queda vacía, que es además como son los circuitos reales: run-off plano y limpio, y todo
lo que tiene silueta detrás de la barrera.

Y una segunda consecuencia, del heightfield: **fuera de la barrera el suelo tiene su propia
elevación**, así que anclar la decoración a `node.y` la deja flotando sobre una vaguada y hundida en
un talud. `Terrain` expone `heightAt(x, z)` —la misma función con la que se construyeron los
vértices, así que concuerdan por construcción y no por coincidencia— y público, vegetación, props y
landmarks se apoyan en ella.

### 13.3 El alabeo era una rampa infinita

`groundY` extrapolaba `tan(banking) * lateral` sin límite. Inofensivo mientras los muros hacían
inalcanzable el fuera de pista; una rampa al cielo en el momento en que se abrieron — cuarenta metros
fuera de una curva peraltada ponían el suelo a siete metros de altura. El alabeo se satura en el
borde del asfalto, que es también el aspecto de una escapatoria real.

### 13.4 La niebla borraba el mundo

**Esta era la causa principal de "los elementos de background salen medio invisibles", y no por poco.**

La escena usa `FOGMODE_EXP2`, cuya visibilidad cae como `exp(-(distancia · densidad)²)`. Las
densidades escritas llegaban a 0,013. Eso es:

| Distancia | Visibilidad a densidad 0,013 |
|---|---|
| 50 m | 65 % |
| 100 m | 18 % |
| 150 m | 2 % |

Contra un plano lejano de cámara de 900 m. Cada espectador, cartel y prop más allá de la siguiente
curva lo estaba borrando la atmósfera, y ningún trabajo sobre los assets podía notarse mientras eso
fuera cierto. La banda escrita 0,0018–0,013 se remapea a **0,00055–0,0021**, conservando el haze
*relativo* de cada zona — una escalera sigue siendo más densa que un escaparate — y dejando el otro
extremo de un circuito al 85 % de visibilidad en lugar de desaparecido.

`tests/lighting.test.ts` fija esto en términos de lo que ve el jugador, no de las constantes, porque
una densidad de niebla es un número pequeño en una fila de números pequeños y el fallo que provoca
parece contenido que falta, no un error de iluminación.

Los sprites vuelven a la niebla. Estaban con `fogEnabled = false`, defendible mientras la niebla era
lo bastante espesa para borrar a un espectador entero, pero eso dejaba al público como lo único de la
escena a pleno contraste a cualquier distancia: la grada lejana se leía como una calcomanía pegada
sobre el cuadro. El renderer de sprites de Babylon hace una pasada de profundidad con alpha test y
después una de color con blending, así que cien sprites siguen ordenándose bien entre ellos — el
parpadeo del que se culpaba a este flag nunca fue cosa de la niebla.

### 13.5 El relleno no modelaba nada

Con `fillIntensity` a 0,34–0,58 contra una `keyIntensity` de 1,6–3,2, todo lo que daba la espalda a
la luz principal caía a casi negro. Eso es una mirada fotográfica y es lo contrario de lo que
necesita un kart racer: **la referencia del género modela con tono, no con oscuridad** —principal
cálida contra relleno frío— y mantiene legible todo el cuadro, porque el jugador lee la pista a
velocidad y no puede permitirse el lado oscuro de nada.

- Relleno **+85 %**, con los colores de relleno elevados en valor y con algo más de croma.
- Rebote de suelo elevado igual.
- Suelo de `keyIntensity` en 2,15: la escalera y los probadores siguen siendo la parte oscura de la
  vuelta en términos relativos, sin ser un sitio donde no se ve.
- Los **tonos base** de las superficies oscuras subidos: la nave de impresión tenía la carretera al
  20 % de valor (`#2b2732`), que es el valor de una sombra, no de un suelo. Por debajo del 20 % no
  queda sitio para que un normal map o una variación de rugosidad se noten. Todos conservan tono y
  relación entre ellos; ninguno se desaturó para subirlo.

En el grado de imagen: `contrast` de 1,15 a **0,96** (por encima de una curva ACES que ya enrolla
las sombras, 1,15 las juntaba en un puré), `exposure` a 1,12, y `ColorCurves` con saturación global
+26 y **+38 en sombras** — la propiedad más reconocible de un kart racer luminoso es que nada en él
es gris: una sombra es una versión más fría y más saturada de la superficie, no una más oscura.

El **grano se apaga**. Estaba activo en los dos niveles altos para tapar banding en degradados
grandes. Era un mal cambio: el grano animado es una señal *de película* —dice fotografiado, cámara
en mano, real— y está directamente en contra de las superficies pintadas y limpias que busca este
restyling. El banding que tapaba lo resuelve mejor la subida de saturación, que da a esos degradados
croma con el que variar en lugar de solo luminancia.

El **SSAO baja a media fuerza**: a fuerza completa oscurecía cada pliegue y esquina, devolviendo
gris exactamente donde el relleno lo acababa de quitar. Media fuerza conserva para lo que sirve la
oclusión: decir al ojo que una caja *está apoyada* en el suelo y no flotando sobre él.

El **bloom** baja de umbral (0,86 → 0,78) y de peso (0,42 → 0,30): más fuentes brillando menos cada
una, un velo suave y ancho en lugar de unos pocos puntos calientes, que es a lo que se parece un
circuito iluminado.

### 13.6 El texturizado en móvil: cuatro causas, ninguna de ellas el móvil

1. **Casi todos los teléfonos caían a `LOW`.** La regla era `mobile && cores <= 4`; Safari limita
   `hardwareConcurrency` y muchísimos Android capaces reportan exactamente 4. Y en `LOW` los
   presupuestos de carteles, público, vegetación y decals eran **cero** y el filtrado anisotrópico
   estaba apagado. El teléfono no iba justo: se le estaba pidiendo renderizar un mundo vacío. `LOW`
   ahora significa lo que dice —un dispositivo que ha declarado ser pequeño— y `FrameMonitor` está
   para cazar al que resulte más lento de lo que declaró.
2. **Los presupuestos de `LOW` pasan de cero a reducidos.** Un público entero es *un* draw call a
   través del sprite manager; un cartel cuesta un draw call por *diseño*, no por cartel. Eran lo
   equivocado que recortar, y una pared desnuda es el ahorro más visible que existe.
3. **Filtrado anisotrópico a 1 en `LOW`.** Es la causa directa del texturizado sucio: una carretera
   se ve en ángulo rasante durante toda la carrera, que es precisamente el caso que el filtrado
   isotrópico no sabe resolver — el asfalto se convierte en puré gris unos metros más adelante. Es un
   ajuste de sampler, ni geometría ni fill rate, y en la única superficie que llena media pantalla es
   la mejora visual más barata disponible. Ahora 4 en `LOW`, 8 en el resto.
4. **Los mapas horneados estaban apagados en `LOW`.** Cuestan un fetch de textura por píxel sobre
   geometría ya dibujada, no draw calls, y son de 256 px. Quitarlos no ahorraba casi nada y costaba
   la lectura entera del material.

### 13.7 Las UV del suelo estaban en el rango equivocado

`MeshBuilder.CreateGround` reparte sus UV de 0 a 1 sobre todo el plano, mientras `MaterialLibrary`
escala sus texturas por `1 / tile` asumiendo **UV medidas en metros** —lo que la superficie de
carretera cumple y un plano de suelo no—. En un plano de casi un kilómetro, `tile: 10` pedía una
repetición de textura cada diez *kilómetros*: el suelo era un píxel estirado de color plano, sin
detalle a ninguna distancia. Estaba mal en escritorio también; solo se notaba menos, porque había más
decoración a la que mirar.

El arcén tenía la variante suave del mismo problema: `buildRoadSurface` escribe `u` de 0 a 1 a lo
ancho, lo que sale cuadrado en la carretera —cuyo ancho se parece a su tile length— pero el arcén es
tres veces más ancho, así que su textura iba estirada tres a uno justo donde mira un piloto que se
va largo. Ambas se reescriben en metros, y `tests/terrain.test.ts` lo fija comparando el rango de U
con el tamaño del plano.

### 13.8 El plano cercano de la cámara costaba el lejano

`minZ = 0.25` contra `maxZ = 900` es una relación de 3600:1, y la precisión de profundidad se
distribuye como `1/z`. En un depth buffer de 16 bits —lo que aún reparten bastantes contextos GL
móviles— eso deja menos de un metro de resolución a doscientos metros. Eso es z-fighting: carteles,
espectadores y props lejanos parpadeando contra las superficies que tienen detrás, que es "las partes
donde desaparecen los elementos", y es peor en teléfonos por exactamente esta razón.

Nada está nunca lo bastante cerca para que 0,8 recorte: es una cámara de persecución sobre un brazo
de ocho metros que nunca se acorta, a tres metros y medio de altura — por encima de las barreras que
podría atravesar. El metro cercano del frustum estaba vacío y costaba los quinientos lejanos.

### 13.9 El backdrop, otra vez

Documentado en la cabecera de `render/BackdropDome.ts`, resumido aquí porque es la última causa: la
cúpula estaba 73 m **por encima de la cámara** (Babylon implementa `infiniteDistance` como
`translation = position + cameraPosition`, así que `position.y` no la sube en el mundo, la sube
respecto al observador de forma permanente), abierta por abajo, y con radio 260 contra un plano
lejano de 900 — es decir, una burbuja de 260 m que ocluía todo cartel, espectador y prop más lejano
que eso. En una recta larga desaparecía media decoración.

Ahora: horizonte a la altura de los ojos (`position.y = 0`, el único valor posible — un cilindro mapea
V linealmente, así que el horizonte del panorama cae siempre en el centro geométrico), radio 820, y
tapa arriba. Abajo no necesita nada: el suelo llega a 120 m de la cúpula.

Un disco de suelo para la cúpula se escribió y se **descartó**: la geometría dice que un rayo que
baja lo bastante para alcanzarlo (más de 28°) choca antes con el plano de terreno, a unos metros de
la cámara. Era una malla que nunca se vería, y se quitó en lugar de dejarla dentro pareciendo útil.

### 13.10 Lo que sigue sin verificarse

No hay navegador en este entorno. Las causas anteriores se diagnosticaron leyendo el shader de
Babylon, el renderer de sprites y la implementación de `infiniteDistance` —no suponiéndolos— y cada
corrección tiene una prueba que falla si vuelve. Pero **nadie ha visto el resultado en pantalla**.
Los números de este restyling son juicios de dirección artística derivados de primeros principios
(la fórmula de la niebla, la relación de precisión de profundidad, la semántica de las UV), no de
frames observados.

La geometría de la cámara —altura 3,5 m, brazo 8,4 m, FOV base 62°— **no se ha tocado**. Un kart
racer del género de referencia usa una cámara más baja y más cerca, y bajarla reforzaría la sensación
de velocidad, pero es un cambio de jugabilidad además de visual (decide cuánto se ve de la curva
siguiente) y no hay forma de juzgarlo sin mirarlo. Queda como la propuesta pendiente más clara.

Lo que sí es verificable y está verificado: `npm run check` completo — lint, typecheck, 585 pruebas y
build de los cinco workspaces.
