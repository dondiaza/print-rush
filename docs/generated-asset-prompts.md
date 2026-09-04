# Print Rush — prompts del pase gráfico autorado

Registro del set generado el 2026-09-04. Las 100 referencias se usaron para extraer principios de
lectura —velocidad, profundidad, jerarquía, color y escala—, nunca para reproducir contenido.

## Marco común

Todos los prompts incluyeron este marco:

> Original visual asset for the Print Rush arcade racing universe. Stylized semi-realistic commercial videogame art, tactile screen-print materials, bold readable silhouettes, controlled Pampling palette, energetic but uncluttered composition. No text, letters, logos, brands, copyrighted characters, recognizable vehicles, franchise items, copied circuit geometry, UI or watermarks.

## Panoramas 360°

Cada salida se pidió como panorama cilíndrico equirectangular, con composición horizontal continua,
horizonte centrado, techo luminoso, base oscura, zona central sin objetos cercanos y cierre lateral:

| Salida | Variante añadida al marco común |
|---|---|
| `backdrop_store_panorama.webp` | flagship streetwear megastore, warm timber display architecture, charcoal bays, magenta/cyan/lime accents, distant clothing islands and atrium light |
| `backdrop_warehouse_panorama.webp` | immense fulfilment warehouse, blue-grey steel racks, loading docks, conveyor bridges, safety yellow and orange accents, cool daylight haze |
| `backdrop_screenprinting_panorama.webp` | monumental screen-print factory, carousel presses, drying tunnel, ink pipes, CMYK stations, violet UV glow, warm industrial haze |
| `backdrop_office_panorama.webp` | oversized creative studio, glass meeting pods, timber desks, pin-up walls, indoor planting, coral/cyan/green accents, daylight courtyards |
| `backdrop_manga_panorama.webp` | original graphic-art convention hall, truss stages, invented poster walls, dense stand silhouettes, magenta/cyan/yellow lighting, nocturnal event atmosphere |

## Atlas de cartelería

Las hojas se generaron como rejillas regulares, una composición distinta por celda, sin texto y con
canales claros entre diseños. Después se recortaron a los frames exactos del renderer.

| Salida | Rejilla y variante |
|---|---|
| `poster_store_atlas.webp` | 5×2 vertical; editorial streetwear, paper grain, brush, circles, halftone, cream/black/magenta/cyan/lime/orange |
| `poster_warehouse_atlas.webp` | 3×2 horizontal; kinetic logistics, abstract conveyors, cargo bays, chevrons, navy/yellow/orange/steel |
| `poster_screenprinting_atlas.webp` | 4×2 square; squeegee, roller, registration, ink splash, screen mesh, CMYK proof language |
| `poster_office_atlas.webp` | 3×2 horizontal; modernist creative-office collage, desks, plants, cursor geometry, cream/blue/orange/green |
| `poster_manga_atlas.webp` | 5×2 vertical; original comic energy, speed lines, torn paper, halftone bursts, empty speech shapes, neon CMYK on ink black |

## Sprites ambientales

Se pidió fondo croma uniforme y separación estricta entre celdas. El croma se convirtió después en
alpha suave, se eliminó spill y cada figura se ajustó dentro de una celda con margen transparente.

| Salida | Rejilla y variante |
|---|---|
| `sprite_crowd_shopper_atlas.webp` | 5×2; diez compradores adultos diversos, ropa gráfica casual, cuerpo completo, postura relajada |
| `sprite_crowd_attendee_atlas.webp` | 8×2; dieciséis asistentes adultos diversos celebrando, cuerpo completo, ropa de evento magenta/cyan/yellow/violeta |
| `sprite_hanging_shirt_atlas.webp` | 3×2; seis camisetas originales en percha, tejidos y gráficos abstractos diferenciados |
| `sprite_plant_atlas.webp` | 3×2; seis plantas de interior y macetas distintas, siluetas botánicas legibles |

## Wraps de kart

Cada imagen se pidió como textura cuadrada plana, sin vehículo ni mockup, sin iluminación horneada,
con detalle grande legible a velocidad. El procesado final iguala los cuatro bordes para UV wrap.

| Salida | Variante añadida |
|---|---|
| `kart_wrap_pampling_racing_basecolor.webp` | cream paper, black and hot-pink brush slashes, cyan and lime speckle, screen-print misregistration |
| `kart_wrap_wituka_surf_basecolor.webp` | teal wave rhythm, sand cream, coral sun and dark navy foam, energetic surf geometry |
| `kart_wrap_screenprint_cmyk_basecolor.webp` | paper white, cyan/magenta/yellow ink drops, black registration circles and mesh |
| `kart_wrap_warehouse_express_basecolor.webp` | navy steel panels, safety yellow chevrons, electric blue rails, orange clamps |
| `kart_wrap_comic_basecolor.webp` | ink black, magenta/cyan/yellow bursts, halftone dots and empty speech forms |
| `kart_wrap_retro_basecolor.webp` | midnight blue, warm cream, burnt orange, mustard and teal, bold 1970s racing geometry |
| `kart_wrap_neon_basecolor.webp` | near-black ground, violet/magenta/cyan luminous circuitry and sharp asymmetric energy bands |

## Salidas finales

Los 21 másteres se guardan bajo `apps/web/public/assets/`: 5 panoramas, 5 atlas de cartelería,
4 atlas de sprites y 7 wraps. `tools/assetgen/index.mjs` los captura antes de limpiar el directorio,
los restaura byte a byte durante `npm run assets:build` y usa el generador procedural si falta alguno.
