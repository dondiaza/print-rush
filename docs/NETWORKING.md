# Networking

`RaceRoom` acepta un máximo de cuatro clientes. Su estado sincronizado incluye fase, circuito, vueltas, tiempo y estado mínimo de cada kart.

El mensaje `input` se sanea a rangos cerrados, exige secuencias crecientes y aplica rate limit. El servidor calcula posición, velocidad, vuelta, checkpoint y clasificación. Una desconexión no consentida reserva la identidad durante 25 segundos; después elimina el asiento.

Frecuencias centralizadas:

- input y simulación: 30 Hz;
- substeps objetivo de física: 2;
- patch de estado: 20 Hz;
- render cliente: `requestAnimationFrame`.

El despliegue de Vercel contiene el cliente. `game-server` requiere un servicio Node con WebSocket persistente y región europea.
