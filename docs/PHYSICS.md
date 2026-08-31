# Física

`VehicleConfig` concentra aceleración, velocidades, frenada, steering, grip, drift, masa y boost. La simulación compartida es determinista sobre X/Z y usa un timestep fijo.

El cliente inicializa Rapier 3D para colisiones y cuerpos cinemáticos. El controlador raycast dinámico de Rapier queda como opción para la fase de física definitiva; no se ha mezclado todavía con la simulación autoritativa porque cliente y servidor deben integrar la misma trayectoria antes de activar reconciliación.

El circuito aplica slowdown fuera del asfalto y recoloca el kart desde el último recovery point si rebasa los bounds.
