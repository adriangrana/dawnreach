# Dawnreach — Checklist de desarrollo

> Auditoría realizada el **2026-09-17** sobre la rama `game/dawnreach-core`.
> HEAD auditado antes de crear este documento: `52c7014187a8a1afc77b18187a265014eb0fc925` (`add audios`).
>
> Este archivo pretende ser la fuente de verdad rápida para saber qué existe realmente en código, qué está parcial y qué falta. El `README.md` conserva información útil, pero varias de sus secciones de estado quedaron por detrás del runtime actual.

## Leyenda

- [x] **HECHO** — existe una implementación funcional integrada en el runtime actual.
- [ ] **PARCIAL** — existe infraestructura o una primera implementación, pero todavía no debe considerarse cerrada.
- [ ] **PENDIENTE** — no se encontró una implementación completa en el runtime actual.
- [ ] **POSPUESTO** — deliberadamente fuera de la prioridad inmediata.

---

# Prioridad inmediata — siguiente vertical slice jugable

Estas son las tareas que más acercan Dawnreach a una partida MOBA completa, en este orden aproximado.

> **Decisión de diseño cerrada:** el layout actual de torres es definitivo. Dawnreach tendrá **2 torres por equipo en cada carril** (6 por equipo en total). No se añadirán más torres ni se ampliará ese layout.

- [x] **HECHO · Reloj real de partida en el HUD**, usando `nowMs - match.createdAtMs` y la fuente de tiempo pause-aware. El JSX conserva `00:00` solo como valor inicial antes de que el runtime sincronice el reloj.
- [x] **HECHO · Marcador superior de kills reales por equipo**, sincronizado desde el mismo estado que alimenta el scoreboard.
- [ ] **PARCIAL · K/D/A y scoreboard.** K/D/A local de Alden ya registra kills, deaths y assists desde eventos reales. Falta hacerlo autoritativo y genérico para los 10 héroes reales.
- [x] **HECHO · Destrucción del trono/núcleo enemigo convierte la partida en victoria/derrota.**
- [x] **HECHO · Estado terminal funcional de partida**, con overlay de victoria/derrota, bloqueo de reanudación y congelación de simulación/reloj. Falta integrar completamente `MatchState.phase = finished` y el flujo postpartida.
- [ ] **P0 · Sistema tipado y genérico de eventos de partida (`MatchEvent`)** como fuente única para kills, torres, objetivos, desconexiones, rachas y anuncios.
- [ ] **P0 · Kill/Event Feed superior derecho**, inspirado en la referencia visual aprobada: portrait atacante + nombre + icono de evento + nombre + portrait víctima; 5–6 entradas, fade/slide y separación del HUD superior.
- [ ] **P0 · Chat in-game TEAM / ALL**, con `Enter` para equipo, `Shift+Enter` para todos, historial y bloqueo de hotkeys de gameplay mientras se escribe.
- [ ] **P0 · Añadir reinicio/nueva partida local** sin tener que recargar manualmente toda la aplicación.
- [ ] **P0 · Crear al menos un héroe enemigo/bot funcional** para poder validar PvP local, aggro, kills, visión, CC, habilidades, score y respawn contra otro héroe.
- [ ] **P0 · Eliminar supuestos locales hardcodeados a Alden/Blue de los sistemas que deben ser genéricos.** El match model ya soporta 5v5, pero `App.tsx`, visión y algunos sistemas de mundo aún parten del héroe azul local.
- [ ] **P0 · Ampliar tests a los sistemas nuevos críticos** antes de seguir multiplicando contenido: torres, creeps, visión, items, teleport, muerte/respawn, objetivos, fin de partida, event feed y chat.
- [ ] **P1 · Iniciar migración de la plataforma TCL a Dawnreach** una vez cerrados Event Feed + Chat local: auth/sesiones → realtime/presence → social/party → matchmaking/ready → lobbies → hero select → loading → partida.

---

# 1. Runtime / arquitectura base

- [x] Proyecto Tauri + React + TypeScript + Three.js operativo.
- [x] Render principal 3D con cámara ortográfica isométrica.
- [x] Minimap renderizado con una cámara independiente.
- [x] Splash de carga hasta que mapa/HUD/assets principales estén preparados.
- [x] Registro genérico de `GameEntity` para héroes, creeps, torres, edificios, tiendas y criaturas neutrales.
- [x] Bridge de eventos de combate/mundo para sincronizar runtime 3D y estado de HUD.
- [x] Sistema de pausa de partida y tiempo de gameplay pause-aware.
- [x] Ajustes de rendimiento de renderer y actualización de sombras.
- [x] Invalidación de sombras tras cambios destructivos del mundo.
- [x] Limpieza/HMR de buena parte de los runtimes montados desde `main.tsx`.
- [ ] **PARCIAL · Ciclo de vida completo de partida.** El modelo conoce `lobby`, `hero_select`, `loading`, `in_progress` y `finished`; ya existe un runtime terminal funcional por destrucción del trono, pero el flujo visible sigue arrancando directamente en partida local y falta integrar la fase terminal en el `MatchState` principal.
- [ ] **PENDIENTE · Pantalla/flujo real de lobby.**
- [ ] **PENDIENTE · Pantalla/flujo real de selección de héroe.**
- [ ] **PENDIENTE · Flujo de loading de 10 jugadores/héroes.**
- [ ] **PARCIAL · Resultado y cierre de partida.** Victoria/derrota y congelación terminal ya funcionan; falta postpartida, persistencia y autoridad multiplayer.
- [ ] **PARCIAL · Disposal de recursos GPU.** Revisar geometrías/materiales/texturas compartidas y asegurar que todos se liberan al destruir la partida.
- [ ] **PARCIAL · Reducir acoplamiento HUD ↔ gameplay.** Algunos runtimes todavía observan el DOM para inferir eventos de juego; deben acabar consumiendo eventos/estado autoritativo.

# 2. Modelo de partida 5v5

- [x] Estructura de match preparada para exactamente 10 slots: 5 Dawn + 5 Dusk.
- [x] Modelo de jugadores con conexión, equipo, slot y héroe seleccionado.
- [x] Modelo de ownership jugador → héroe.
- [x] Validación estructural del estado de match.
- [x] Fases de partida definidas en tipos.
- [ ] **PARCIAL · Runtime actual solo materializa el héroe local Alden.**
- [ ] **PARCIAL · HUD superior tiene 10 huecos, pero 9 siguen siendo placeholders.**
- [ ] **PENDIENTE · Crear/instanciar los 10 héroes reales a partir del estado del match.**
- [ ] **PARCIAL · Estado K/D/A por jugador.** K/D/A local de Alden ya se registra; falta estado autoritativo de los demás jugadores.
- [x] **HECHO · Score por equipos en el header superior para el estado actualmente disponible.**
- [ ] **PARCIAL · Asistencia y atribución de kills multi-héroe.** La atribución local funciona; falta generalización autoritativa a 10 héroes.
- [ ] **PENDIENTE · Autoridad multiplayer/networking.** Actualmente el juego es esencialmente un runtime local.
- [ ] **PENDIENTE · Reconexión real a partida.**
- [ ] **PENDIENTE · Matchmaking/party/lobby online.** La implementación TCL existente será la base de esta capa.

# 3. Mapa de Dawnreach

- [x] Mapa 3D propio con bounds definidos.
- [x] Tres carriles: top, mid y bot.
- [x] Río central.
- [x] Cruces/puentes del río.
- [x] Caminos de jungla.
- [x] Vegetación procedural/instanciada.
- [x] Muros, ruinas, fortificaciones y landmarks.
- [x] Dos bases/citadels, Blue y Red.
- [x] Trono/núcleo visual en ambas bases.
- [x] Plataforma/base inicial y presentación de fuente/base.
- [x] Agua animada y efectos asociados.
- [x] Ocho claros de campamento neutral físicamente reservados en el layout.
- [x] Dos fosas/zonas de objetivo definidas en el layout.
- [x] Collision world del mapa.
- [x] Superficies navegables para órdenes del jugador.
- [x] **Layout definitivo de torres: 2 torres por equipo/carril, 6 por equipo en total.** No se añadirán más torres.
- [ ] **PARCIAL · Configuración/tiering de las torres existentes.** `towers.json` contiene datos T1–T4; cualquier ajuste debe aplicarse únicamente a las torres actuales, sin aumentar su número ni cambiar el layout definitivo salvo correcciones técnicas.
- [ ] **PARCIAL · Campamentos neutrales.** Los ocho campamentos tienen clearing, entrada, fogata y spawn points, pero no todos tienen criaturas/gameplay.
- [ ] **PENDIENTE · Definir/implementar criatura(s) para cada tipo de campamento neutral.**
- [ ] **PENDIENTE · Definir el segundo gran objetivo neutral si ambas fosas deben tener gameplay.**
- [ ] **PARCIAL · Validación final de navegación en todos los accesos, rampas, bases y campamentos.**

# 4. Movimiento, cámara y órdenes

- [x] Click derecho para movimiento.
- [x] Pathfinding sobre navegación del mapa.
- [x] Repath automático cuando una ruta queda bloqueada.
- [x] Recuperación ante rutas parciales/stuck.
- [x] Seguimiento de objetivo móvil durante ataque.
- [x] `A` / attack-move.
- [x] Dos modos de prioridad de attack-move: cercano al héroe / cercano al cursor.
- [x] `S` / Stop.
- [x] `H` / Hold Position.
- [x] Cadena de adquisición de objetivos durante attack-move.
- [x] Órdenes de movimiento/ataque desde minimapa.
- [x] Centrado de cámara en héroe.
- [x] Pan de cámara y controles configurables ya parcialmente conectados.
- [x] Drag/click del minimapa para cámara.
- [ ] **PARCIAL · Settings de cámara.** El menú contiene más opciones de las que actualmente consume el runtime.
- [ ] **PENDIENTE · Validar movimiento y órdenes con múltiples héroes simultáneos.**
- [ ] **PENDIENTE · Control de unidades invocadas/summons**, si el diseño final los incorpora.

# 5. Alden

- [x] Alden es el héroe H001 registrado en catálogo.
- [x] Stats base y escalados por atributos.
- [x] STR/AGI/INT y atributo principal.
- [x] Vida, maná, regeneración, armadura, resistencia mágica, AD, AS y rango.
- [x] Progresión hasta nivel máximo configurada.
- [x] Puntos de habilidad y rangos por nivel.
- [x] Pasiva `Voto del Muro Vivo` con stacks, ventana, daño bonus y curación.
- [x] Q `Avance de la Corona`: dash, cono, daño, slow y Cadencia.
- [x] W `Guardia de la Puerta Inquebrantable`: guardia frontal, reducción y lógica de represalia.
- [x] E `Cadencia del Rey de Hierro`: stacks por objetivo, AS, activa, daño y curación.
- [x] R `Juicio del León Coronado`: área, daño, juicio/taunt, Majestad, DR/tenacidad y reducción de Q/W.
- [x] VFX/runtime de mundo para las cuatro habilidades.
- [x] Cooldowns y gasto de recurso.
- [x] Upgrade de Q/W/E/R desde HUD.
- [x] Ataque básico funcional contra entidades del mundo.
- [x] Ataque enlazado con el sample de audio autorado existente.
- [x] Muerte y respawn con presentación en HUD.
- [ ] **PARCIAL · Animación/controlador de acciones.** Funciona, pero todavía conviene consolidar locomoción, ataques y habilidades en una máquina de estados/animación menos acoplada.
- [ ] **PARCIAL · Modelo/rig final premium.** El héroe actual sigue siendo una construcción procedural propia, no un pipeline final skinned/retargeted.
- [ ] **PENDIENTE · Tests de regresión completos para las interacciones Q/W/E/R contra héroe, creep, torre y boss.**
- [ ] **DEUDA TÉCNICA · El runtime de habilidades de Alden detecta casts observando cambios del DOM/HUD.** Sustituir por un evento de gameplay autoritativo para que habilidades, bots y multiplayer no dependan del HTML.

# 6. Combate general

- [x] Selección de entidades.
- [x] Entidades targeteables/no targeteables.
- [x] Ataque básico y windup/impact timing.
- [x] Rango de ataque.
- [x] Indicador de rango de ataque del héroe.
- [x] Daño físico/mágico/true definido en el modelo de combate.
- [x] Mitigación/estadísticas de combate del héroe.
- [x] Floating combat text.
- [x] Estados temporales y counters de runtime.
- [x] Muerte de entidades y publicación de eventos.
- [x] Respawn de héroe con tiempo dependiente del nivel.
- [x] Bloqueo de órdenes mientras el héroe local está muerto.
- [x] **K/D/A local de Alden registrado desde eventos reales y mostrado en HUD/scoreboard.**
- [ ] **PARCIAL · K/D/A genérico multi-héroe.** La lógica local ya cubre assists; falta autoridad compartida de los 10 héroes.
- [ ] **PENDIENTE · Héroe enemigo real para validar PvP completo.**
- [ ] **PENDIENTE · Recompensas completas por kill de héroe y distribución de asistencias.**
- [ ] **PENDIENTE · Revisión global de CC stacking, inmunidades, dispels y prioridades**, cuando haya más de un héroe.
- [ ] **PENDIENTE · Sistema genérico de proyectiles de héroes**, necesario para futuros héroes ranged.

# 7. Creeps de línea

- [x] Sistema de creeps de línea activo.
- [x] Tres líneas.
- [x] Ambos equipos.
- [x] Primera wave al iniciar.
- [x] Intervalo de waves configurado a 30 s.
- [x] Melee creeps.
- [x] Ranged creeps.
- [x] Flagbearer desde waves avanzadas.
- [x] Siege creep desde waves avanzadas.
- [x] Estados `ATTACK_MOVE`, `COMBAT`, `AGGRO` y `RETURNING`.
- [x] Acquisition range.
- [x] Leash/retorno a lane.
- [x] Separación/collisions de unidades.
- [x] Ataques de creeps y eventos de combate.
- [x] Last hits.
- [x] Denies de creeps aliados a vida baja.
- [x] XP/oro enlazados con progresión local.
- [x] Gestión de visión para waves.
- [ ] **PARCIAL · Balance definitivo de composición/timings/stats de waves.**
- [ ] **PENDIENTE · Validación de waves en una partida larga con todas las estructuras finales.**

# 8. Torres y estructuras

- [x] Torres como entidades seleccionables/atacables.
- [x] **Cantidad y distribución final de torres: 2 por equipo/carril, 6 por equipo.** Este layout es definitivo.
- [x] HP y stats de torre configurables desde `towers.json`.
- [x] Ataque automático de torre.
- [x] Selección/prioridad de targets.
- [x] Aggro por ataques hostiles.
- [x] Windup de adquisición.
- [x] Proyectil visual de torre.
- [x] Impacto/daño de torre.
- [x] Pooling/prewarm de proyectiles y efectos.
- [x] Aura de protección local de torre.
- [x] Datos/configuración para backdoor protection.
- [x] Tiers T1–T4 definidos en datos.
- [x] Tronos registrados como `attackable-structure`, con 5000 HP.
- [ ] **PARCIAL · Asignación/reglas de tiers sobre las torres existentes.** Si se mantienen T1–T4 en datos, deben alinearse con las torres actuales sin añadir torres nuevas.
- [ ] **PENDIENTE · Reglas de dependencia entre estructuras** si se desea impedir atacar estructuras internas antes de destruir las externas.
- [ ] **PENDIENTE · Recompensa individual/global por destruir torre.**
- [x] **HECHO · Victoria cuando el trono llega a 0 HP.**
- [ ] **PARCIAL · VFX/animación final de destrucción de trono y final de partida.** El overlay terminal existe; falta presentación final premium.
- [ ] **PENDIENTE · Decidir barracks/inhibitors y super-creeps**, si forman parte del diseño final de Dawnreach.

# 9. Jungla y objetivos neutrales

- [x] Ocho campamentos físicos colocados en el mapa.
- [x] Spawn points autorados en cada campamento.
- [x] Entradas libres y consideradas por collision/navigation.
- [x] Radiant Drake / Aurelios como criatura neutral seleccionable y atacable.
- [x] HP, daño, rango y ritmo de ataque de Aurelios.
- [x] AI de adquisición/represalia del boss.
- [x] Ataque con windup/impact.
- [x] Enrage por vida baja.
- [x] Recompensa de XP/oro al héroe que obtiene el objetivo.
- [x] Animación de ataque del Drake enlazada con gameplay.
- [ ] **PARCIAL · Boss death lifecycle.** Muere y desaparece; falta decidir respawn/timer/objetivo recurrente según diseño final.
- [ ] **PENDIENTE · Monstruos para los campamentos normales.**
- [ ] **PENDIENTE · Respawn y timers de camps.**
- [ ] **PENDIENTE · Leash/reset/regen completos para todos los neutrales.**
- [ ] **PENDIENTE · Buffs/recompensas estratégicas adicionales de objetivos.**
- [ ] **PENDIENTE · Segundo boss/objetivo para la otra fosa**, si forma parte del diseño final.

# 10. Progresión y economía

- [x] Oro del héroe.
- [x] Oro pasivo.
- [x] XP.
- [x] Niveles.
- [x] Last hits.
- [x] Denies.
- [x] Puntos de habilidad.
- [x] Upgrade de habilidades condicionado por nivel.
- [x] Sample de sonido autorado para ganancia de oro.
- [ ] **PENDIENTE · Economía de kills de héroe completa.**
- [ ] **PENDIENTE · Economía de torres/estructuras completa.**
- [ ] **PENDIENTE · Economía/team rewards de objetivos completa.**
- [ ] **PARCIAL · Balance global de oro/XP.** Solo debe cerrarse cuando exista una partida completa y medible.

# 11. Tienda e inventario

- [x] Catálogo de items separado por tiers/categorías.
- [x] Base de datos de items.
- [x] Tienda/HUD de compra.
- [x] Inventario de 6 slots principales.
- [x] Slot exclusivo de Pergamino de Teletransporte.
- [x] Teleport Scroll inicial en el slot dedicado.
- [x] Compra.
- [x] Venta.
- [x] Drag & drop entre slots.
- [x] Drop de objetos al mundo.
- [x] Pickup desde el suelo.
- [x] Gestión de inventario lleno.
- [x] Stacking de items que lo permiten.
- [x] Cooldowns de items activos.
- [x] Sistema de efectos activos en el mundo.
- [x] Slows de items.
- [x] Wards/items de visión.
- [x] Representación visual de items/wards en mundo.
- [x] Recetas/precios soportados por runtime.
- [ ] **PARCIAL · Tienda de equipo.** El world shop se inicializa actualmente con contexto Blue/local; falta convertirlo completamente a contexto de equipo/owner para 5v5 real.
- [ ] **PENDIENTE · Tests sistemáticos de todos los items y combinaciones de pasivas/activas.**
- [ ] **PENDIENTE · Balance final de items.**

# 12. Pergamino de Teletransporte

- [x] Item dedicado.
- [x] Slot dedicado.
- [x] Targeting mode.
- [x] Hotkey dedicado.
- [x] Selección de estructura/destino.
- [x] Canalización base.
- [x] Penalización por tráfico/teleports simultáneos configurada.
- [x] Cancelación/interrupción contemplada por el sistema.
- [x] Visuales de portal en origen y destino.
- [x] Ocultación/transición visual del héroe durante transferencia.
- [x] Landing/selection preview.
- [x] Warmup de geometría del portal durante boot.
- [ ] **PENDIENTE · Validar el sistema con varios héroes reales simultáneos.**
- [ ] **PENDIENTE · Audio definitivo de channel/complete/cancel.**

# 13. Visión / Fog of War

- [x] Vision sources por entidades.
- [x] Fog visual sobre mapa.
- [x] Resolución de visibilidad por posición.
- [x] Visibilidad de entidades enemigas.
- [x] Occlusion por vegetación/rocas/muros/elevación.
- [x] Confinamiento de visión dentro de bases.
- [x] Excepción de scouting mediante wards.
- [x] Estructuras persistentes en fog según política.
- [x] Wards integrados como fuentes de visión.
- [ ] **PARCIAL · Sistema actualmente construido desde la perspectiva Blue/local en `createDawnreachGame`.** Generalizar a equipo del jugador.
- [ ] **PENDIENTE · Validación completa Red/Dusk.**
- [ ] **PENDIENTE · Shared team vision real en multiplayer.**

# 14. Minimap y pings

- [x] Render live del mapa.
- [x] Cámara propia para minimap.
- [x] Icono específico de cabeza de Alden.
- [x] Ocultación del icono local al morir.
- [x] Viewport de la cámara principal dibujado sobre minimap.
- [x] Click/drag para mover cámara.
- [x] Órdenes desde minimap.
- [x] Ping wheel.
- [x] Presentación visual mejorada de pings.
- [x] Hotkey de danger ping.
- [ ] **PARCIAL · Iconos de héroes.** Solo Alden tiene integración real; faltan los otros nueve héroes.
- [ ] **PENDIENTE · Iconos/estados de todos los objetivos relevantes en minimap.**
- [ ] **PENDIENTE · Team pings transmitidos por red.**
- [ ] **PENDIENTE · Sonidos definitivos de cada tipo de ping.**

# 15. HUD / UI

- [x] HUD principal.
- [x] Retrato de héroe.
- [x] Nombre/clase.
- [x] Stats de combate.
- [x] STR/AGI/INT con atributo principal resaltado.
- [x] Vida/maná y regeneración.
- [x] Q/W/E/R con arte, cooldown, coste y rango de niveles.
- [x] Status bar/pasiva.
- [x] Inventario.
- [x] Oro.
- [x] Slot TP dedicado.
- [x] Minimap.
- [x] Slots superiores 5v5.
- [x] Overlay de respawn.
- [x] Scoreboard overlay.
- [x] Shop overlay.
- [x] Selección/HUD de otras entidades.
- [x] Nombre de unidad seleccionado relocalizado en el bloque central.
- [x] FPS overlay.
- [x] Escalado responsive del HUD.
- [x] Menú F10.
- [x] Menú de opciones con disponibilidad explícita por setting.
- [x] **Match clock real y pause-aware.** `ScoreboardOverlay` sincroniza el reloj superior con el tiempo real de partida.
- [x] **K/D/A local de Alden mostrado en HUD y scoreboard.**
- [x] **Match header con score real del estado de scoreboard disponible.**
- [ ] **PARCIAL · K/D/A completo.** Localmente ya existen assists; faltan estadísticas reales/autoritativas de los demás héroes.
- [ ] **PARCIAL · Team portraits.** Alden es real; los demás son placeholders por inicial.
- [ ] **PENDIENTE · Objective timers reales.**
- [x] **HECHO · Pantalla/overlay de victoria/derrota terminal.**
- [ ] **PENDIENTE · Pantalla postpartida.**
- [ ] **PENDIENTE · Kill/Event Feed superior derecho.**
- [ ] **PENDIENTE · Chat in-game TEAM / ALL.**

# 16. Settings / controles / accesibilidad

- [x] Persistencia local de settings.
- [x] UI de settings.
- [x] Marcado explícito de settings implementados vs roadmap.
- [x] Keybinds configurables para habilidades y controles principales.
- [x] UI scale.
- [x] HUD opacity.
- [x] Minimap scale/side/icon scale.
- [x] Toggle de nombres/barras/status/cooldowns/FPS.
- [x] High contrast.
- [x] Visual pings.
- [x] Parte de camera pan/edge pan.
- [x] Parte de graphics runtime: render scale/frame limit/shadows.
- [ ] **PARCIAL · Gameplay settings.** Muchas opciones visibles todavía no tienen consumidor real.
- [ ] **PARCIAL · Camera settings.** Zoom/follow/smoothing y otras opciones siguen como roadmap.
- [ ] **PARCIAL · Graphics settings.** Presets, AA, AO, bloom, reflections, weather, post-process, etc. no están todos conectados.
- [ ] **PARCIAL · Audio settings.** El runtime de Alden lee master/effects, pero el menú todavía debe reflejar con precisión qué buses/canales existen realmente.
- [ ] **PARCIAL · Accessibility.** Reduced motion, reduce flashes, subtitles, screen reader hints, etc. aún no están todos implementados.
- [ ] **PENDIENTE · Network/social settings reales**, dependientes de multiplayer.

# 17. Audio

- [x] Runtime de audio montado para Alden.
- [x] Respeto de volumen master/effects en el runtime actual.
- [x] Sample autorado de ataque básico.
- [x] Sample autorado de ganancia de oro.
- [ ] **POSPUESTO · Librería premium completa de SFX.** No rellenar con sonidos de baja calidad solo por completar casillas.
- [ ] **POSPUESTO · Q/W/E/R de Alden con SFX definitivos.**
- [ ] **POSPUESTO · Pasos/superficies.**
- [ ] **POSPUESTO · Torres.**
- [ ] **POSPUESTO · Creeps.**
- [ ] **POSPUESTO · Teleport.**
- [ ] **POSPUESTO · Pings.**
- [ ] **POSPUESTO · UI/Shop/Level up.**
- [ ] **POSPUESTO · Ambiente del mapa.**
- [ ] **POSPUESTO · Música dinámica.**
- [ ] **POSPUESTO · Announcer/voicelines.**

# 18. Arte / presentación

- [x] Estilo visual low-poly/fantasy propio consolidado en mapa.
- [x] Materiales y geometría procedural del mapa.
- [x] Agua/río.
- [x] Bases/citadels.
- [x] Torres con material visual trabajado.
- [x] Radiant Drake con modelo/animación propios.
- [x] Alden con modelo propio y portraits/iconos.
- [x] Arte individual de habilidades de Alden.
- [x] Splash de carga.
- [ ] **PARCIAL · Alden final.** Seguir refinando anatomía, silueta, animación y pipeline de modelo a medida que el gameplay se estabilice.
- [ ] **PENDIENTE · Assets de los siguientes héroes.**
- [ ] **PENDIENTE · Variantes visuales suficientes para neutrales/camps.**
- [ ] **PARCIAL · Presentación final de destrucción/victoria.** Existe overlay funcional; falta acabado visual premium de destrucción/fin de partida.

# 19. Tests / QA / estabilidad

- [x] Test suite existente para Alden.
- [x] Tests de gameplay/data.
- [x] Tests de navegación.
- [x] Scripts de verificación separados para Alden/HUD/mapa.
- [x] `npm run build` definido con `tsc -b && vite build`.
- [ ] **PARCIAL · `npm test` no cubre la mayoría de sistemas añadidos recientemente.** Actualmente ejecuta principalmente Alden + gameplay-data + navigation.
- [ ] **PENDIENTE · Tests de lane creeps.**
- [ ] **PENDIENTE · Tests de tower combat/aggro/backdoor.**
- [ ] **PENDIENTE · Tests de hero death/respawn.**
- [ ] **PENDIENTE · Tests de items/shop/inventory.**
- [ ] **PENDIENTE · Tests de Teleport Scroll.**
- [ ] **PENDIENTE · Tests de wards/vision/fog.**
- [ ] **PENDIENTE · Tests del Radiant Drake.**
- [ ] **PENDIENTE · Tests de victoria/derrota y estado terminal.**
- [ ] **PENDIENTE · Tests del MatchEventBus/Event Feed/Chat.**
- [ ] **PENDIENTE · Test de soak de partida larga** para detectar fugas, acumulación de entidades y degradación de rendimiento.
- [ ] **PENDIENTE · Integrar `verify-hud.mjs` y `verify-map.mjs` en una validación local clara** sin depender de GitHub Actions.

# 20. Distribución / desktop

- [x] Base Tauri presente.
- [x] `tauri:dev` y `tauri:build` definidos.
- [ ] **PARCIAL · Configuración final de bundling/distribución.** Revisar antes de preparar builds públicos.
- [ ] **PENDIENTE · Versionado único y consistente entre package/app/Tauri.**
- [ ] **PENDIENTE · CSP y hardening final de desktop.**
- [ ] **PENDIENTE · Instalador/release reproducible para Windows.**
- [ ] **PENDIENTE · Crash reporting/telemetry reales**, si se decide utilizarlos.

# 21. Multiplayer / backend — fase posterior

No debe bloquear el vertical slice local, pero sí es obligatorio antes de considerar Dawnreach un MOBA 5v5 real.

- [ ] **PENDIENTE · Modelo de autoridad servidor/host.**
- [ ] **PENDIENTE · Sincronización de héroes, creeps, torres, items y objetivos.**
- [ ] **PENDIENTE · Input/command replication en vez de replicar transforms sin autoridad.**
- [ ] **PENDIENTE · Prediction/reconciliation/interpolation.**
- [ ] **PENDIENTE · Team vision/fog autoritativo.**
- [ ] **PENDIENTE · Transporte de pings/chat por red.** La UI y contrato local del chat deben existir antes.
- [ ] **PENDIENTE · Matchmaking/party.** Se migrará desde TCL en vez de reimplementarlo desde cero.
- [ ] **PENDIENTE · Reconnect.** La recuperación de sesión de TCL será una base, pero el rejoin de gameplay necesitará lógica propia de Dawnreach.
- [ ] **PENDIENTE · Protección mínima contra manipulación del cliente.**
- [ ] **PENDIENTE · Métricas de red/ping/packet loss reales.**

# 22. Comunicación y eventos dentro de partida

> **Decisión de arquitectura:** chat y feed de eventos son sistemas distintos. Los eventos de gameplay deben ser datos tipados; el texto visible se resuelve en presentación para permitir localización, replay e integración multiplayer sin acoplar lógica de combate al HUD.

- [ ] **P0 · Crear `MatchEvent` / `MatchEventBus` genérico y data-driven.** Debe transportar IDs/teams/timestamps y datos semánticos, nunca frases ya renderizadas.
- [ ] **P0 · Emitir `hero_killed` desde el combate real**, con killer, victim, assists y método/origen de daño cuando esté disponible.
- [ ] **P0 · Emitir `tower_destroyed`, `objective_killed`, `player_disconnected`, `player_reconnected`, `match_paused`, `match_resumed` y `throne_destroyed`.**
- [ ] **P1 · Añadir eventos derivados de alto valor:** `first_blood`, double/triple/multi kill, killing spree, shutdown y avisos críticos del trono.
- [ ] **P0 · Kill/Event Feed superior derecho.** Diseño aprobado: dejar altura respecto al HUD superior; cada fila muestra portrait atacante + nombre + icono de evento + nombre + portrait víctima. Fondo oscuro/metal/piedra translúcido, Dawn cyan, Dusk carmesí, máximo 5–6 filas, expiración con fade/slide.
- [ ] **P1 · Banners centrales para eventos mayores** (`PRIMERA SANGRE`, multikill, objetivo mayor, trono bajo ataque), separados del feed compacto.
- [ ] **P0 · Chat in-game con canales `TEAM` y `ALL`.** `Enter` abre Team; `Shift+Enter` abre All.
- [ ] **P0 · Bloquear hotkeys/órdenes de gameplay mientras el input del chat tenga foco.**
- [ ] **P0 · Contrato de mensaje preparado para red:** `messageId`, `playerId`, `team`, `channel`, `text`, `atMs`.
- [ ] **P1 · Historial expandible, timestamps opcionales y persistencia solo durante la partida.**
- [ ] **P1 · Mute por jugador / ocultar All Chat / rate limiting.**
- [ ] **P1 · Multiplayer: TEAM solo a los 5 aliados y ALL a los 10 jugadores.**
- [ ] **P1 · Autoridad: clientes nunca pueden fabricar eventos de gameplay como kills/torres/objetivos; esos eventos deben originarse en la simulación autoritativa.**

# 23. Migración de TCL → plataforma nativa de Dawnreach

> **Fuente:** `adriangrana/tlc`, rama `feature/tcl-platform-mvp`.
>
> **Objetivo:** reutilizar la plataforma competitiva ya desarrollada, pero integrada dentro del mismo producto/repo de Dawnreach. Se elimina por completo la frontera externa con Warcraft III/GHost. Dawnreach seguirá necesitando un backend para cuentas, presence, matchmaking y coordinación de partidas, pero cliente, plataforma y gameplay pertenecerán al mismo producto.

## 23.1 Reutilizar casi directamente

- [ ] **P1 · Portar servidor TypeScript y estructura HTTP/WebSocket de TCL** a `server/` de Dawnreach.
- [ ] **P1 · Portar registro/login/logout y modelo de cuentas.**
- [ ] **P1 · Portar `AuthManager`: sesiones con TTL absoluto/idle, revocación, auditoría y recovery.**
- [ ] **P1 · Portar password policy y auth rate limiting.**
- [ ] **P1 · Portar almacenamiento seguro de bearer token en Tauri/Windows Credential Manager**, renombrando namespace TCL → Dawnreach.
- [ ] **P1 · Portar presence online/offline/queue/ready/lobby/in-game.**
- [ ] **P1 · Portar sistema social: búsqueda, solicitudes de amistad, amistades y mensajes privados.**
- [ ] **P1 · Portar parties de hasta 5 jugadores**, líder, invitaciones y mantener party unida en matchmaking.
- [ ] **P1 · Portar matchmaking Normal/Ranked**, ready-check, ventana MMR expandible y balance 5v5 respetando parties.
- [ ] **P1 · Portar lobbies personalizados públicos/privados**, código de invitación, owner, equipos y slots 5v5.
- [ ] **P1 · Portar calibración/MMR/ranking/historial de partidas**, adaptando nombres, reglas y telemetría a Dawnreach.
- [ ] **P1 · Portar persistencia competitiva/PostgreSQL y migraciones útiles.**
- [ ] **P2 · Portar updater/release policy de Tauri** una vez estabilizada la plataforma.

## 23.2 Adaptar a conceptos propios de Dawnreach

- [ ] **P1 · Sustituir teams `red/blue` de TCL por el naming canónico Dawn/Dusk** sin romper la abstracción interna de equipos.
- [ ] **P1 · Sustituir el callback `onLaunch(match)` que antes lanzaba GHost/Warcraft por `DawnreachMatchCoordinator`.**
- [ ] **P1 · Flujo de matchmaking:** cola → ready check → match creado → `hero_select` → `loading` → `in_progress`.
- [ ] **P1 · Conectar los 10 jugadores/slots del backend con el `MatchState` 5v5 ya existente en Dawnreach.**
- [ ] **P1 · Implementar selección real de héroes usando el hero catalog de Dawnreach.**
- [ ] **P1 · Implementar loading de los 10 clientes y readiness antes de comenzar la simulación.**
- [ ] **P1 · Sustituir la telemetría Q51 por estadísticas nativas emitidas por Dawnreach:** K/D/A, nivel, LH/DN, net worth, GPM/XPM, hero/tower damage, healing, wards, objetivos, etc.
- [ ] **P1 · Conectar `throne_destroyed` / resultado autoritativo de Dawnreach a historial, W/L y MMR.**
- [ ] **P1 · Diseñar pantalla postpartida reutilizando el modelo de Match Details de TCL pero con identidad Dawnreach.**
- [ ] **P2 · Reconnect real:** reutilizar sesión/reattach de TCL y añadir snapshot/rejoin de la simulación Dawnreach.

## 23.3 No migrar / eliminar del diseño nuevo

- [x] **NO MIGRAR · GHost / `ghostpp-rs`.**
- [x] **NO MIGRAR · W3GS relay / LAN advertisement / Warcraft autojoin.**
- [x] **NO MIGRAR · Búsqueda o lanzamiento del ejecutable de Warcraft III.**
- [x] **NO MIGRAR · `.w3x`, SHA/map verification de Warcraft y descarga/instalación del mapa.**
- [x] **NO MIGRAR · HCL / comandos de lobby GHost (`!ready`, `!mode`, etc.).**
- [x] **NO MIGRAR · Q51 / PreloadGen / action records / rawcodes de Dota.**
- [x] **NO MIGRAR · `connector.rs` y transporte específico Warcraft.**
- [x] **NO MIGRAR · HostAdapter basado en procesos externos por partida.** Será reemplazado por la arquitectura de sesión/servidor de gameplay propia de Dawnreach.

## 23.4 UI / identidad

- [ ] **P1 · No copiar visualmente la UI TCL.** Reutilizar lógica/estado/componentes útiles, pero rehacer presentación con identidad Dawnreach.
- [ ] **P1 · Shell prepartida Dawnreach:** Login, Home, Jugar, Social, Ranking, Perfil.
- [ ] **P1 · Superficie Party/Matchmaking/Ready.**
- [ ] **P1 · Lobby personalizada Dawn/Dusk.**
- [ ] **P1 · Hero Select.**
- [ ] **P1 · Loading screen multiplayer.**
- [ ] **P1 · PostMatch.**
- [ ] **P1 · Refactorizar la lógica que en TCL vive concentrada en un `App.tsx` grande** hacia providers/runtimes independientes (`Auth`, `Realtime`, `Social`, `Party`, `Matchmaking`, `MatchSession`).

## 23.5 Orden recomendado de migración

- [ ] **Fase A · Auth + servidor + WebSocket + shell Dawnreach.**
- [ ] **Fase B · Presence + Social + Party.**
- [ ] **Fase C · Matchmaking Normal/Ranked + Ready Check.**
- [ ] **Fase D · Custom Lobbies 5v5.**
- [ ] **Fase E · Hero Select + Loading conectados a `MatchState`.**
- [ ] **Fase F · Game session multiplayer / authoritative networking.**
- [ ] **Fase G · Resultado nativo → historial/MMR/postpartida/reconnect.**

---

# Deudas técnicas concretas detectadas en esta auditoría

- [ ] `App.tsx` todavía contiene constantes y assets directamente ligados a Alden (`LOCAL_WORLD_HERO_ENTITY_ID`, portraits y arrays de team placeholders). Llevarlo progresivamente a datos de `MatchState`/hero catalog.
- [ ] `createDawnreachGame()` crea el `VisionSystem` con equipo `'blue'` fijo. Debe recibir el equipo/perspectiva local.
- [ ] `registerAuthoredMapEntities()` inicializa varias estructuras con targetability pensada desde Blue/local. Generalizar para ambos lados.
- [ ] `ensureWorldShopSystem(..., 'blue')` mantiene una perspectiva de tienda local Blue; convertir a owner/team context.
- [ ] `AldenWorldRuntime` utiliza `MutationObserver` del HUD para descubrir casts. Reemplazar por eventos de habilidad emitidos desde el gameplay state.
- [x] El match score superior ya no está hardcodeado funcionalmente; se sincroniza con el estado de scoreboard disponible.
- [ ] El reloj funciona, pero hoy `ScoreboardOverlay` actualiza imperativamente el nodo `.match-clock b`; cuando se desacople HUD/gameplay conviene pasarlo a render declarativo.
- [ ] K/D/A local ya incluye assists, pero el K/D/A multi-héroe todavía no tiene atribución autoritativa.
- [x] `getLaneTowerSites()` representa el layout final aprobado: 2 torres por equipo/carril. No añadir más torres.
- [ ] Si se mantienen tiers T1–T4 en datos, alinear su configuración con las torres existentes sin modificar cantidad ni distribución.
- [ ] Los campamentos neutrales están mayormente en fase de escenario/spawn points; falta gameplay de criaturas y respawn.
- [ ] El modelo `MatchState` está preparado para 10 slots, pero el world runtime todavía no está derivado de ese estado de forma genérica.
- [ ] El final de partida funcional todavía debe integrarse declarativamente con `MatchState.phase = finished` y el flujo postpartida.
- [ ] La cobertura de tests quedó por detrás del volumen actual de sistemas.
- [ ] El `README.md` debe actualizarse cuando se cierre el siguiente bloque importante; varias de sus listas de “pendiente” ya no describen el estado actual.

---

# Definición del próximo hito sugerido

## Hito: “Partida local completa 1v1 + lanes”

Considerar este hito terminado cuando se cumpla todo lo siguiente:

- [x] Layout final de torres mantenido: 2 torres por equipo/carril; no añadir más.
- [ ] Si se usan tiers diferenciados, asignarlos/configurarlos sobre las torres actuales sin alterar el layout.
- [ ] Waves funcionando durante una partida larga sin degradación evidente.
- [x] Alden Blue jugable.
- [ ] Un héroe Dusk controlado por bot básico y usando el mismo modelo genérico de entidad/héroe.
- [ ] Ambos héroes pueden dañarse, morir, otorgar kill y reaparecer.
- [ ] **PARCIAL · K/D/A real:** K/D/A local funciona; falta multi-héroe autoritativo.
- [x] Marcador real de kills por equipos en el header superior para el estado disponible.
- [x] Reloj real de partida, pause-aware.
- [ ] XP/oro/levels reales durante toda la partida.
- [ ] Tienda e inventario funcionales para la perspectiva de ambos equipos.
- [ ] Fog/visión correcto desde Blue y Dusk.
- [ ] Torres y creeps atacan correctamente a ambos equipos.
- [ ] Trono protegido/desprotegido según las reglas finales de estructuras.
- [x] Destruir el trono termina la partida.
- [x] Overlay de victoria/derrota.
- [ ] Reiniciar partida funciona.
- [ ] Tests de regresión del loop principal.

Cuando este hito esté cerrado, Dawnreach ya tendrá un **loop de partida MOBA local completo** sobre el que será mucho más seguro añadir héroes, contenido, audio premium y networking.

## Hito siguiente: “Plataforma Dawnreach prepartida”

Después de cerrar Event Feed + Chat local y estabilizar el loop de partida, comenzar la migración TCL en el orden definido en la sección 23. El primer objetivo de esa fase será poder abrir Dawnreach, iniciar sesión con una cuenta real, entrar al Home nativo del juego y mantener conexión realtime con el backend antes de incorporar matchmaking y lobbies.
