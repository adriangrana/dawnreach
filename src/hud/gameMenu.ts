import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  DEFAULT_GAME_SETTINGS,
  bindingFromKeyboardEvent,
  formatKeyBinding,
  initializeGameSettings,
  loadGameSettings,
  resetGameSettings,
  saveGameSettings,
  type GameSettingValue,
  type GameSettings,
} from '../game/settings/gameSettings';

export const GAME_MENU_STATE_EVENT = 'dawnreach:game-menu-state';
export const MATCH_ABANDON_REQUEST_EVENT = 'dawnreach:match-abandon-request';

const MENU_ROOT_ID = 'dawnreach-game-menu';
const MENU_OPEN_DATASET_KEY = 'dawnreachGameMenuOpen';
const SUPPORT_URL = 'https://github.com/adriangrana/dawnreach/issues';

type MenuView = 'main' | 'options' | 'help' | 'support' | 'abandon' | 'exit' | 'abandoned';
type SettingKind = 'toggle' | 'slider' | 'select';
type SettingsCategoryId = 'gameplay' | 'camera' | 'graphics' | 'audio' | 'interface' | 'controls' | 'accessibility' | 'network';

type SelectOption = Readonly<{ value: string; label: string }>;
type SettingDefinition = Readonly<{
  key: string;
  label: string;
  description: string;
  kind: SettingKind;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  options?: readonly SelectOption[];
}>;

type SettingsCategory = Readonly<{
  id: SettingsCategoryId;
  label: string;
  eyebrow: string;
  description: string;
  settings: readonly SettingDefinition[];
}>;

type KeybindDefinition = Readonly<{
  key: string;
  label: string;
  description: string;
}>;

const yesNo = (key: string, label: string, description: string): SettingDefinition => ({
  key, label, description, kind: 'toggle',
});
const range = (
  key: string,
  label: string,
  description: string,
  min: number,
  max: number,
  step = 1,
  suffix = '',
): SettingDefinition => ({ key, label, description, kind: 'slider', min, max, step, suffix });
const choice = (
  key: string,
  label: string,
  description: string,
  options: readonly SelectOption[],
): SettingDefinition => ({ key, label, description, kind: 'select', options });

const QUALITY_OPTIONS: readonly SelectOption[] = [
  { value: 'low', label: 'Bajo' },
  { value: 'medium', label: 'Medio' },
  { value: 'high', label: 'Alto' },
  { value: 'ultra', label: 'Ultra' },
];

const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: 'gameplay',
    label: 'Jugabilidad',
    eyebrow: 'COMBATE Y ÓRDENES',
    description: 'Cómo responde el héroe a órdenes, ataques, lanzamientos y selección de objetivos.',
    settings: [
      choice('gameplay.autoAttack', 'Autoataque', 'Define cuándo el héroe adquiere objetivos sin una orden directa.', [
        { value: 'standard', label: 'Estándar' },
        { value: 'after-cast', label: 'Después de lanzar' },
        { value: 'never', label: 'Nunca' },
      ]),
      choice('gameplay.quickCast', 'Lanzamiento rápido', 'Momento en el que una habilidad dirigida confirma su objetivo.', [
        { value: 'off', label: 'Desactivado' },
        { value: 'press', label: 'Al pulsar' },
        { value: 'release', label: 'Al soltar' },
      ]),
      choice('gameplay.attackMoveTarget', 'Objetivo de atacar-mover', 'Prioridad usada cuando hay varios enemigos dentro del área de adquisición.', [
        { value: 'cursor', label: 'Más cercano al cursor' },
        { value: 'hero', label: 'Más cercano al héroe' },
      ]),
      yesNo('gameplay.stickyTarget', 'Objetivo persistente', 'Mantiene el objetivo actual mientras siga siendo válido.'),
      yesNo('gameplay.smartSelfCast', 'Autolanzamiento inteligente', 'Permite lanzar sobre uno mismo cuando no existe un objetivo válido.'),
      yesNo('gameplay.doubleTapSelfCast', 'Doble pulsación para autolanzar', 'Una segunda pulsación rápida usa la habilidad sobre tu héroe.'),
      yesNo('gameplay.showCastRange', 'Mostrar alcance de habilidades', 'Dibuja el radio o alcance mientras apuntas una habilidad.'),
      yesNo('gameplay.showAttackRange', 'Mostrar alcance de ataque', 'Muestra el alcance al preparar una orden de atacar-mover.'),
      yesNo('gameplay.moveCommandIndicator', 'Indicador de orden de movimiento', 'Marca visualmente el punto confirmado por click derecho.'),
      yesNo('gameplay.autoSelectSummons', 'Seleccionar invocaciones automáticamente', 'Añade unidades recién invocadas a la selección de control.'),
      yesNo('gameplay.autoOpenShop', 'Abrir tienda automáticamente en base', 'Permite mostrar la tienda al entrar en el área segura de compra.'),
      yesNo('gameplay.damageNumbers', 'Números de daño flotantes', 'Muestra daño, curación y mitigación sobre las unidades.'),
      yesNo('gameplay.damageTextStacking', 'Agrupar daño repetido', 'Combina impactos muy cercanos para reducir ruido visual.'),
      range('gameplay.screenShake', 'Intensidad de impactos', 'Cantidad de vibración de cámara en golpes y habilidades contundentes.', 0, 100, 5, '%'),
      yesNo('gameplay.cursorConfine', 'Confinar cursor a la ventana', 'Evita perder el cursor fuera del juego durante una partida.'),
      yesNo('gameplay.rightClickDeny', 'Denegar con click derecho', 'Permite usar click derecho sobre aliados denegables.'),
      yesNo('gameplay.holdPositionCancelsAttack', 'Mantener posición cancela ataque', 'La orden de mantener posición interrumpe el wind-up actual.'),
    ],
  },
  {
    id: 'camera',
    label: 'Cámara',
    eyebrow: 'NAVEGACIÓN DEL CAMPO',
    description: 'Desplazamiento, zoom, seguimiento del héroe y comportamiento del minimapa.',
    settings: [
      yesNo('camera.edgePan', 'Desplazamiento en bordes', 'Mueve la cámara al acercar el cursor a un borde de la pantalla.'),
      yesNo('camera.keyboardPan', 'Desplazamiento con teclado', 'Permite mover la cámara con las teclas asignadas.'),
      range('camera.edgeSize', 'Zona activa del borde', 'Anchura de la franja que activa el desplazamiento por cursor.', 4, 40, 1, ' px'),
      range('camera.panSpeed', 'Velocidad de cámara', 'Velocidad horizontal y vertical de desplazamiento.', 6, 40, 1, ''),
      range('camera.zoomSpeed', 'Velocidad de zoom', 'Sensibilidad de la rueda o gesto de zoom.', 10, 100, 5, '%'),
      range('camera.minZoom', 'Zoom mínimo', 'Distancia mínima permitida respecto al terreno.', 50, 100, 5, '%'),
      range('camera.maxZoom', 'Zoom máximo', 'Distancia máxima permitida respecto al terreno.', 100, 160, 5, '%'),
      range('camera.smoothing', 'Suavizado de cámara', 'Interpolación aplicada a desplazamiento y recentrado.', 0, 100, 5, '%'),
      range('camera.recenterSpeed', 'Velocidad de recentrado', 'Rapidez al centrar la cámara sobre tu héroe.', 10, 100, 5, '%'),
      choice('camera.followHero', 'Seguimiento del héroe', 'Comportamiento de cámara cuando se activa el seguimiento.', [
        { value: 'off', label: 'Desactivado' },
        { value: 'soft', label: 'Suave' },
        { value: 'locked', label: 'Bloqueado' },
      ]),
      yesNo('camera.dragInvert', 'Invertir arrastre de cámara', 'Invierte la dirección al arrastrar el campo de batalla.'),
      yesNo('camera.minimapDrag', 'Arrastrar cámara en minimapa', 'Permite reposicionar la vista arrastrando sobre el minimapa.'),
      yesNo('camera.minimapClick', 'Click en minimapa', 'Permite saltar directamente a una zona del mapa.'),
      range('camera.shakeIntensity', 'Sacudida de cámara', 'Intensidad global del camera shake de combate.', 0, 100, 5, '%'),
    ],
  },
  {
    id: 'graphics',
    label: 'Gráficos',
    eyebrow: 'RENDERIZADO',
    description: 'Calidad visual, rendimiento, sincronización y efectos del renderer.',
    settings: [
      choice('graphics.displayMode', 'Modo de pantalla', 'Presentación de la ventana del juego.', [
        { value: 'fullscreen', label: 'Pantalla completa' },
        { value: 'borderless', label: 'Ventana sin bordes' },
        { value: 'windowed', label: 'Ventana' },
      ]),
      choice('graphics.resolution', 'Resolución', 'Resolución lógica de salida.', [
        { value: 'native', label: 'Nativa' },
        { value: '2560x1440', label: '2560 × 1440' },
        { value: '1920x1080', label: '1920 × 1080' },
        { value: '1600x900', label: '1600 × 900' },
        { value: '1280x720', label: '1280 × 720' },
      ]),
      range('graphics.renderScale', 'Escala de render', 'Resolución interna antes de escalar a la ventana.', 50, 150, 5, '%'),
      yesNo('graphics.vsync', 'Sincronización vertical', 'Sincroniza los frames con la frecuencia del monitor.'),
      choice('graphics.frameLimit', 'Límite de FPS', 'Tope de frames por segundo para el renderer principal.', [
        { value: '30', label: '30 FPS' },
        { value: '60', label: '60 FPS' },
        { value: '90', label: '90 FPS' },
        { value: '120', label: '120 FPS' },
        { value: '144', label: '144 FPS' },
        { value: '165', label: '165 FPS' },
        { value: '240', label: '240 FPS' },
        { value: 'unlimited', label: 'Sin límite' },
      ]),
      choice('graphics.preset', 'Preajuste general', 'Base de calidad para todos los subsistemas visuales.', [
        { value: 'competitive', label: 'Competitivo' },
        ...QUALITY_OPTIONS,
        { value: 'custom', label: 'Personalizado' },
      ]),
      choice('graphics.textureQuality', 'Texturas', 'Resolución y filtrado de texturas.', QUALITY_OPTIONS),
      choice('graphics.shadowQuality', 'Sombras', 'Resolución y coste de las sombras dinámicas.', QUALITY_OPTIONS),
      range('graphics.shadowDistance', 'Distancia de sombras', 'Distancia máxima de objetos que proyectan sombra.', 25, 100, 5, '%'),
      choice('graphics.effectsQuality', 'Efectos de habilidades', 'Complejidad de shaders y geometría de habilidades.', QUALITY_OPTIONS),
      choice('graphics.particleQuality', 'Partículas', 'Densidad de partículas simultáneas.', QUALITY_OPTIONS),
      choice('graphics.terrainQuality', 'Terreno', 'Detalle del suelo, agua y materiales del mapa.', QUALITY_OPTIONS),
      choice('graphics.vegetationQuality', 'Vegetación', 'Densidad de árboles, hierba y decoración.', QUALITY_OPTIONS),
      choice('graphics.antiAliasing', 'Antialiasing', 'Técnica usada para suavizar bordes.', [
        { value: 'off', label: 'Desactivado' },
        { value: 'fxaa', label: 'FXAA' },
        { value: 'taa', label: 'TAA' },
        { value: 'msaa', label: 'MSAA' },
      ]),
      choice('graphics.anisotropicFiltering', 'Filtrado anisotrópico', 'Nitidez de texturas vistas en ángulo.', [
        { value: 'off', label: 'Desactivado' },
        { value: '2x', label: '2×' },
        { value: '4x', label: '4×' },
        { value: '8x', label: '8×' },
        { value: '16x', label: '16×' },
      ]),
      yesNo('graphics.ambientOcclusion', 'Oclusión ambiental', 'Añade contacto y profundidad en intersecciones y rincones.'),
      yesNo('graphics.bloom', 'Bloom', 'Resplandor suave en magia, cristales y fuentes luminosas.'),
      yesNo('graphics.dynamicLights', 'Luces dinámicas', 'Permite luces móviles de habilidades y estructuras.'),
      yesNo('graphics.reflections', 'Reflejos', 'Activa reflejos aproximados en agua y superficies pulidas.'),
      yesNo('graphics.weatherEffects', 'Clima ambiental', 'Niebla, lluvia, polvo y ambientación dinámica.'),
      yesNo('graphics.postProcessing', 'Postprocesado', 'Activa la cadena de efectos finales del frame.'),
      yesNo('graphics.motionBlur', 'Desenfoque de movimiento', 'Añade blur durante movimientos rápidos de cámara.'),
      yesNo('graphics.chromaticAberration', 'Aberración cromática', 'Efecto óptico en impactos y estados extremos.'),
      choice('graphics.colorGrading', 'Tratamiento de color', 'Perfil final de contraste y color del mundo.', [
        { value: 'neutral', label: 'Neutro' },
        { value: 'cinematic', label: 'Cinemático' },
        { value: 'vivid', label: 'Vívido' },
        { value: 'competitive', label: 'Competitivo' },
      ]),
      yesNo('graphics.lowLatency', 'Modo de baja latencia', 'Prioriza respuesta de entrada frente a buffering visual.'),
    ],
  },
  {
    id: 'audio',
    label: 'Sonido',
    eyebrow: 'MEZCLA Y VOZ',
    description: 'Volumen, espacialización, música dinámica, voces y señales de combate.',
    settings: [
      range('audio.master', 'Volumen general', 'Ganancia maestra de toda la mezcla.', 0, 100, 1, '%'),
      range('audio.music', 'Música', 'Volumen de banda sonora y música dinámica.', 0, 100, 1, '%'),
      range('audio.effects', 'Efectos', 'Habilidades, ataques, estructuras y entorno interactivo.', 0, 100, 1, '%'),
      range('audio.interface', 'Interfaz', 'Clicks, tienda, confirmaciones y avisos del HUD.', 0, 100, 1, '%'),
      range('audio.ambience', 'Ambiente', 'Viento, fauna, agua y sonidos del mapa.', 0, 100, 1, '%'),
      range('audio.voice', 'Voces', 'Diálogos y respuestas de héroes/unidades.', 0, 100, 1, '%'),
      range('audio.announcer', 'Anunciador', 'Eventos de partida, rachas y objetivos.', 0, 100, 1, '%'),
      range('audio.pings', 'Pings', 'Señales tácticas y avisos de compañeros.', 0, 100, 1, '%'),
      choice('audio.output', 'Dispositivo de salida', 'Destino de audio preferido.', [
        { value: 'default', label: 'Predeterminado del sistema' },
        { value: 'communications', label: 'Dispositivo de comunicaciones' },
      ]),
      yesNo('audio.spatial', 'Audio espacial', 'Posiciona efectos según su ubicación en el campo de batalla.'),
      yesNo('audio.heroVoices', 'Voces de héroes', 'Activa frases contextuales de héroes.'),
      yesNo('audio.unitResponses', 'Respuestas de unidades', 'Reproduce confirmaciones al seleccionar o dar órdenes.'),
      yesNo('audio.combatAlerts', 'Alertas de combate', 'Avisos de vida baja, torre atacada y amenazas cercanas.'),
      yesNo('audio.dynamicMusic', 'Música dinámica', 'Adapta la banda sonora a combate y objetivos.'),
      yesNo('audio.muteUnfocused', 'Silenciar en segundo plano', 'Silencia el juego cuando la ventana pierde el foco.'),
      choice('audio.dynamicRange', 'Rango dinámico', 'Diferencia entre sonidos suaves y fuertes.', [
        { value: 'night', label: 'Noche / comprimido' },
        { value: 'medium', label: 'Medio' },
        { value: 'wide', label: 'Amplio' },
      ]),
    ],
  },
  {
    id: 'interface',
    label: 'Interfaz',
    eyebrow: 'HUD Y LEGIBILIDAD',
    description: 'Escala, minimapa, información de combate, tooltips y elementos competitivos.',
    settings: [
      range('interface.uiScale', 'Escala del HUD', 'Tamaño global de elementos de interfaz.', 75, 130, 5, '%'),
      range('interface.textScale', 'Escala de texto', 'Tamaño relativo de textos de interfaz.', 80, 140, 5, '%'),
      range('interface.hudOpacity', 'Opacidad del HUD', 'Transparencia global de paneles persistentes.', 55, 100, 5, '%'),
      range('interface.minimapScale', 'Tamaño del minimapa', 'Escala del minimapa principal.', 75, 140, 5, '%'),
      choice('interface.minimapSide', 'Posición del minimapa', 'Lado de la pantalla donde aparece el minimapa.', [
        { value: 'left', label: 'Izquierda' },
        { value: 'right', label: 'Derecha' },
      ]),
      range('interface.minimapIconScale', 'Iconos del minimapa', 'Tamaño de héroes, torres y objetivos en el minimapa.', 70, 160, 5, '%'),
      yesNo('interface.showHeroNames', 'Nombres de héroes', 'Muestra nombres sobre héroes cuando corresponda.'),
      yesNo('interface.showHealthBars', 'Barras de vida', 'Muestra vida sobre unidades visibles.'),
      yesNo('interface.showManaBars', 'Barras de recurso', 'Muestra maná/energía cuando es relevante.'),
      yesNo('interface.showStatusEffects', 'Estados y auras', 'Muestra buffs, debuffs y pasivas persistentes.'),
      yesNo('interface.showCooldownNumbers', 'Números de cooldown', 'Superpone segundos restantes en habilidades y objetos.'),
      yesNo('interface.showObjectiveTimers', 'Temporizadores de objetivos', 'Muestra respawns y ventanas de objetivos importantes.'),
      yesNo('interface.showDamagePreview', 'Vista previa de daño', 'Incluye estimaciones de daño en tooltips y HUD de combate.'),
      yesNo('interface.showFps', 'Mostrar FPS', 'Mantiene visible el medidor de rendimiento.'),
      yesNo('interface.showNetworkStats', 'Estadísticas de red', 'Muestra ping, pérdida de paquetes y jitter.'),
      yesNo('interface.combatLog', 'Registro de combate', 'Muestra un historial textual de eventos recientes.'),
      yesNo('interface.chatTimestamps', 'Hora en el chat', 'Añade marca temporal a cada mensaje.'),
      range('interface.tooltipDelay', 'Retardo de tooltip', 'Tiempo antes de mostrar información al pasar el cursor.', 0, 1000, 50, ' ms'),
      range('interface.cursorScale', 'Tamaño del cursor', 'Escala del cursor de juego.', 75, 150, 5, '%'),
      yesNo('interface.shopAdvancedStats', 'Datos avanzados de tienda', 'Muestra eficiencia, componentes y detalles técnicos.'),
      yesNo('interface.scoreboardDetailed', 'Marcador detallado', 'Incluye objetos, LH/DN, KDA y economía en el marcador.'),
    ],
  },
  {
    id: 'controls',
    label: 'Controles',
    eyebrow: 'TECLADO Y RATÓN',
    description: 'Atajos competitivos, inventario, cámara y sensibilidad de entrada.',
    settings: [
      range('controls.mouseSensitivity', 'Sensibilidad del ratón', 'Sensibilidad base para interacciones de cámara y apuntado.', 10, 100, 5, '%'),
      range('controls.doubleClickMs', 'Ventana de doble click', 'Tiempo máximo entre dos clicks para considerarlos dobles.', 150, 500, 10, ' ms'),
      yesNo('controls.altSelfCast', 'ALT para autolanzar', 'Mantener ALT lanza habilidades compatibles sobre tu héroe.'),
    ],
  },
  {
    id: 'accessibility',
    label: 'Accesibilidad',
    eyebrow: 'VISIBILIDAD Y CONFORT',
    description: 'Opciones para reducir carga visual, mejorar contraste y reforzar señales importantes.',
    settings: [
      choice('accessibility.colorBlindMode', 'Modo de daltonismo', 'Ajusta códigos de color competitivos.', [
        { value: 'none', label: 'Desactivado' },
        { value: 'protanopia', label: 'Protanopia' },
        { value: 'deuteranopia', label: 'Deuteranopia' },
        { value: 'tritanopia', label: 'Tritanopia' },
      ]),
      yesNo('accessibility.highContrast', 'Alto contraste', 'Refuerza bordes y separación entre paneles y estados.'),
      yesNo('accessibility.reducedMotion', 'Reducir movimiento', 'Reduce animaciones decorativas y transiciones intensas.'),
      yesNo('accessibility.reduceFlashes', 'Reducir destellos', 'Suaviza flashes de impactos, teletransportes y ultimates.'),
      yesNo('accessibility.subtitles', 'Subtítulos', 'Muestra subtítulos para voces y eventos narrativos.'),
      range('accessibility.subtitleSize', 'Tamaño de subtítulos', 'Escala del texto de subtítulos.', 80, 160, 5, '%'),
      yesNo('accessibility.visualPings', 'Pings visuales reforzados', 'Añade formas/animaciones además del color del ping.'),
      yesNo('accessibility.edgeAlerts', 'Alertas en bordes de pantalla', 'Indica amenazas y eventos fuera de cámara.'),
      yesNo('accessibility.largeCursor', 'Cursor grande', 'Usa un cursor reforzado para mayor visibilidad.'),
      yesNo('accessibility.holdToToggle', 'Sustituir mantener por alternar', 'Convierte acciones mantenidas compatibles en toggles.'),
      yesNo('accessibility.simplifiedEffects', 'Efectos simplificados', 'Reduce ruido visual sin ocultar telegraphs importantes.'),
      yesNo('accessibility.screenReaderHints', 'Ayudas para lector de pantalla', 'Añade descripciones semánticas a controles y estados del HUD.'),
    ],
  },
  {
    id: 'network',
    label: 'Red y social',
    eyebrow: 'CONEXIÓN, CHAT Y PRIVACIDAD',
    description: 'Región, suavizado de red, reconexión, comunicaciones y telemetría.',
    settings: [
      choice('network.region', 'Región preferida', 'Región usada al buscar servidor de partida.', [
        { value: 'auto', label: 'Automática' },
        { value: 'eu-west', label: 'Europa Oeste' },
        { value: 'eu-central', label: 'Europa Central' },
        { value: 'na-east', label: 'Norteamérica Este' },
        { value: 'na-west', label: 'Norteamérica Oeste' },
        { value: 'latam', label: 'Latinoamérica' },
      ]),
      choice('network.interpolation', 'Suavizado de red', 'Equilibrio entre latencia percibida y tolerancia a jitter.', [
        { value: 'low', label: 'Latencia mínima' },
        { value: 'balanced', label: 'Equilibrado' },
        { value: 'stable', label: 'Máxima estabilidad' },
      ]),
      range('network.maxPingWarning', 'Aviso de ping alto', 'Umbral que activa la advertencia de conexión.', 50, 300, 10, ' ms'),
      yesNo('network.showPacketLoss', 'Mostrar pérdida de paquetes', 'Incluye pérdida y jitter en el HUD de red.'),
      yesNo('network.reconnectAutomatically', 'Reconexión automática', 'Intenta recuperar la sesión tras una desconexión breve.'),
      yesNo('social.profanityFilter', 'Filtro de lenguaje', 'Oculta automáticamente lenguaje ofensivo conocido.'),
      yesNo('social.teamChatOnly', 'Solo chat de equipo', 'Oculta por defecto el chat global durante la partida.'),
      yesNo('social.muteAllVoice', 'Silenciar voz', 'Desactiva toda comunicación de voz.'),
      yesNo('social.allowPartyInvites', 'Permitir invitaciones de grupo', 'Acepta notificaciones de invitación a grupo.'),
      yesNo('social.allowFriendRequests', 'Permitir solicitudes de amistad', 'Acepta nuevas solicitudes sociales.'),
      yesNo('social.streamerMode', 'Modo streamer', 'Oculta identificadores sensibles en interfaces compatibles.'),
      yesNo('privacy.crashReports', 'Informes de fallos', 'Permite recopilar información técnica cuando el juego falla.'),
      yesNo('privacy.performanceTelemetry', 'Telemetría de rendimiento', 'Permite recopilar métricas anónimas de rendimiento del cliente.'),
    ],
  },
];

const KEYBINDS: readonly KeybindDefinition[] = [
  { key: 'controls.abilityQ', label: 'Habilidad Q', description: 'Primera habilidad del héroe.' },
  { key: 'controls.abilityW', label: 'Habilidad W', description: 'Segunda habilidad del héroe.' },
  { key: 'controls.abilityE', label: 'Habilidad E', description: 'Tercera habilidad del héroe.' },
  { key: 'controls.abilityR', label: 'Definitiva R', description: 'Habilidad definitiva.' },
  { key: 'controls.attackMove', label: 'Atacar-mover', description: 'Mueve y adquiere objetivos enemigos.' },
  { key: 'controls.stop', label: 'Detener', description: 'Cancela la orden actual.' },
  { key: 'controls.holdPosition', label: 'Mantener posición', description: 'No permite desplazamiento automático.' },
  { key: 'controls.selectHero', label: 'Seleccionar héroe', description: 'Primera pulsación selecciona; las siguientes pueden centrar.' },
  { key: 'controls.centerHero', label: 'Centrar cámara', description: 'Centra la cámara sobre tu héroe.' },
  { key: 'controls.scoreboard', label: 'Marcador', description: 'Muestra el scoreboard de la partida.' },
  { key: 'controls.shop', label: 'Tienda', description: 'Abre o cierra la tienda.' },
  { key: 'controls.pingWheel', label: 'Rueda de pings', description: 'Abre las señales tácticas.' },
  { key: 'controls.dangerPing', label: 'Ping de peligro', description: 'Señal rápida de amenaza.' },
  { key: 'controls.teleport', label: 'Pergamino de TP', description: 'Activa la ranura dedicada de teletransporte.' },
  { key: 'controls.item1', label: 'Objeto 1', description: 'Activa la primera ranura de inventario.' },
  { key: 'controls.item2', label: 'Objeto 2', description: 'Activa la segunda ranura de inventario.' },
  { key: 'controls.item3', label: 'Objeto 3', description: 'Activa la tercera ranura de inventario.' },
  { key: 'controls.item4', label: 'Objeto 4', description: 'Activa la cuarta ranura de inventario.' },
  { key: 'controls.item5', label: 'Objeto 5', description: 'Activa la quinta ranura de inventario.' },
  { key: 'controls.item6', label: 'Objeto 6', description: 'Activa la sexta ranura de inventario.' },
  { key: 'controls.cameraLeft', label: 'Cámara izquierda', description: 'Desplaza la cámara a la izquierda.' },
  { key: 'controls.cameraRight', label: 'Cámara derecha', description: 'Desplaza la cámara a la derecha.' },
  { key: 'controls.cameraUp', label: 'Cámara arriba', description: 'Desplaza la cámara hacia arriba.' },
  { key: 'controls.cameraDown', label: 'Cámara abajo', description: 'Desplaza la cámara hacia abajo.' },
];

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function gameplayKey(event: KeyboardEvent) {
  if (event.code === 'Space' || event.code === 'Tab') return true;
  if (event.code.startsWith('Arrow')) return true;
  if (/^Digit[1-6]$/.test(event.code)) return true;
  if (/^F[1-9]$/.test(event.code)) return true;
  return ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyH', 'KeyT', 'KeyG', 'KeyV'].includes(event.code);
}

function settingsEqual(a: GameSettings, b: GameSettings) {
  const keys = Object.keys(DEFAULT_GAME_SETTINGS);
  return keys.every(key => a[key] === b[key]);
}

function settingValueText(definition: SettingDefinition, value: GameSettingValue) {
  if (definition.kind === 'slider') return `${value}${definition.suffix ?? ''}`;
  if (definition.kind === 'select') {
    return definition.options?.find(option => option.value === String(value))?.label ?? String(value);
  }
  return value ? 'Activado' : 'Desactivado';
}

function renderSetting(definition: SettingDefinition, settings: GameSettings) {
  const value = settings[definition.key] ?? DEFAULT_GAME_SETTINGS[definition.key];
  const id = `setting-${definition.key.replaceAll('.', '-')}`;
  let control = '';
  if (definition.kind === 'toggle') {
    control = `<label class="game-setting-toggle" for="${id}">
      <input id="${id}" type="checkbox" data-setting-key="${escapeHtml(definition.key)}" ${value ? 'checked' : ''} />
      <span aria-hidden="true"></span>
    </label>`;
  } else if (definition.kind === 'slider') {
    control = `<div class="game-setting-range-wrap">
      <input id="${id}" type="range" data-setting-key="${escapeHtml(definition.key)}" min="${definition.min}" max="${definition.max}" step="${definition.step ?? 1}" value="${escapeHtml(value)}" />
      <output data-setting-output="${escapeHtml(definition.key)}">${escapeHtml(settingValueText(definition, value))}</output>
    </div>`;
  } else {
    control = `<select id="${id}" data-setting-key="${escapeHtml(definition.key)}">
      ${(definition.options ?? []).map(option => `<option value="${escapeHtml(option.value)}" ${String(value) === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
    </select>`;
  }

  return `<div class="game-setting-row">
    <div class="game-setting-copy">
      <label for="${id}">${escapeHtml(definition.label)}</label>
      <p>${escapeHtml(definition.description)}</p>
    </div>
    <div class="game-setting-control">${control}</div>
  </div>`;
}

function renderKeybind(definition: KeybindDefinition, settings: GameSettings, activeKeybind: string | null) {
  const binding = String(settings[definition.key] ?? DEFAULT_GAME_SETTINGS[definition.key] ?? '');
  const recording = activeKeybind === definition.key;
  return `<div class="game-keybind-row">
    <div>
      <strong>${escapeHtml(definition.label)}</strong>
      <p>${escapeHtml(definition.description)}</p>
    </div>
    <input
      class="game-keybind-input${recording ? ' is-recording' : ''}"
      type="text"
      readonly
      data-keybind-key="${escapeHtml(definition.key)}"
      value="${recording ? 'Pulsa una tecla…' : escapeHtml(formatKeyBinding(binding))}"
      aria-label="Reasignar ${escapeHtml(definition.label)}"
    />
  </div>`;
}

function supportDiagnostic() {
  return [
    'Dawnreach 0.2.0',
    `Plataforma: ${navigator.platform || 'desconocida'}`,
    `User agent: ${navigator.userAgent}`,
    `Viewport: ${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio.toFixed(2)} DPR`,
    `Idioma: ${navigator.language}`,
    `Online: ${navigator.onLine ? 'sí' : 'no'}`,
    `Hora local: ${new Date().toISOString()}`,
  ].join('\n');
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  }
}

async function closeApplication() {
  try {
    if (isTauri()) {
      await getCurrentWindow().close();
      return;
    }
  } catch (error) {
    console.warn('[Dawnreach] Could not close the Tauri window.', error);
  }
  window.close();
}

async function setCursorGrab(grabbed: boolean) {
  try {
    if (isTauri()) await getCurrentWindow().setCursorGrab(grabbed);
  } catch {
    // Cursor grab can be unavailable in browser preview or while focus changes.
  }
}

export function isGameMenuOpen() {
  return document.body.dataset[MENU_OPEN_DATASET_KEY] === 'true';
}

export function mountGameMenu() {
  initializeGameSettings();

  let root = document.getElementById(MENU_ROOT_ID);
  if (root) root.remove();
  root = document.createElement('div');
  root.id = MENU_ROOT_ID;
  root.className = 'game-menu-overlay';
  root.hidden = true;
  document.body.appendChild(root);

  let open = false;
  let view: MenuView = 'main';
  let activeCategory: SettingsCategoryId = 'gameplay';
  let savedSettings = loadGameSettings();
  let draftSettings: GameSettings = { ...savedSettings };
  let activeKeybind: string | null = null;
  let statusMessage = '';
  let abandoned = false;
  let abandonPending = false;
  let closeAfterAbandon = false;

  const publishOpenState = () => {
    document.body.dataset[MENU_OPEN_DATASET_KEY] = String(open);
    window.dispatchEvent(new CustomEvent(GAME_MENU_STATE_EVENT, { detail: { open } }));
    void setCursorGrab(!open);
  };

  const focusFirstControl = () => {
    requestAnimationFrame(() => {
      root?.querySelector<HTMLElement>('[data-menu-autofocus], button, input, select')?.focus();
    });
  };

  const renderHeader = (title: string, subtitle: string, backAction?: string) => `
    <header class="game-menu-header">
      <div>
        <span class="game-menu-kicker">DAWNREACH</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="game-menu-header-actions">
        ${backAction ? `<button class="game-menu-icon-button" type="button" data-action="${backAction}" title="Volver">←</button>` : ''}
        <kbd>F10</kbd>
      </div>
    </header>`;

  const renderMain = () => `
    <div class="game-menu-panel game-menu-panel--main">
      ${renderHeader('Menú de partida', 'Configura Dawnreach o gestiona la sesión actual.')}
      <nav class="game-menu-primary" aria-label="Menú de partida">
        <button type="button" class="game-menu-primary-action game-menu-primary-action--resume" data-action="resume" data-menu-autofocus>
          <span class="game-menu-action-index">01</span><span><strong>Reanudar partida</strong><small>Volver al campo de batalla</small></span>
        </button>
        <button type="button" class="game-menu-primary-action" data-action="options">
          <span class="game-menu-action-index">02</span><span><strong>Opciones</strong><small>Jugabilidad, gráficos, sonido, HUD y controles</small></span>
        </button>
        <button type="button" class="game-menu-primary-action" data-action="help">
          <span class="game-menu-action-index">03</span><span><strong>Ayuda</strong><small>Controles esenciales y conceptos de partida</small></span>
        </button>
        <button type="button" class="game-menu-primary-action" data-action="support">
          <span class="game-menu-action-index">04</span><span><strong>Soporte</strong><small>Diagnóstico e incidencias</small></span>
        </button>
        <button type="button" class="game-menu-primary-action game-menu-primary-action--danger" data-action="abandon">
          <span class="game-menu-action-index">05</span><span><strong>Abandonar partida</strong><small>Salir de la sesión actual</small></span>
        </button>
        <button type="button" class="game-menu-primary-action game-menu-primary-action--danger" data-action="exit">
          <span class="game-menu-action-index">06</span><span><strong>Salir del juego</strong><small>Cerrar Dawnreach</small></span>
        </button>
      </nav>
      <footer class="game-menu-footer"><span>F10 · cerrar menú</span><span>ESC · volver</span></footer>
    </div>`;

  const renderOptions = () => {
    const category = SETTINGS_CATEGORIES.find(candidate => candidate.id === activeCategory) ?? SETTINGS_CATEGORIES[0];
    const dirty = !settingsEqual(savedSettings, draftSettings);
    const categorySettings = category.settings.map(definition => renderSetting(definition, draftSettings)).join('');
    const keybinds = category.id === 'controls'
      ? `<section class="game-keybind-section">
          <div class="game-options-section-title"><span>ATAJOS DE TECLADO</span><p>Haz click en una asignación y pulsa la nueva combinación. F10 queda reservado al menú.</p></div>
          ${KEYBINDS.map(definition => renderKeybind(definition, draftSettings, activeKeybind)).join('')}
        </section>`
      : '';
    return `
      <div class="game-menu-panel game-menu-panel--options">
        ${renderHeader('Opciones', 'Configuración completa del cliente y del HUD.', 'back-main')}
        <div class="game-options-layout">
          <aside class="game-options-sidebar" aria-label="Categorías">
            ${SETTINGS_CATEGORIES.map(item => `<button type="button" data-action="category" data-category="${item.id}" class="${item.id === category.id ? 'is-active' : ''}"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.eyebrow)}</small></button>`).join('')}
          </aside>
          <section class="game-options-content">
            <div class="game-options-title">
              <span>${escapeHtml(category.eyebrow)}</span>
              <h2>${escapeHtml(category.label)}</h2>
              <p>${escapeHtml(category.description)}</p>
            </div>
            <div class="game-settings-list">${categorySettings}</div>
            ${keybinds}
          </section>
        </div>
        <footer class="game-options-footer">
          <div class="game-options-status"><span class="${dirty ? 'is-dirty' : ''}">${dirty ? 'Cambios sin aplicar' : 'Configuración guardada'}</span>${statusMessage ? `<em>${escapeHtml(statusMessage)}</em>` : ''}</div>
          <div class="game-options-buttons">
            <button type="button" class="game-menu-button game-menu-button--ghost" data-action="reset-options">Restaurar valores</button>
            <button type="button" class="game-menu-button" data-action="apply-options" ${dirty ? '' : 'disabled'}>Aplicar</button>
          </div>
        </footer>
      </div>`;
  };

  const renderHelp = () => `
    <div class="game-menu-panel game-menu-panel--document">
      ${renderHeader('Ayuda', 'Referencia rápida de controles y lectura del campo de batalla.', 'back-main')}
      <div class="game-menu-document-grid">
        <section><span class="game-menu-doc-kicker">MOVIMIENTO</span><h2>Control del campo</h2><dl>
          <div><dt>Click derecho</dt><dd>Mover al punto seleccionado.</dd></div>
          <div><dt>A</dt><dd>Atacar-mover hacia una zona.</dd></div>
          <div><dt>S</dt><dd>Detener la orden actual.</dd></div>
          <div><dt>F1</dt><dd>Seleccionar héroe; repetir para recentrar.</dd></div>
          <div><dt>Espacio</dt><dd>Centrar cámara sobre el héroe.</dd></div>
          <div><dt>F10</dt><dd>Abrir o cerrar este menú.</dd></div>
        </dl></section>
        <section><span class="game-menu-doc-kicker">COMBATE</span><h2>Habilidades y objetos</h2><dl>
          <div><dt>Q · W · E · R</dt><dd>Habilidades del héroe.</dd></div>
          <div><dt>ALT + Q/W/E/A/S/D</dt><dd>Activar las seis ranuras del inventario.</dd></div>
          <div><dt>TP</dt><dd>Usa la ranura dedicada del Pergamino de Teletransporte.</dd></div>
          <div><dt>Click derecho en suelo</dt><dd>Recoger objetos si hay espacio válido.</dd></div>
        </dl></section>
        <section><span class="game-menu-doc-kicker">MOBA</span><h2>Prioridades</h2><p>Controla oleadas, asegura últimos golpes, protege tus torres y usa la visión para decidir cuándo rotar. Las estructuras y objetivos no sustituyen la información del minimapa: revisa constantemente líneas, enemigos desaparecidos y rutas de acceso.</p></section>
        <section><span class="game-menu-doc-kicker">CONFIGURACIÓN</span><h2>Ajusta tu cliente</h2><p>En Opciones puedes modificar jugabilidad, cámara, calidad gráfica, audio, HUD, accesibilidad, red y todas las asignaciones de teclado. Los ajustes se guardan localmente y se publican al runtime de Dawnreach.</p></section>
      </div>
      <footer class="game-menu-footer"><span>ESC · volver</span><span>F10 · cerrar menú</span></footer>
    </div>`;

  const renderSupport = () => `
    <div class="game-menu-panel game-menu-panel--document">
      ${renderHeader('Soporte', 'Herramientas para documentar y reportar un problema.', 'back-main')}
      <div class="game-support-layout">
        <section class="game-support-card"><span>01</span><h2>Información técnica</h2><p>Copia un diagnóstico básico del cliente para adjuntarlo a una incidencia.</p><button type="button" class="game-menu-button" data-action="copy-diagnostic">Copiar diagnóstico</button></section>
        <section class="game-support-card"><span>02</span><h2>Reportar incidencia</h2><p>Abre el registro de incidencias de Dawnreach para documentar pasos, resultado esperado y capturas.</p><button type="button" class="game-menu-button" data-action="open-support">Abrir incidencias</button></section>
        <section class="game-support-card"><span>03</span><h2>Restablecer opciones</h2><p>Si una configuración visual o de control queda en un estado incorrecto, restaura el perfil local.</p><button type="button" class="game-menu-button game-menu-button--ghost" data-action="reset-options-from-support">Restaurar configuración</button></section>
      </div>
      <div class="game-support-status" role="status">${escapeHtml(statusMessage || 'Incluye versión, plataforma, viewport y estado de conexión; no copia datos de cuenta.')}</div>
      <footer class="game-menu-footer"><span>ESC · volver</span><span>F10 · cerrar menú</span></footer>
    </div>`;

  const renderConfirmation = (kind: 'abandon' | 'exit') => {
    const exit = kind === 'exit';
    return `
      <div class="game-menu-panel game-menu-panel--confirm">
        ${renderHeader(exit ? 'Salir del juego' : 'Abandonar partida', exit ? 'Dawnreach se cerrará por completo.' : 'Dejarás de controlar a tu héroe en esta sesión.', 'back-main')}
        <div class="game-confirm-body">
          <div class="game-confirm-emblem">${exit ? '×' : '!'}</div>
          <h2>${exit ? '¿Cerrar Dawnreach?' : '¿Abandonar la partida actual?'}</h2>
          <p>${exit ? 'Los ajustes ya aplicados permanecerán guardados.' : 'Esta acción marca la sesión local como abandonada. En una partida online, el runtime de red puede usar este evento para procesar desconexión, penalización o reconexión.'}</p>
          <div class="game-confirm-actions">
            <button type="button" class="game-menu-button game-menu-button--ghost" data-action="back-main" data-menu-autofocus ${abandonPending ? 'disabled' : ''}>Cancelar</button>
            <button type="button" class="game-menu-button game-menu-button--danger" data-action="${exit ? 'confirm-exit' : 'confirm-abandon'}" ${abandonPending ? 'disabled' : ''}>${abandonPending ? 'Procesando…' : exit ? 'Salir del juego' : 'Abandonar partida'}</button>
          </div>
        </div>
      </div>`;
  };

  const renderAbandoned = () => `
    <div class="game-menu-panel game-menu-panel--confirm game-menu-panel--abandoned">
      ${renderHeader('Partida abandonada', 'La sesión online ha quedado cerrada.')}
      <div class="game-confirm-body">
        <div class="game-confirm-emblem">✓</div>
        <h2>Has abandonado la partida</h2>
        <p>El servidor confirmó tu salida. Ya puedes volver al cliente o cerrar Dawnreach.</p>
        <div class="game-confirm-actions">
          <button type="button" class="game-menu-button game-menu-button--ghost" data-action="restart-local" data-menu-autofocus>Volver al cliente</button>
          <button type="button" class="game-menu-button game-menu-button--danger" data-action="confirm-exit-local">Salir del juego</button>
        </div>
      </div>
    </div>`;

  const render = () => {
    if (!root) return;
    root.classList.toggle('is-open', open);
    root.hidden = !open;
    if (!open) return;
    if (view === 'options') root.innerHTML = renderOptions();
    else if (view === 'help') root.innerHTML = renderHelp();
    else if (view === 'support') root.innerHTML = renderSupport();
    else if (view === 'abandon') root.innerHTML = renderConfirmation('abandon');
    else if (view === 'exit') root.innerHTML = renderConfirmation('exit');
    else if (view === 'abandoned') root.innerHTML = renderAbandoned();
    else root.innerHTML = renderMain();
    focusFirstControl();
  };

  const setOpen = (next: boolean) => {
    if (abandoned && !next) return;
    if (open === next) return;
    open = next;
    if (open && view === 'main') {
      savedSettings = loadGameSettings();
      draftSettings = { ...savedSettings };
    }
    activeKeybind = null;
    statusMessage = '';
    publishOpenState();
    render();
  };

  const changeView = (next: MenuView) => {
    view = next;
    activeKeybind = null;
    statusMessage = '';
    if (next === 'options') {
      savedSettings = loadGameSettings();
      draftSettings = { ...savedSettings };
    }
    render();
  };

  const setOption = (key: string, value: GameSettingValue) => {
    draftSettings = { ...draftSettings, [key]: value };
  };

  const refreshOptionsFooter = () => {
    if (view !== 'options' || !root) return;
    const dirty = !settingsEqual(savedSettings, draftSettings);
    const status = root.querySelector<HTMLElement>('.game-options-status > span');
    if (status) {
      status.textContent = dirty ? 'Cambios sin aplicar' : 'Configuración guardada';
      status.classList.toggle('is-dirty', dirty);
    }
    const apply = root.querySelector<HTMLButtonElement>('[data-action="apply-options"]');
    if (apply) apply.disabled = !dirty;
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action], [data-keybind-key]') : null;
    if (!target) return;

    const keybindKey = target.dataset.keybindKey;
    if (keybindKey) {
      activeKeybind = keybindKey;
      statusMessage = 'Pulsa la nueva tecla o combinación. ESC cancela.';
      root?.querySelectorAll<HTMLInputElement>('.game-keybind-input').forEach(input => {
        const recording = input.dataset.keybindKey === keybindKey;
        input.classList.toggle('is-recording', recording);
        input.value = recording
          ? 'Pulsa una tecla…'
          : formatKeyBinding(String(draftSettings[input.dataset.keybindKey ?? ''] ?? ''));
      });
      target.focus();
      return;
    }

    const action = target.dataset.action;
    if (!action) return;
    if (action === 'resume') setOpen(false);
    else if (action === 'options') changeView('options');
    else if (action === 'help') changeView('help');
    else if (action === 'support') changeView('support');
    else if (action === 'abandon') changeView('abandon');
    else if (action === 'exit') changeView('exit');
    else if (action === 'back-main') changeView('main');
    else if (action === 'category') {
      activeCategory = (target.dataset.category as SettingsCategoryId) || 'gameplay';
      activeKeybind = null;
      render();
    } else if (action === 'apply-options') {
      savedSettings = saveGameSettings(draftSettings);
      draftSettings = { ...savedSettings };
      statusMessage = 'Cambios aplicados al perfil local.';
      render();
    } else if (action === 'reset-options') {
      draftSettings = { ...DEFAULT_GAME_SETTINGS };
      statusMessage = 'Valores predeterminados cargados; pulsa Aplicar para guardarlos.';
      render();
    } else if (action === 'reset-options-from-support') {
      savedSettings = resetGameSettings();
      draftSettings = { ...savedSettings };
      statusMessage = 'Configuración restaurada a valores predeterminados.';
      render();
    } else if (action === 'copy-diagnostic') {
      void copyText(supportDiagnostic()).then(copied => {
        statusMessage = copied ? 'Diagnóstico copiado al portapapeles.' : 'No se pudo copiar el diagnóstico.';
        render();
      });
    } else if (action === 'open-support') {
      window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer');
    } else if (action === 'confirm-exit-local') {
      void closeApplication();
    } else if (action === 'confirm-exit') {
      if (abandonPending) return;
      abandonPending = true;
      closeAfterAbandon = true;
      render();
      window.dispatchEvent(new CustomEvent(MATCH_ABANDON_REQUEST_EVENT, {
        detail: { abandonedAtMs: performance.now(), reason: 'exit-game', closeAfter: true },
      }));
    } else if (action === 'confirm-abandon') {
      if (abandonPending) return;
      abandonPending = true;
      closeAfterAbandon = false;
      render();
      window.dispatchEvent(new CustomEvent(MATCH_ABANDON_REQUEST_EVENT, {
        detail: { abandonedAtMs: performance.now(), reason: 'player-menu', closeAfter: false },
      }));
    } else if (action === 'restart-local') {
      window.location.reload();
    }
  };

  const onInput = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'range') return;
    const key = input.dataset.settingKey;
    if (!key) return;
    const value = Number(input.value);
    setOption(key, value);
    const definition = SETTINGS_CATEGORIES.flatMap(category => category.settings).find(setting => setting.key === key);
    const output = root?.querySelector<HTMLOutputElement>(`[data-setting-output="${CSS.escape(key)}"]`);
    if (definition && output) output.value = settingValueText(definition, value);
    refreshOptionsFooter();
  };

  const onChange = (event: Event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      const key = input.dataset.settingKey;
      if (!key) return;
      setOption(key, input.type === 'checkbox' ? input.checked : input.value);
      refreshOptionsFooter();
      return;
    }
    if (input instanceof HTMLSelectElement) {
      const key = input.dataset.settingKey;
      if (!key) return;
      setOption(key, input.value);
      refreshOptionsFooter();
    }
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (activeKeybind && open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') {
        activeKeybind = null;
        statusMessage = 'Reasignación cancelada.';
        render();
        return;
      }
      if (event.code === 'F10') {
        statusMessage = 'F10 está reservado para abrir el menú de partida.';
        render();
        return;
      }
      const binding = bindingFromKeyboardEvent(event);
      setOption(activeKeybind, binding);
      activeKeybind = null;
      statusMessage = `Atajo asignado: ${formatKeyBinding(binding)}.`;
      render();
      return;
    }

    if (event.code === 'F10') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(!open);
      return;
    }

    if (!open) return;

    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (view === 'main') setOpen(false);
      else if (view === 'abandoned') return;
      else changeView('main');
      return;
    }

    const menuTarget = event.target instanceof Element && Boolean(event.target.closest(`#${MENU_ROOT_ID}`));
    if (menuTarget && event.target instanceof HTMLButtonElement && (event.code === 'Enter' || event.code === 'Space')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.target.click();
      return;
    }

    if (!isEditableTarget(event.target) && gameplayKey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const onAbandonConfirmed = (event: Event) => {
    const detail = (event as CustomEvent<{ closeAfter?: boolean }>).detail;
    const shouldClose = Boolean(detail?.closeAfter ?? closeAfterAbandon);
    abandoned = true;
    abandonPending = false;
    closeAfterAbandon = false;
    if (shouldClose) {
      void closeApplication();
      return;
    }
    view = 'abandoned';
    render();
  };

  const onAbandonFailed = (event: Event) => {
    abandonPending = false;
    closeAfterAbandon = false;
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    statusMessage = detail?.message || 'No se pudo abandonar la partida.';
    view = 'main';
    render();
  };

  window.addEventListener('dawnreach:match-abandon-confirmed', onAbandonConfirmed);
  window.addEventListener('dawnreach:match-abandon-failed', onAbandonFailed as EventListener);

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  window.addEventListener('keydown', onKeyDownCapture, true);

  publishOpenState();

  return () => {
    window.removeEventListener('dawnreach:match-abandon-confirmed', onAbandonConfirmed);
    window.removeEventListener('dawnreach:match-abandon-failed', onAbandonFailed as EventListener);
    root?.removeEventListener('click', onClick);
    root?.removeEventListener('input', onInput);
    root?.removeEventListener('change', onChange);
    window.removeEventListener('keydown', onKeyDownCapture, true);
    document.body.dataset[MENU_OPEN_DATASET_KEY] = 'false';
    root?.remove();
    void setCursorGrab(true);
  };
}
