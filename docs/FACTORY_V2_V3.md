# 3D Factory V2/V3

## Superficies disponibles

| Ruta | Función |
| --- | --- |
| `/garage/character` | Personaje paramétrico, 30 peinados, cara/cuerpo/ropa, random, foto local, presets y JSON |
| `/garage/kart` | Cinco carrocerías, piezas, ruedas, pintura, decals, presets y JSON |
| `/factory/track` | Tres circuitos, spline generado por seed, anchura, complejidad, tema y uso directo en carrera |
| `/factory` | Asset Browser con personajes, karts, pistas y 50 props generados |
| `/admin/performance` | Diagnóstico de FPS/dispositivo y override de perfiles LOW–ULTRA |

Las definiciones guardadas son datos pequeños y versionados; la geometría se reconstruye de forma determinista. Personaje, kart y circuito activos se leen al arrancar la carrera. No se genera geometría en cada frame.

## Contratos

- `CharacterDefinition` y `KartDefinition`: schema 2, generator 2.0.0, migración, normalización, validación y hash estable.
- `PropDefinition`: schema 1, diez familias y catálogo base de 50 variaciones.
- `StoredTrack`: schema 2, 96 puntos, checkpoints/recovery automáticos y tres temas.
- El servidor valida tamaño, schema y colores antes de replicar cosméticos. En red viajan definiciones/hashes una vez al entrar, nunca por tick.

## Foto y privacidad

El flujo acepta JPEG, PNG o WebP hasta 10 MB, exige consentimiento y ofrece archivo o cámara iniciada por el usuario. MediaPipe Face Landmarker se ejecuta en un Web Worker cuando el navegador lo permite, con fallback local. Se verifican tamaño e iluminación; cero o varias caras producen mensajes recuperables.

La foto se mantiene únicamente como `ObjectURL` temporal, se revoca al reemplazarla/cerrar la vista y no se guarda ni se envía. El avatar conserva solo parámetros derivados y metadatos del análisis. Desde el Asset Browser puede exportarse la definición sin la fotografía original, y desde el garage puede borrarse el avatar.

## Rendimiento

- Perfil inicial por benchmark de capacidades, no por modelo de teléfono.
- Resolución dinámica durante carrera con cooldown para evitar cambios bruscos.
- LOD LOW/MEDIUM/HIGH/ULTRA para segmentos de malla y rivales.
- Barreras instanciadas, materiales compartidos, fixed timestep 60 Hz y física autoritativa 30 Hz.
- Controles teclado, táctil, auto-aceleración y gamepad con deadzone.
- PWA con shell offline, safe areas, reducción de movimiento y UI adaptable.

## Verificación

```bash
npm run check
```

La revisión manual debe cubrir creación/guardado de personaje y kart, selección de circuito, carrera con los tres activos, foto con consentimiento, móvil landscape, gamepad y el panel de rendimiento. El servidor se comprueba con `npm run dev:server` y `/health`.
