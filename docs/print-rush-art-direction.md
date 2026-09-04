# Print Rush — dirección artística de la transformación visual

## Tesis

**Una carrera atraviesa cinco mundos Pampling teatrales: volúmenes industriales redondeados, materiales táctiles ligados a la impresión y horizontes construidos por capas, con la pista siempre como protagonista.**

Las 100 imágenes del paquete se usan como referencias de lenguaje visual: composición, lectura de trazado, jerarquía, escala, luz, atmósfera y respuesta material. No se reproducen personajes, vehículos, iconos, logotipos, arquitectura singular ni trazados identificables de Nintendo.

## Jerarquía del fotograma

1. **Jugabilidad:** silueta del kart, rivales, siguiente curva y peligro inmediato.
2. **Ruta:** ROAD → SHOULDER → KERB → OFFTRACK → BARRIER debe distinguirse incluso con desenfoque, brillo alto o pantalla pequeña.
3. **Sector:** un umbral, una familia de luz y una masa arquitectónica permiten reconocer dónde se está sin leer el HUD.
4. **Mundo:** los hitos de gran escala y el fondo estratificado venden lugar, distancia y progresión.
5. **Detalle:** props, cartelería, desgaste y partículas enriquecen el plano, pero nunca compiten con la curva.

## Lenguaje propio

- Siluetas gruesas, chaflanes amplios y proporciones ligeramente sobredimensionadas.
- Materiales Pampling: tejido, tinta, papel, cartón, madera, acero pintado, goma, hormigón y pantallas impresas.
- El color intenso se concentra en guiado, hitos y maquinaria; el soporte arquitectónico permanece más neutro.
- La fantasía nace de la escala y del proceso creativo/industrial, no de copiar el contenido de las referencias.
- Cada sector tiene un verbo visual: exhibir, almacenar, imprimir, colaborar o celebrar.

## Los cinco mundos

| Mundo | Historia visual | Base | Acentos | Profundidad y luz |
|---|---|---|---|---|
| Flagship | tienda convertida en circuito de exposición | carbón cálido, crema, madera | magenta, cian, lima, naranja | islas de producto en primer plano, marcos de escaparate y aperturas cálidas |
| Warehouse | logística cinética de gran escala | acero azul gris, hormigón, cartón | amarillo seguridad, azul, naranja | racks/puentes en plano medio, docks y pórticos contra cielo frío |
| Print Factory | viaje completo por el proceso de estampación | grafito, epoxi, acero | CMYK y violeta | maquinaria heroica, conducciones continuas, vapor y luz UV/horno |
| Office | estudio creativo monumental | pizarra, madera, vidrio frío | coral, cian, verde | pods y mesas en primer plano, grandes pantallas y patios de luz |
| Manga Con | evento gráfico y eléctrico | tinta oscura, violeta, metal | magenta, cian, amarillo | stands y público por capas, truss, escenario y aperturas nocturnas |

## Geometría y legibilidad

- El asfalto/suelo de carrera forma una cinta continua, con marcas longitudinales que refuerzan velocidad.
- Un hombro continuo, materialmente distinto, separa la pista del run-off; los pianos indican curva y no decoración aleatoria.
- Los pórticos anticipan sectores antes de que una etiqueta sea legible.
- Los hitos se apoyan sobre una masa oscura grande para conservar silueta en entornos brillantes.
- El techo se divide en naves con aperturas reales: estructura cercana, cielo/fondo lejano y una referencia de escala intermedia.
- La densidad se expresa con masas grandes y repetición instanciada, no con cientos de objetos pequeños sin jerarquía.

## Iluminación, atmósfera y cámara

- Key y fill tienen contraste cromático, no zonas negras sin información.
- La niebla separa planos sin borrar la siguiente curva ni el hito del sector.
- Emisivos se reservan para señales, maquinaria activa y bordes críticos.
- La cámara chase debe mostrar suficiente carretera para decidir, mantener el kart dominante y dejar espacio superior a umbrales/hitos.
- La sensación de velocidad proviene de líneas continuas, repetición lateral, partículas locales y variación sectorial; no de sacudida permanente.

## Rendimiento y adaptación

- Geometría continua para pista/hombros; instancias para repetición; mallas fusionadas para hitos.
- LOW elimina partículas y parte del ritmo de fondo, pero conserva suelo, hombros, barreras, pórticos y una silueta heroica.
- Móvil reduce densidad y distancia, nunca el contraste funcional de ROAD/SHOULDER/KERB.
- Las aperturas de techo sustituyen superficie opaca: añaden profundidad sin multiplicar materiales o luces.

## Capa gráfica autorada

- Cinco panoramas 4096×2048 construyen un horizonte propio para cada mundo y cierran en 360°.
- Cuarenta carteles reparten lenguaje editorial, logística, tinta, estudio y cómic sin texto ni marcas copiadas.
- Treinta y ocho sprites ambientan tienda y convención con público, producto y vegetación sobre alpha.
- Siete wraps cambian de verdad la lectura del kart: brochazos, ola, registro CMYK, logística, viñeta, retro y neón.
- La producción queda en WebP y el bake preserva los másteres byte a byte; el contenido procedural es fallback.
- Las referencias se usaron sólo para principios de composición, ritmo, profundidad y legibilidad. Todo el arte es original del universo Print Rush.

## Criterio de éxito

Un fotograma sin HUD debe permitir reconocer el mundo, localizar la ruta y anticipar la siguiente decisión. Una vuelta debe sentirse como una secuencia de lugares, no como el mismo almacén recoloreado. La mejora se valida con comparativas desktop/móvil, los cinco temas, tests/build y métricas de escena.
