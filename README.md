# Dawnreach

Prototipo de MOBA isometrico con Tauri 2, React 19, TypeScript y Three.js. Guia de continuidad para una persona o un modelo que retome el proyecto sin el historial del chat.

Estado documentado: **2026-09-13**. Ultima verificacion del juego: **30 pruebas Node, compilacion web y pruebas Playwright/Edge correctas en escritorio y movil**. No equivale a una nueva validacion del ejecutable Tauri.

## 1. Antes de modificar

La prioridad del usuario es conservar lo que funciona: cambios pequenos, validacion inmediata y una forma de comparar con el estado anterior. No rehacer Alden para facilitar otra arquitectura sin autorizacion.

- Alden es el personaje predeterminado: armadura procedural, casco cerrado, espada, manto y capa animada.
- El humanoide de prueba comparte sus articulaciones y marcha, pero tiene otra geometria.
- **Alden todavia no es el cuerpo basico vestido con armadura.** Sus piezas se montan directamente sobre el rig compartido.
- El cuerpo basico tiene pecho, hombros y brazos superiores unidos mediante skinning; el resto permanece segmentado.
- Ya se redujo la cintura exagerada, se acercaron los brazos, se unieron los hombros al torso, se prolongaron las hombreras de Alden hacia el cuello y se conecto visualmente su manto con la capa.
- Mantener clic derecho, giro suave, camara ortografica, sombras, seleccion, nombre y salud. Los overlays no implican sistemas completos de combate o inventario.
- No introducir modelos externos, servicios de runtime, recursos de pago ni dependencias innecesarias. Los personajes y sus texturas se generan localmente.
- Respetar cambios sin commit. No restaurar archivos ajenos, hacer commits o cambiar ramas automaticamente; hacerlo solo si el usuario lo pide.

Lectura recomendada: [arranque](#2-arranque), [arquitectura](#3-arquitectura), [rig](#4-contrato-del-rig), [nuevos personajes](#5-crear-personajes), [Alden](#6-detalles-de-alden), [pruebas](#7-pruebas-y-preservacion), [pendientes](#8-pendientes-y-diagnostico).

## 2. Arranque

Requisitos: Node.js 22.14+ y npm. El entorno utilizado es Windows con Bash. Para navegador no hace falta Rust; para escritorio hacen falta Rust, herramientas C++ de Windows y WebView2 requeridos por Tauri 2.

Versiones declaradas en [package.json](package.json): Three.js 0.180, tipos de Three.js 0.180, React 19, TypeScript 5.8 y Vite 7. Pixi sigue declarado, pero el render activo de estos personajes es Three.js.

```sh
npm install
npm test
npm run build
npm run dev -- --host 127.0.0.1
```

El ultimo comando mantiene el servidor abierto:

- Alden: http://127.0.0.1:1420/
- Humanoide: http://127.0.0.1:1420/?rig=humanoid

Clic derecho para moverse. La variante se elige al cargar; no existe selector dentro del juego. Quitar el parametro vuelve a Alden.

[vite.config.ts](vite.config.ts) usa `strictPort: true`. Si 1420 esta ocupado, comprobar si ya es el servidor del proyecto; no cerrar procesos del usuario. Para otra instancia de navegador:

```sh
npm run dev -- --host 127.0.0.1 --port 1422
```

Esto no cambia el `devUrl` de Tauri. [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) espera `http://localhost:1420` y lanza `npm run dev` por su cuenta.

```sh
npm run tauri:dev
npm run tauri:build
```

Son operaciones alternativas, no para ejecutar junto a otro servidor en el mismo puerto. `bundle.active` esta desactivado: no prometer un instalador. Windows puede bloquear la recompilacion si una instancia nativa tiene abierto el ejecutable; no cerrarla sin permiso.

## 3. Arquitectura

| Archivo                                                                                       | Responsabilidad                                                                                 |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [src/App.tsx](src/App.tsx)                                                                     | Contenedor React de la experiencia.                                                             |
| [src/game/createDawnreachGame.ts](src/game/createDawnreachGame.ts)                             | Escena, renderer, arena, luces, overlays, seleccion de personaje, navegacion, bucle y limpieza. |
| [src/game/characters/humanoidRig.ts](src/game/characters/humanoidRig.ts)                       | Articulaciones, sockets, estado por instancia y contactos iniciales. No construye armadura.     |
| [src/game/characters/animateHumanoid.ts](src/game/characters/animateHumanoid.ts)               | Marcha, mezcla reposo/movimiento, apoyo, cintura, torso y cabeza.                               |
| [src/game/characters/buildHumanoidBody.ts](src/game/characters/buildHumanoidBody.ts)           | Cuerpo reutilizable, materiales propios, regiones ocultables y muestras de suelas.              |
| [src/game/characters/buildHumanoidUpperBody.ts](src/game/characters/buildHumanoidUpperBody.ts) | Superficie continua de pecho, hombros y brazos superiores del humanoide.                        |
| [src/game/heroes/alden/buildAlden.ts](src/game/heroes/alden/buildAlden.ts)                     | Montaje de la apariencia de Alden sobre el rig comun.                                           |
| [src/game/heroes/alden/geometry.ts](src/game/heroes/alden/geometry.ts)                         | Perfiles de armadura, hombreras, botas, espada, tela y heraldica.                               |
| [src/game/heroes/alden/materials.ts](src/game/heroes/alden/materials.ts)                       | Mapas pintados deterministas y colores por vertice. Requiere canvas/DOM para crear mapas.       |
| [src/game/heroes/alden/animateAlden.ts](src/game/heroes/alden/animateAlden.ts)                 | Marcha compartida seguida de capa; conserva las exportaciones`ALDEN_*`.                       |
| [tests/alden.test.mjs](tests/alden.test.mjs)                                                   | Pruebas Node de ambos cuerpos y referencia historica.                                           |
| [tests/verify-alden.mjs](tests/verify-alden.mjs)                                               | Pruebas del navegador y capturas con Edge.                                                      |
| [src-tauri/src/lib.rs](src-tauri/src/lib.rs)                                                   | Entrada de la aplicacion Tauri.                                                                 |

No hay un registro extensible de heroes. Crear un constructor no lo conecta automaticamente a la escena.

## 4. Contrato del rig

### Jerarquia

`HumanoidRig` usa pivotes `THREE.Group`, no un esqueleto completo basado en `THREE.Bone`.

```text
root                       posicion de navegacion
	model                    orientacion visual y correccion vertical
		pelvis                 altura base 1.18
			leftLeg/rightLeg     caderas
				leftShin/rightShin rodillas
					leftFoot/rightFoot
		torso                  altura base 1.80; hermano de pelvis
			head                 altura local 0.86
				sockets.head
			leftArm/rightArm     hombros
				leftForearm/rightForearm
					sockets.leftHand/rightHand
			sockets.back
```

Valores a escala 1. Usar referencias del rig: algunos nombres de escena son historicos, por ejemplo `helmet` para la cabeza de Alden y `elbow` para ambos codos.

- +Y arriba, +Z delante. La camara es ortografica.
- Trasladar con `root.position`, orientar con `model.rotation.y`. La animacion no debe escribir esos valores de navegacion.
- No escalar ni inclinar `root` o sus ancestros. El contacto asume esa convencion; usar `bodyScale` al construir el cuerpo.
- Pelvis y torso son hermanos. Reparentar el torso bajo la pelvis rompe la compensacion.
- La cabeza debe estar centrada en X/Z respecto al torso; la compensacion no resuelve offsets arbitrarios.
- Flexion de cadera hacia delante: X negativo. Rodilla hacia atras: X positivo. Apertura del brazo derecho: Z positivo.
- Rodillas a Y -0.55 de la cadera; tobillos a Y -0.48 de la rodilla. Hombros en X +/-0.47, Y 0.31; codos a Y -0.46; manos a Y -0.46 del codo.
- `sockets.back` esta en `(0, 0.37, -0.25)` del torso. El socket de cabeza esta en el origen de `head`.

### API y parametros

| API                                | Opciones o estado                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `createHumanoidRig(options)`     | `name = 'humanoid'`, `bodyScale = 1`, `armRestAngle = 0.18`.                                                                           |
| `buildHumanoidBody(options)`     | Las anteriores y`color = 0x428b83` para las superficies principales; otros materiales conservan sus colores.                               |
| `buildAlden(materials, options)` | `armRestAngle = 0.18`, `shoulderNeckBlend = 1`, `capeNeckBlend = 1`. **No admite escalar toda su apariencia con `bodyScale`.** |
| `rig.waistMotionScale`           | Por instancia, inicializado a`0.5`; `1` reproduce la amplitud anterior.                                                                  |
| `rig.gait`                       | `{ phase, weight }` por instancia; no compartirlo.                                                                                         |
| `rig.soleSamples`                | Muestras no vacias para cada pie, en espacio local del tobillo.                                                                              |

`bodyScale` debe ser positivo y finito. Tamanos comprobados: 0.8, 1 y 1.2; no es retargeting de cualquier anatomia. `armRestAngle` usa radianes: 0.18 son unos 10 grados, frente a los 0.24 anteriores. Elegirlo antes de montar armas o calcular bind matrices.

### Marcha aprobada

API: `animateHumanoid(rig, elapsed, moving, delta, speed)`. Tiempo/delta en segundos y velocidad positiva en unidades del mundo por segundo. Seguir llamandola al detenerse para que las articulaciones vuelvan gradualmente a reposo.

| Propiedad                     | Estado actual                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Marcha normal                 | `HUMANOID_WALK_SPEED = 2.4`.                                                                                        |
| Marcha rapida, predeterminada | `HUMANOID_FAST_WALK_SPEED = 3.8`; `HUMANOID_DEFAULT_MOVE_SPEED` usa ese valor.                                    |
| Cadencia                      | Paso nominal 1.2; unos 120/190 pasos por minuto a escala 1. Se ajusta inversamente a`bodyScale`.                    |
| Rodilla                       | 4 grados en contacto, 18 al cargar y maximo 60 en recuperacion.                                                       |
| Cadera                        | Flexion 28 en contacto, extension 12 y recuperacion hasta 30 grados.                                                  |
| Tobillo                       | Neutral en contacto, flexion plantar 5, dorsiflexion de apoyo 10, impulso 18 y recuperacion hasta 20 de dorsiflexion. |
| Pelvis                        | Giro horizontal hasta 2 grados, inclinacion lateral 2.5 y desplazamiento lateral 0.0175.                              |
| Pecho                         | Contrarrotacion horizontal/lateral; inclinacion lateral hasta 1.5 grados.                                             |
| Carga vertical                | Ciclo suave de 0.04 unidades entre minimo y maximo a escala 1.                                                        |

Las curvas exactas estan en [src/game/characters/animateHumanoid.ts](src/game/characters/animateHumanoid.ts). La flexion temprana de la rodilla trasera evita que las botas grandes atraviesen el suelo. No sustituir esa curva sin comprobar el resultado.

El minimo de las suelas corrige la altura del modelo; el torso compensa esa correccion para no heredar saltos bruscos. La cabeza cancela la rotacion del torso y mantiene su centro lateral. Es animacion estilizada: no hay pies bloqueados fisicamente, IK de terreno, simulacion del centro de masa ni unidades calibradas en metros.

## 5. Crear personajes

### Camino A: cuerpo basico

Es el camino mas corto para una nueva apariencia compatible. Crear un modulo propio siguiendo la carpeta de Alden. Ejemplo de destino **futuro, no existente**:

```text
src/game/heroes/recruit/buildRecruit.ts
```

Los ejemplos TypeScript siguientes asumen esa profundidad de carpeta. Este documento no crea ni registra al recluta.

```ts
import { buildHumanoidBody } from '../../characters/buildHumanoidBody.js';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../../characters/animateHumanoid.js';

export function buildRecruit() {
	return buildHumanoidBody({
		name: 'recruit', bodyScale: 0.9, color: 0x964957, armRestAngle: 0.18,
	});
}

export function animateRecruit(
	rig: ReturnType<typeof buildRecruit>,
	elapsed: number,
	moving: boolean,
	delta: number,
	speed = HUMANOID_DEFAULT_MOVE_SPEED,
) {
	animateHumanoid(rig, elapsed, moving, delta, speed);
}
```

Sin animacion especifica, el wrapper es opcional: llamar directamente a `animateHumanoid`. Para dos personajes, ejecutar dos veces el constructor; no clonar superficialmente ni compartir estado, geometria deformable o esqueleto.

### Equipo y regiones ocultables

`bodyParts` contiene `pelvis`, `torso`, `head`, `leftLeg`, `rightLeg`, `leftShin`, `rightShin`, `leftFoot`, `rightFoot`, `leftArm`, `rightArm`, `leftForearm`, `rightForearm`, `leftHand` y `rightHand`.

Ocultar una region visual no debe ocultar/eliminar el pivote o sus sockets. Este ejemplo sustituye visualmente el antebrazo izquierdo por un brazal sin desconectar la mano:

```ts
import * as THREE from 'three';
import { buildHumanoidBody } from '../../characters/buildHumanoidBody.js';

export function equipBracer(body: ReturnType<typeof buildHumanoidBody>) {
	const geometry = new THREE.CylinderGeometry(0.108, 0.083, 0.34, 12);
	geometry.translate(0, -0.22, 0);
	geometry.scale(body.bodyScale, body.bodyScale, body.bodyScale);
	const material = new THREE.MeshStandardMaterial({
		color: 0xb6c2c0, roughness: 0.55, metalness: 0.65,
	});
	const bracer = new THREE.Mesh(geometry, material);
	bracer.name = 'recruit-left-bracer';
	bracer.castShadow = true;
	bracer.receiveShadow = true;
	const wasVisible = body.bodyParts.leftForearm.visible;
	body.bodyParts.leftForearm.visible = false;
	body.leftForearm.add(bracer);
	return () => {
		bracer.removeFromParent();
		body.bodyParts.leftForearm.visible = wasVisible;
		geometry.dispose();
		material.dispose();
	};
}
```

No es un inventario ni resuelve multiples equipamientos simultaneos. Ajustar el perfil definitivo y comprobarlo durante la marcha.

Para armas: `rig.sockets.rightHand.add(weapon)` o el socket izquierdo. Modelar el origen en el agarre, ajustar orientacion/tamano y comprobar la mano alrededor del mango. `weapon.removeFromParent()` desacopla, pero no libera recursos. Casco y espalda usan `sockets.head` y `sockets.back`.

El equipo debe ajustarse a `bodyScale`: escalar su geometria/objeto, no el rig completo. Una prenda que cubra pecho y brazos necesita pesos compatibles; sujetarla rigidamente al torso no la hace seguir ambos brazos.

### Camino B: apariencia propia

Usar `createHumanoidRig({ name: 'otro-heroe' })` sin `buildHumanoidBody`. Anadir geometria a sus articulaciones y devolver el rig con los datos del personaje. Asi se construye Alden.

1. Mantener posiciones, ejes y jerarquia mientras se prueba la apariencia.
2. Usar superficies ajustadas; no volver a hombros como esferas separadas.
3. Activar sombras y crear normales/indices validos. Los materiales con mapas necesitan UVs apropiadas.
4. Definir contactos reales del calzado; las muestras del rig desnudo son aproximadas.
5. Reutilizar la marcha; animar accesorios despues sin reescribir las articulaciones.
6. Reutilizar utilidades apropiadas, sin hacer que el nucleo compartido dependa de Alden.

Atencion: `createPauldronGeometry()` y `createCapeGeometry()` conservan mezcla 0 historica, mientras `buildAlden` pasa mezcla 1 por defecto.

### Calzado y contacto

Usar vertices reales de suela en el espacio local del tobillo, no cajas envolventes. Ejemplo para reemplazar contactos despues de montar un calzado nuevo:

```ts
import * as THREE from 'three';
import type { HumanoidRig } from '../../characters/humanoidRig.js';

export function setFootContacts(rig: HumanoidRig, foot: THREE.Group, sole: THREE.Mesh) {
	if (foot !== rig.leftFoot && foot !== rig.rightFoot) {
		throw new Error('The contact owner must be a foot of this rig');
	}
	const position = sole.geometry.getAttribute('position');
	if (!position || position.count === 0) throw new Error('The sole needs vertices');
	foot.updateWorldMatrix(true, true);
	const toFoot = foot.matrixWorld.clone().invert().multiply(sole.matrixWorld);
	const points = Array.from({ length: position.count }, (_, vertex) =>
		new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(toFoot),
	);
	rig.soleSamples = rig.soleSamples.map(sample =>
		sample.foot === foot ? { foot, points } : sample,
	);
}
```

Precondiciones: la suela ya es descendiente de `foot`, el rig conserva una entrada por pie y la suela es rigida respecto al tobillo. Una suela skinned requiere aplicar su deformacion antes de muestrearla. No dejar las muestras vacias: el minimo de contacto quedaria en infinito.

### Integracion con el juego

El punto de integracion es [src/game/createDawnreachGame.ts](src/game/createDawnreachGame.ts), no React ni la geometria del heroe.

1. Importar el constructor y seleccionarlo donde hoy se decide entre Alden y `?rig=humanoid`.
2. Mantener Alden predeterminado. `?rig=recruit` seria una opcion **nueva que hay que implementar**, no una ruta actual.
3. Anadir `hero.root`, aplicar posicion inicial y pasar el nombre correcto a `addHeroOverlay`.
4. En el bucle existente, actualizar posicion/yaw y llamar una vez al animador adecuado con `elapsed`, `moving`, `dt` y la velocidad usada para avanzar.
5. No crear otro renderer, reloj o `requestAnimationFrame` por personaje.
6. Para varios personajes simultaneos, cada uno necesita destino, yaw y movimiento propios. Las variables actuales controlan un solo heroe.
7. Ampliar el test visual para el nombre nuevo; el script actual conoce expresamente `alden` y `humanoid`.

La altura del rotulo y el radio de seleccion son fijos. Adaptarlos localmente para otros tamanos, sin alterar los de Alden ni la camara.

## 6. Detalles de Alden

### Materiales y uniones

Paleta aprobada: plata, oro calido, azul real, cuero marron y cota de malla discreta. Los mapas `CanvasTexture` son deterministas. `applyPaintedFinish` anade colores por vertice sin cambiar posiciones, normales ni UVs.

Tela del pecho y heraldica se proyectan sobre el perfil del peto. Ribetes/emblemas deben usar la misma superficie que la tela; planos independientes produjeron intersecciones. Mantener perfiles y curvas, no sustituir armadura por cajas redimensionadas.

Las hombreras prolongan su parte interior 0.19 unidades hacia el cuello, aplanandola ligeramente. La mezcla desaparece hacia el exterior; las laminas inferiores no cambian. Manto y capa son mallas diferentes que se solapan: la capa sigue el contorno real de 12 lados de `mantleSections` a altura 0.40 del torso, ligeramente por dentro. El ajuste desaparece en el primer 20% de caida y los ribetes siguen la misma superficie. Cambiar el socket trasero o el perfil del manto exige revisar esa union.

### Espada y animacion

- Espada horizontal en reposo, filos arriba/abajo; la hoja se extiende por su eje local -Y.
- Mano derecha y arma comparten pivote. El guante pertenece al montaje especifico de Alden.
- El quaternion de agarre se calcula una vez, despues de definir los hombros. No contrarrotar el arma cada frame: al caminar debe seguir el brazo.
- `animateAlden` ya llama a `animateHumanoid`. No llamar a ambos desde la escena para la misma instancia o se avanzara dos veces la fase.
- La capa se deforma desde arrays `rest` inmutables, no desde el frame anterior. Actualizar normales tras modificar posiciones.
- Ribetes y emblema tambien se deforman; la tela se asienta gradualmente al detenerse.

### Superficie del humanoide

Tres regiones `SkinnedMesh` para pecho y brazos superiores comparten atributos de posicion/normal en los bordes y un esqueleto propio de tres huesos asociado a los pivotes existentes. Ocultar regiones no elimina articulaciones. El resto no se ha convertido a skinning, y Alden no usa esta superficie debajo de su armadura.

Las bind matrices se calculan al construir. No reparentar ni cambiar proporciones despues sin recalcularlas. Los vertices se construyen en espacio del torso y las mallas compensan el padre de cada region. Actualmente desactivan `frustumCulled`; no existe un calculo optimizado de bounds animados.

Leccion verificada: una union puede pasar pruebas de posiciones y renderizar agujeros si el winding es incorrecto. Se corrigieron las caras invertidas de los hombros, no se oculto el problema con doble cara. Verificar superficie cerrada, orientacion, normales y capturas delante/detras.

## 7. Pruebas y preservacion

### Pruebas locales

```sh
npm test
npm run build
```

TypeScript compila las pruebas a CommonJS con `--rootDir src/game`, en rutas ignoradas:

```text
node_modules/.cache/alden-test/heroes/alden/
node_modules/.cache/alden-test/characters/
```

No usar las antiguas rutas planas de cache: pueden contener salida obsoleta. Si un modulo nuevo no es importado por las entradas actuales, anadirlo a la compilacion de pruebas antes de requerirlo. Reutilizar [tests/alden.test.mjs](tests/alden.test.mjs) para cambios compartidos; evitar un archivo por ajuste pequeno.

Las pruebas usan materiales sencillos sin DOM. Cubren geometria, triangulos, sombras, articulaciones, contacto, cintura/cabeza, espada/capa, arranque/parada, ambas velocidades y 30/60/120 FPS. Tambien independencia de instancias, tamanos, sockets, hombros continuos, hombreras y union capa/manto. **No sustituyen la inspeccion visual.**

### Referencia historica

[tests/fixtures/alden-before-shared-rig.json](tests/fixtures/alden-before-shared-rig.json) guarda 27 firmas SHA-256 pre-extraccion: reposo, doce fases/orientaciones y arranque/parada a ambas velocidades. Incluyen geometria, materiales, sombras y matrices mundiales redondeadas a nueve decimales; no dependen del orden de recorrido.

| Parametro             | Perfil historico | Actual |
| --------------------- | ---------------- | ------ |
| `waistMotionScale`  | 1                | 0.5    |
| `armRestAngle`      | 0.24             | 0.18   |
| `shoulderNeckBlend` | 0                | 1      |
| `capeNeckBlend`     | 0                | 1      |

La prueba historica elige esos valores antiguos expresamente; otras pruebas validan los nuevos. **No regenerar ni borrar el fixture para ocultar una regresion.** `CAPTURE_ALDEN_REFERENCE=1` fue solo para la captura inicial y usa escritura exclusiva; no es un comando normal de actualizacion. Los mapas reales se verifican aparte en navegador.

Existe un respaldo historico fuera del repositorio, junto al checkout:

```text
../dawnreach-before-shared-rig-20260913-014657.tar.gz
```

Incluye el codigo sin commit de aquel momento y excluye dependencias, builds y Git. Es anterior a cintura, brazos y uniones: **no es una copia del estado actual** ni estara necesariamente en otra maquina. No restaurarlo sobre trabajo posterior. Antes de una migracion arriesgada, crear una referencia nueva y revisar Git.

### Navegador

Con el servidor abierto y Microsoft Edge instalado:

```sh
npm install --no-save --package-lock=false playwright
node tests/verify-alden.mjs
```

Playwright es una instalacion local, no una dependencia declarada. Para otro puerto en Bash:

```sh
ALDEN_URL=http://127.0.0.1:1422/ node tests/verify-alden.mjs
```

En PowerShell:

```powershell
$env:ALDEN_URL = 'http://127.0.0.1:1422/'
node tests/verify-alden.mjs
Remove-Item Env:ALDEN_URL
```

El script abre Edge headless, hace ocho movimientos reales, comprueba giro/camara/velocidad y mide codos, rodillas, torso, cabeza y capa. Verifica mapas deterministas, paleta, rugosidad, colores, errores y pixeles en 1280x800 y 390x844; tambien el humanoide sin equipo. El alto efectivo del canvas depende de la interfaz.

Salidas en la carpeta ignorada `node_modules/.cache/alden-visual/`:

```text
desktop.png                  Alden antes de moverse
desktop-after-movement.png   Alden despues de recorrer direcciones
mobile.png                   Alden en movil
turnaround.png               frente, tres cuartos, perfil, espalda
walk-cycle.png               contacto/recuperacion
weight-transfer.png          carga/apoyo con camara frontal fija
humanoid-walk-cycle.png       poses del cuerpo basico
humanoid-1280.png             humanoide en escritorio
humanoid-390.png              humanoide en movil
```

No esta implementada una salida `humanoid-shoulders.png`. Las camaras de inspeccion solo existen en el test; no cambiar la camara del juego por ellas.

Importar la misma instancia de Three.js que usa Vite, como hace el test. En inspecciones, anadir `rig.root`, no separar `model`: el apoyo depende de esa jerarquia. Limpiar `stage.onAfterRender` especifico de Alden al sustituirlo por otro cuerpo para evitar acceder a un modelo inexistente.

### Verificacion del HUD

El layout esta en [src/App.tsx](src/App.tsx). [src/main.tsx](src/main.tsx) carga primero los estilos base y despues [src/hud-overrides.css](src/hud-overrides.css); conservar ese orden para que los ajustes del HUD no queden sobrescritos. Las habilidades usan imagenes de la carpeta del heroe con la convencion `<codigo><tecla>.png`: Alden usa `H001Q.png`, `H001W.png`, `H001E.png` y `H001R.png` dentro de su carpeta `images`. Vite las descubre con `import.meta.glob` y las incluye en produccion; si falta un archivo se mantiene el icono provisional de [src/assets/hud-art.svg](src/assets/hud-art.svg), que tambien contiene el arte de objetos. Para otro heroe, ajustar carpeta y codigo en el mapeo del HUD. Los iconos de atributos y herramientas usan Lucide. Los retratos de Alden se resuelven con `new URL(..., import.meta.url)` para incluirlos tambien en produccion.

Las habilidades, atributos, salud y mana del HUD usan una partida local creada por [src/game/match/abilityControls.ts](src/game/match/abilityControls.ts). Se conserva el nivel 11 del prototipo y se aprenden los rangos disponibles segun el `gameplay.ts` del heroe: para Alden son Q2, W2, E1 y R1. Los clics y teclas Q/W/E/R llaman al mismo resolver de gameplay, consumen recursos e inician cooldowns por rango. La regeneracion de mana usa las estadisticas del heroe. Se ignoran teclas repetidas, modificadores y escritura en campos editables.

[src/hud/AbilityButton.tsx](src/hud/AbilityButton.tsx) muestra rangos, progreso de recarga y tooltips con tipo, descripcion, lore, coste y siguiente nivel de mejora. Las pasivas puras estan deshabilitadas y tienen tratamiento visual propio; `active_with_passive` conserva su parte activa. La pasiva innata de Alden tiene su propio sello no utilizable. Los tooltips admiten hover, foco y Escape, y se ajustan al viewport.

Los lanzamientos todavia no reciben objetivos de la escena 3D: esto conecta controles, costes y estados de gameplay, no animaciones de habilidades, seleccion de objetivos ni impactos visuales. Solo Alden tiene actualmente un resolver registrado; otro heroe necesita su definicion en el catalogo y su resolver/preview. El marcador, inventario ilustrado y oro siguen siendo de muestra. Las herramientas del minimapa siguen siendo decorativas. Mapa, camara y animacion no cambian por esta conexion del HUD.

Con Edge, Playwright y el servidor local disponibles:

```sh
node tests/verify-hud.mjs
```

[tests/verify-hud.mjs](tests/verify-hud.mjs) comprueba siete viewports (1440x900, 1176x768, 1024x768, 800x600, 390x844, 320x640 y 844x390), limites de paneles/textos, ausencia de solapamientos, carga de retratos/simbolos, pixeles de canvas e iconos y movimiento por clic derecho. Tambien comprueba clic/teclas, rangos, consumo de mana, expiracion de cooldown, bloqueo de pasivas y tooltips. El panel se limita a 721 px en escritorio y las habilidades permanecen agrupadas, sin espacios expansivos. Acepta `ALDEN_URL` igual que el test de Alden y guarda capturas en `node_modules/.cache/hud-visual/`. No sustituye la bateria de animacion o gameplay.

## 8. Pendientes y diagnostico

No estan implementados: Alden vestido sobre el cuerpo basico, ropa completa con skinning, retargeting anatomico, carrera, ataques, caidas, ragdoll, controlador de acciones, mezcla por capas, inventario, selector general, IA de combate, navegacion con obstaculos o locomocion fisica sobre pendientes.

Pendientes tecnicos comprobados:

- **Limpieza de skinning:** `disposeScene` libera geometria, materiales y mapas, pero todavia no llama a `Skeleton.dispose()` para el humanoide. Antes de ampliar creacion/destruccion dinamica, liberar esqueletos compartidos una sola vez y comprobar recursos GPU. Quitar una malla no los libera.
- La limpieza actual contempla `.map`, no todos los tipos de textura que se puedan introducir. No liberar varias veces materiales/mapas compartidos.
- El build avisa de un chunk superior a 500 kB, pero termina correctamente. No reorganizar el bundle dentro de un ajuste visual pequeno.
- Las versiones de paquete, Tauri e interfaz no estan unificadas; no son evidencia de una release publicada.
- Tauri tiene empaquetado desactivado y CSP `null`; la distribucion final requiere revision. Las ultimas validaciones de personajes fueron web, no una bateria nativa nueva.

Lecciones de diagnostico:

- Las rayas finas en acero/tela fueron en gran parte acne de sombras. La luz usa `bias = -0.00012`, `normalBias = 0.025`; no compensarlo ensuciando texturas.
- Ante texturas negras o escenas antiguas, revisar recarga completa/servidor antes de modificar geometria. Un incidente desaparecio tras reiniciar sin causa GPU demostrada.
- Vite recarga completamente cambios en `src/game` y espera escrituras estables. No introducir HMR parcial sin gestionar recursos.
- No generar configuraciones antiguas que oculten [vite.config.ts](vite.config.ts); [tsconfig.node.json](tsconfig.node.json) mantiene `noEmit`.
- `Box3` puede dar falsos positivos de penetracion: usar vertices reales de suela.
- Seno/negacion pueden producir `-0`; Node lo distingue de `0` en aserciones estrictas.
- El navegador integrado del editor llego a imponer un viewport diminuto; el script independiente de Edge produjo capturas fiables.

## 9. Continuar sin perder avances

1. Leer este documento y el archivo que controla el cambio. Revisar trabajo local; no asumir un arbol limpio ni que todo esta en Git.
2. Ejecutar pruebas relevantes antes de modificar. Para apariencia/marcha, comprobar tambien el navegador.
3. Separar geometria, animacion, navegacion y materiales; no tocar todo a la vez para un defecto localizado.
4. Hacer un cambio pequeno y validarlo inmediatamente. Reparar esa zona antes de ampliar el trabajo.
5. Probar heroes nuevos como variantes optativas y mantener Alden predeterminado. Reutilizar rig/marcha, no copiar un sistema por heroe.
6. Si se migra Alden al cuerpo basico, comprobar armadura en otra variante y comparar frente/perfil/espalda y ciclo completo antes de sustituirlo.
7. Para nuevas acciones, definir quien compone la pose final. La marcha escribe directamente en los joints; dos animadores consecutivos pueden anularse.
8. Revisar capturas reales: pies, manos/arma, hombros/cuello, capa/manto, sombras y huecos al moverse.
9. Actualizar esta guia solo con contratos y resultados reales, indicar lo no verificado y no presentar una propuesta como funcionalidad terminada.
