# KART PAMPLING — DIRECCIÓN ARTÍSTICA

Documento normativo para todo asset visual del proyecto. Complementa `ART_BIBLE_V5.md`, que define
paletas, iluminación y proporciones; este documento define **cómo se producen los assets**: qué se
modela, qué se textura, qué se resuelve con sprite, con decal o con fondo, y con qué presupuesto.

---

## 0. ESTADO DE LAS CAPACIDADES — LEER PRIMERO

Este proyecto **no tiene ninguna herramienta de generación de imágenes por IA disponible** en el
entorno de desarrollo. Se verificó el 2026-09-02: no hay modelo de difusión, ni API de imagen, ni
conector gráfico. `DesignSync` produce sistemas de diseño en HTML, no arte rasterizado.

Consecuencia directa, y hay que tenerla presente al leer el resto:

| Clase de asset | Cómo se produce hoy | Estado |
|---|---|---|
| Materiales tileables | **Generación procedural offline** a fichero real | Resuelto |
| Decals (tinta, arañazos, suciedad, cinta) | Generación procedural offline con alpha | Resuelto |
| Wraps de kart | Generación procedural offline | Resuelto |
| Fondos panorámicos | Generación procedural offline | Resuelto |
| Geometría (karts, personajes, props, heroes) | Modelada por código con el toolkit de loft | Resuelto |
| **Ilustración**: pósters, portadas, merchandising ficticio | — | **Bloqueado** |
| **Sprites de público y NPC ilustrados** | — | **Bloqueado** |
| **Retratos de avatar estilizados desde foto** | — | **Bloqueado** |
| **Logotipos de marca reales** | No hay ficheros oficiales en el repo | **Bloqueado** |

Lo bloqueado necesita, o un modelo de imagen, o un artista, o los ficheros de marca. El pipeline
está construido para que en cualquiera de esos tres casos **sea sustituir un fichero**, sin tocar
código: cada asset tiene una entrada en el manifiesto, un nombre estable y un fallback.

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

Cuando exista capacidad de generación, todo prompt de asset arranca de esta base para que el set no
se disperse en cinco estilos:

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
planta. **Bloqueado hasta que exista generación de imagen** para la variante ilustrada; hoy el
público se resuelve con geometría simplificada instanciada (`PropLibrary.CROWD`).

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

Para lo que está lo bastante lejos como para que la geometría sea absurda. Skybox cilíndrico o
planos distantes con parallax. Generados proceduralmente como gradiente vertical más bandas de
silueta; la variante ilustrada está bloqueada.

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
| Panorama de fondo | 2048 × 1024 | RGB |
| Icono de UI | 128 | RGBA |

**Presupuesto de descarga:** los assets se cargan **por circuito**, nunca los cinco a la vez.

```
ALWAYS  (materiales compartidos)                          objetivo < 4 MB   real 3,47 MB
TRACK   (materiales propios + panorama + decals del tema) objetivo < 3 MB   real ≤ 1,90 MB
KART    (las liveries que hay en la parrilla)             —                 ≤ 0,95 MB
```

**Tres niveles, no dos.** La primera versión de esta tabla metía decals y wraps en `COMMON`, y el
manifiesto sólo tenía un campo `circuit`: todo lo que no pertenecía a un circuito contaba como
compartido. Eso daba 5,64 MB de "compartido" que **ningún jugador ha descargado nunca**, porque una
carrera se lleva un circuito, las cuatro o cinco familias de decals que ese tema esparce, y las
liveries de su propia parrilla — no las siete. El manifiesto lleva ahora un campo `download` con el
nivel, y `AssetCatalog.raceWeight()` calcula lo que de verdad se pide. Peor carrera medida:
**6,31 MB** en el taller de serigrafía, con cuatro liveries distintas.

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
    wraps/        kart_wrap_<nombre>_basecolor.png
    ui/           ui_icon_<nombre>.png
  tracks/
    <circuito>/
      backdrop_<circuito>_panorama.png
      materials/  mat_<clase>_<variante>_*.png
  assets.manifest.json
```

Nombres descriptivos y estables. Prohibido `image1.png`, `final2.png`, `new.png`,
`generated-image.png`. El nombre de un asset **no cambia** cuando se sustituye su contenido: eso es
lo que permite cambiar procedural por ilustrado sin tocar código.

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

Alcance medido: **133 de 133 ficheros** referenciados desde código de aplicación. Nada se hornea
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

## 10. CRITERIO PARA `BoxGeometry`

Encontrar una caja en el código no implica un defecto. Lo que decide es la función:

| Uso | Veredicto |
|---|---|
| Caja de cartón, pared, panel, baldosa, marca de suelo | Correcto — con bisel donde sea un objeto |
| Mesa completa, ordenador completo, máquina, mueble | Incorrecto — necesita geometría diseñada |
| Kart, personaje | Incorrecto — necesita modelo |

Superficies de calzada y planos de señalización están exentos del bisel obligatorio.
