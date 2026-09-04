# Segunda revisión visual — “¿Qué sigue haciendo que parezca un prototipo?”

Revisión ejecutada después de la primera implementación, comparando las capturas existentes
`output/visualqa/*-final`/`store-pass-4` con `output/visualqa/ref100-*`.

## Problemas detectados y corrección

| Hallazgo en la primera pasada | Corrección aplicada | Resultado comprobado |
|---|---|---|
| ROAD y el suelo exterior se fundían, sobre todo en Flagship/Office | hombro continuo, mate y con color propio entre road y verge | visible sin cortes en desktop y 390×844 |
| demasiados props pequeños competían con los landmarks | separación 11→17 m, menor probabilidad y escala algo mayor | 28–64 mallas activas menos según mundo |
| landmarks de los cuatro sets compartidos parecían decorados laterales | marcos de 24,5×16,4 m y firmas +22–38 % | silueta reconocible en `06b-hero-aim.png` |
| el techo era una losa infinita sin horizonte | 4–7 naves instanciadas y 20–28 % de apertura real | backdrop/cielo y estructura cruzada visibles |
| no existía un plano de escala entre props y paredes | siluetas temáticas de 20–26 m cada 210 m | mayor ritmo far-layer con un source instanciado |
| el primer aumento de escala elevaba ruido/coste | scatter depurado y módulos fusionados | triángulos bajan 4,9–23,3 % en los cinco mundos |

## Lo que todavía conserva aspecto procedural

- La macroarquitectura sigue siendo una familia de naves generadas alrededor del bounding box; cada
  circuito necesitaría una topología exterior/interior completamente autorada para dejar de compartir
  ese parentesco.
- Los landmarks son geometría code-native fusionada. Ya tienen escala y jerarquía, pero no el nivel
  de modelado, decals únicos y acabado que aportaría un set de assets 3D art-directed por mundo.
- Karts y pilotos conservan el modelado estilizado existente; esta etapa los integra por contraste y
  luz, pero no sustituye sus modelos.
- Los panoramas actuales son fondos de catálogo existentes. Un pase propio por mundo elevaría mucho
  el horizonte sin copiar ninguna referencia.
- Las métricas de tiempo provienen de SwiftShader: sirven para comparar, no para declarar FPS de
  hardware real. Falta perfilado en un PC con GPU y en dispositivos iOS/Android físicos.

## Decisión de cierre

Los defectos corregibles de forma segura dentro del renderer actual se corrigieron y pasaron la
puerta completa. Reemplazar topología, karts o catálogo artístico sería una producción de assets
separada, no una corrección quirúrgica, y se mantiene como limitación explícita en lugar de simularla
con más cubos o materiales provisionales.
