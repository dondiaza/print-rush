# Gameplay

El objetivo del vertical slice es priorizar tacto de conducción y legibilidad. El kart tiene aceleración progresiva, freno/reversa, steering dependiente de velocidad, off-road slowdown y recovery.

Mantener drift mientras se gira y se supera la velocidad mínima carga tres niveles. Al soltar se convierte en boost corto, medio o fuerte. Thread Boost y las placas del suelo usan el mismo límite acumulado para evitar velocidades absurdas.

Las vueltas solo avanzan tras atravesar todos los checkpoints en orden. La clasificación combina vuelta, checkpoint y progreso más cercano sobre el spline.

---

## SALTO, OBJETOS Y CÁMARA (2026-09-03)

Tres peticiones. Una era nueva, otra ya existía y la tercera era nueva pero destapó un fallo viejo.

### El salto

`ESPACIO`. Un salto corto y deliberadamente pequeño: 4,4 m/s de impulso vertical, 0,44 m de altura,
0,4 s en el aire.

**Esos números no son de gusto, son un conjunto.** `landingBoostMinAir` es 0,45 s y
`trickMinAirSeconds` es 0,42 s, así que un salto en llano **no llega a ninguno de los dos**: no da
boost al aterrizar y no permite armar un truco. Eso es el diseño entero. Si `hopSpeed` subiera lo
justo para pasar 0,45, saltar sin parar por una recta sería un boost gratis repetible y la forma más
rápida de dar la vuelta a cualquier circuito — sin ningún error en ninguna parte, y sin manera de
verlo en una revisión. `hop.test.ts` asserta la *relación* entre las tres constantes, no sus valores.

**Dónde sí vale: las rampas.** `launch()` ya no descarta la subida que el kart trae puesta; le suma
`hopRampBonus` (0,6) de ella. Un salto cronometrado para llegar al labio de la rampa todavía subiendo
vuela más alto y más tiempo — un tercio más de aire —, lo que pasa `landingBoostMinAir` con margen y
deja tiempo para armar un truco. Mal cronometrado, la rampa es solo una rampa: el `Math.max(0, …)`
sobre la velocidad vertical existente es lo que impide que aterrizar *sobre* una rampa de impulso
(velocidad vertical muy negativa) convierta un mal aterrizaje en un salto mayor.

Es emergente, no un caso especial. No hay ventana de tiempo codificada en ningún sitio: hay una suma.

#### Espacio ya era el drift, y eso no se arbitró: es la convención

Espacio estaba asignado al derrape. La colisión se resuelve como la resolvió este género hace
décadas: **es un botón cuyo significado lo da lo que está haciendo el kart**.

| Estado del kart | Lo que hace ESPACIO |
|---|---|
| En el suelo, sin girar o despacio | Salta |
| En el suelo, girando fuerte y rápido | Entra en derrape (que empieza con su propio saltito) |
| En el aire, recién salido de una rampa | Arma un truco |

Funciona sin arbitraje porque los tres lectores quieren cosas distintas de la tecla: `drift` es el
estado *mantenido*, `hop` es el *flanco* de pulsación, y `armTrick` solo mira el estado mantenido
mientras está en el aire. La entrada al derrape ya exigía girar más de `driftEntrySteer` y superar
`driftMinSpeed`, así que un toque en seco no hacía nada antes de esto.

Y no se apilan: `stepDrift` corre **antes** que `hop` dentro de `simulateKart`, y la entrada al
derrape ya pone `grounded` en false, así que en el fotograma en que arranca un derrape `hop` encuentra
el kart en el aire y no hace nada. Gana el salto del derrape. Sin esa garantía, girar en una curva
lanzaría el kart por los aires.

En táctil son dos botones, porque un dedo no puede mantener y tocar el mismo botón a la vez: `DRIFT`
se mantiene, `SALTO` se toca.

#### El fallo viejo que esto destapó

El primer test del salto falló: el kart no se despegaba del suelo. La causa no era nueva.

`resolveGround` trata como aterrizaje cualquier posición dentro de un epsilon de contacto de 6 cm. A
los 120 Hz que usa el runtime, un salto a 4,4 m/s avanza **3,7 cm** en su primer paso — dentro del
epsilon —, así que la función lo leía como un aterrizaje y ponía `verticalSpeed` a cero antes de que
llegara a salir del suelo.

**Y el salto del derrape llevaba roto igual desde siempre**: `driftHopImpulse` es 3,4 m/s, que avanza
2,8 cm por paso. Nunca se notó porque el saltito visible del derrape lo dibuja `hopTimer`, que es un
canal puramente visual — la física muerta no se veía. Se ve en el instante en que se conecta un botón
al impulso y no pasa nada.

Arreglado en `resolveGround`: **un kart que sube está despegando, no aterrizando**. Es seguro porque
un kart en el suelo tiene su `verticalSpeed` puesta a cero al final de esa misma función cada paso,
así que la única forma de estar dentro del epsilon *y* subiendo es un impulso aplicado ese fotograma.

### Los objetos: ya funcionaban

Esto no se ha construido, porque ya estaba entero: 5–6 filas de cajas por circuito → ruleta →
`heldItem` → `KeyE` (o el botón `ITEM`) → `ItemManager.use()`, que lanza proyectiles con guiado hacia
delante y tiro recto hacia atrás si se mantiene el freno. El HUD ya mostraba `E · <OBJETO>` al tener
uno.

Lo que faltaba era **descubrirlo antes de tenerlo en la mano**. La leyenda de controles de la pausa
no mencionaba el tiro hacia atrás con claridad ni las teclas nuevas; ahora lista las seis acciones.
Si al probarlo los objetos siguen sin funcionar, es un fallo distinto del que se pidió y hay que
mirarlo con lo que se vea en pantalla.

Sigue pendiente y **no** se ha tocado: los bots nunca usan objetos (`useItem: false`), y tampoco
saltan. El salto solo paga cronometrado contra el labio de una rampa, y cronometrarlo necesita un
modelo de la geometría de unos metros más adelante que `BotDriver` no construye; un bot saltando a
ciegas se vería peor que uno que no salta nunca.

### La cámara: primera y tercera persona

`V` o `C`, o el botón `1ª PERSONA` / `3ª PERSONA` del HUD — etiquetado con **a dónde lleva**, no con
lo que está activo, que es el que la gente pulsa bien la primera vez.

No es la misma cámara desplazada. Las diferencias que importan:

| | Persecución | Cabina |
|---|---|---|
| Posición | Brazo de 8,4 m, 3,5 m de alto, suavizada | Ojo del piloto a 1,46 m, **rígida al chasis** |
| Apunta a | La **línea de carrera** (`aimPoint`) | El **eje del chasis**, 40 m adelante |
| FOV | Base 62° | Base + 13° |
| Sacudida | Completa | La mitad |

Las dos primeras filas son las que no se pueden unificar:

- **Rígida, no suavizada.** Una cámara en primera persona que va por detrás del vehículo al que está
  atornillada se lee como latencia de entrada — la propia cabeza del jugador llegando un tiempo
  después que sus manos. La posición se escribe directa desde el kart, sin término de seguimiento.
  Lo único que queda suavizado es la mirada, y poco.
- **Apunta al chasis, no a la línea.** Mirar por la línea ideal es correcto desde detrás: mantiene la
  salida de curva a la vista mientras el kart va cruzado. Desde dentro es un fallo — una vista que
  ignora hacia dónde apunta el kart hace un derrape ilegible. `camera.test.ts` asserta exactamente
  esta diferencia, y es la aserción que rompería quien "simplificara" los dos caminos en uno.

El cambio es un **corte**, no una interpolación: los dos puntos están a once metros, y suavizar entre
ellos barrería la cámara a través del kart, la pista y lo que hubiera detrás durante casi un segundo.

El piloto se oculta en cabina —la cámara está justo encima de su cabeza— pero el kart no: el morro,
las ruedas delanteras y el volante quedan en cuadro, que es lo que evita que una primera persona se
sienta como una cámara flotando. Solo el del jugador; los rivales conservan el suyo.

`consumeViewToggle()` sale de la capa de entrada por su propia puerta y **no** está en `GameInput`.
Ese tipo es la entrada de simulación, saneada, enviada por red y reproducible; qué cámara mira un
jugador no cambia nada de la simulación, así que no debe viajar en el paquete, ni grabarse, ni tener
que acordarse entre clientes.

### Sin verificar

No hay navegador en este entorno. La física del salto está medida contra la simulación real —12
pruebas, incluidas las tres relaciones entre constantes— y la geometría de las dos cámaras contra un
`NullEngine` —10 pruebas—. Pero **nadie ha visto ninguna de las dos en pantalla**: ni si 0,44 m de
salto se siente "leve" con el kart en movimiento, ni si el ojo a 1,46 m deja el morro en un sitio
agradable, ni si el corte entre vistas molesta a velocidad. Son juicios derivados de las cifras.
