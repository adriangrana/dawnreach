# Alden: marcha, velocidad y capa

## Alcance

Corrección del GLB que carga Hero Model Lab. El usuario autorizó expresamente
corregir el rig de la capa después de la restricción inicial sobre el asset.
No se modificaron los archivos Blender, stats, habilidades, networking ni Seryn.

El juego todavía instancia el Alden procedural en `createDawnreachGame.ts`;
este trabajo no migra ese constructor. El controlador del GLB acepta el cociente
`velocidad efectiva / velocidad base`, preparado para botas y otros modificadores.
Cuando se integre el GLB en la partida, ese cociente deberá proceder del movimiento
real. La calibración absoluta de avance respecto al suelo deberá hacerse con la
escala final del personaje: el visor reproduce una marcha sin traslación.

## Diagnóstico y solución

La exportación contiene muchas ramas desconectadas: pecho, hombros, brazos y
87 huesos faciales son hijos directos de `rig`. Rotar sólo la columna no arrastra
esas regiones. Se aplica una transformación coherente en espacio del modelo a
todas esas ramas y después se resuelven piernas y brazos.

La marcha anterior separaba los tobillos unos 53 cm, penetraba el suelo unos
2,6 cm y apenas elevaba el pie libre. Ahora la separación objetivo es 32 cm;
cada pierna usa IK de dos segmentos con su plano de rodilla original, sin escalar
huesos. Cada pie apoya el 60 % del ciclo, con doble apoyo y retorno suave.
Las botas giran desde el talón hasta la punta. Una tabla de su silueta real
determina la altura de contacto, incluyendo los vértices del talón que conservan
algo de peso de la espinilla. No se alteran pesos ni vértices durante la marcha.

La revisión del 28 de septiembre elimina el doble rebote antes del despegue.
La interpolación anterior usaba la posición hipotética del pie libre en el suelo
para transferir el peso: bajaba la pelvis y volvía a doblar la rodilla trasera.
Ahora la transferencia enlaza con la altura del siguiente contacto y conserva
su velocidad. La pierna trasera ajusta su alcance longitudinal mientras se acorta;
el pie libre resuelve su altura desde la flexión, sin tirar de la pelvis.
La trayectoria final incluye esa corrección y el giro de la bota: no es un bloqueo
perfecto del pie en coordenadas del mundo. La calibración de avance queda pendiente
de integrar el GLB en el juego.

Los hitos de flexión son 3° al contacto, 18° al amortiguar, 3° en apoyo medio y
terminal, 20° en preoscilación, 38° al despegar, 60° en oscilación inicial y 25°
en oscilación media. Interpolación cúbica monótona evita invertir el movimiento
o detenerlo en cada hito intermedio. Son objetivos de rodilla sobre este rig;
el pitch de la suela no equivale al ángulo anatómico del tobillo.

La capa compartía pesos con espalda y brazos y no tenía articulaciones propias.
Se añadieron 15 huesos en tres cadenas de cinco, ancladas a `DEF-spine.003`.
La pose de caída y las pequeñas oscilaciones con desfase permiten balancear los
brazos sin arrastrar toda la capa. Es una aproximación cinemática a la caída y
la inercia; no incluye simulación física ni colisiones de tela.

## Huesos y amplitudes

Los nombres son los originales del GLB; GLTFLoader elimina puntos en los nombres
runtime, por lo que se resuelven mediante `userData.name`.

| Huesos o conjunto | Región y uso |
| --- | --- |
| `DEF-spine` y cadena `.001` a `.006` | Pelvis, abdomen, espalda, cuello y núcleo de cabeza. Pivot del cuerpo al caminar; abdomen al respirar. |
| `DEF-pelvis.L/R` | Placas laterales de cintura, acompañan la pelvis en walk. |
| `DEF-breast.L/R` | Pectorales: mismo movimiento rígido que el torso. |
| `DEF-shoulder.L/R` | Hombreras y anclajes superiores de capa. |
| `DEF-upper_arm.L/R`, `DEF-forearm.L/R` | Balanceo alterno de brazos y flexión de codos; manos y dedos heredan. |
| `DEF-thigh.L/R`, `DEF-shin.L/R`, `DEF-foot.L/R` | IK de piernas y orientación de botas. Subdivisiones `.001` y dedos heredan. |
| Los 87 nombres de `FACE_BRANCHES` en `animateAldenRigged.ts` | Cara, máscara y casco siguen el torso como un conjunto rígido. No hay animación facial independiente. |
| `neutral_bone` | Cinco vértices de espalda superior, acompaña al torso. |
| `CAPE-R.0..4`, `CAPE-C.0..4`, `CAPE-L.0..4` | Lados y centro de la capa, con desfase creciente hacia el borde inferior. |
| `weapon_socket.R` | Conserva su transformación local y padre `DEF-hand.R`; no se escribe. |

Idle conserva su ciclo exacto de **4 segundos**, respiración máxima de **0,5°**
y balanceo de **±0,2°**, con pies inmóviles. La capa tiene oscilaciones locales
de hasta ±0,2° en pitch y ±0,08° en roll sobre su pose caída.

Walk base dura **1,1 segundos** (dos pasos). En el rango validado 50–200 %:

- Recorrido longitudinal nominal: 80,75–91,8 cm (85 cm a velocidad base).
  El giro de la bota y el alcance de la pierna ajustan la trayectoria final.
  La elevación real máxima de la suela a velocidad base es aproximadamente 13 cm.
- Brazos: ±6–12° (±8° a velocidad base); antebrazos: −5 a −1°.
- Torso: corrección de la inclinación de reposo 9,7–10,6°, giro ±1,65–2,1°,
  balanceo ±0,65°. La cabeza queda por delante de la pelvis, sin echarse atrás.
- Pelvis: desplazamiento lateral ±1,2 cm; altura resuelta desde el apoyo,
  con rodilla adelantada a 3° de flexión al contactar.
- Capa: pose local por cadena `[-18, -3, 8, 15, 18]°`, plegado lateral
  de ±45° en las raíces externas y separación trasera de 4,5 cm.
  Oscilación máxima de walk ±1,4° en pitch y ±0,65° en roll.
  La raíz compensa la inclinación del torso para conservar la caída de la tela.

| Multiplicador | Ciclo | Zancada | Brazo |
| --- | --- | --- | --- |
| 0,50 | 2,09 s | 80,75 cm | ±6° |
| 1,00 | 1,10 s | 85 cm | ±8° |
| 1,25 | 0,902 s | 87,125 cm | ±9° |
| 1,50 | 0,77 s | 89,25 cm | ±10° |
| 2,00 | 0,594 s | 91,8 cm | ±12° |

La zancada tiene un límite de alcance; la cadencia absorbe el resto del aumento.
La fase se integra con delta y la velocidad se suaviza con constante de 0,12 s,
evitando saltos al equipar botas. Idle/walk se mezclan durante 0,2 s.
`apply` permite inspección determinista; `advance` debe usarse en reproducción.

## Asset y reproducción

El audit histórico `alden-skin-audit.json` describe el GLB original de 161 joints,
SHA-256 `bf1b121f0e30ae9ab13a74d469890aaa079f44a2553aad8c35d5fce77d628d62`.
El GLB corregido tiene **176 joints**, conserva **48.338 vértices**, **58.980
triángulos**, materiales, texturas, UV, normales, geometría y transformaciones
de todos los nodos originales. Cambian los pesos de **16.554 vértices** de tela
trasera. El bloque binario original se conserva íntegro; se añaden nuevas tablas
de skin y matrices inversas. Los metadatos `extras.dawnreachCapeRig` registran
hashes y estructuras originales para comprobar estas garantías.

`scripts/assets/rig-alden-cape.mjs` recibe el original y el destino:

```text
node scripts/assets/rig-alden-cape.mjs <original-auditado.glb> <destino.glb>
```

El original está en el commit `90357122772ababfe11252a58c077735d2a8c68d`.
El script valida su hash y rechaza aplicar el parche dos veces. No reexporta
Blender ni cambia la topología del cuerpo.

Anomalías originales conservadas: pesos de `DEF-f_ring.03.L` alcanzan parte del
muslo izquierdo; las ramas faciales están aplanadas; cinco vértices superiores
dependen de `neutral_bone`. El cambio autorizado de pesos se limita a la capa.

## Validación local

- `npm run build`: correcto; aviso de Vite por tamaño de chunks.
- `npm run test:alden-rigged`: 10/10, sobre el GLB real con GLTFLoader.
- Contacto de suelas: error máximo 0,000985 unidades del modelo (menos de 1 mm).
- Longitud de muslo y espinilla entre 50–200 %: error máximo 0,000000086 unidades.
- Ambas rodillas: ninguna inversión de flexión entre apoyo terminal y pico de
  balanceo, ni en la extensión posterior; muestreo cada 0,001 ciclos a 50, 100,
  125, 150 y 200 %. Tampoco se detienen en los hitos de preoscilación y despegue.
- La capa mantiene más de 5 cm de separación del suelo en las fases muestreadas.
- Continuidad de posición y velocidad, 12.000 muestras de idle y 3.000 de walk
  sin deriva, transformaciones de colocación, socket y buffers runtime intactos.
- Comprobación binaria del asset original y pesos del cuerpo intactos.

Inspección visual en el navegador del Model Lab: frente, espalda, ambos perfiles,
detalle facial y wireframe; reproducción y poses de marcha a diferentes fases,
incluida velocidad 200 %. Se verificaron piernas más juntas, alternancia de
brazos, cabeza/pecho coherentes y capa caída. Cambio de héroe a Seryn verificado.
Los controles Walk speed y Walk pose permiten repetir la revisión.

Las 130 pruebas generales y las 6 de Seryn pasaron en la entrega anterior del
rig de capa; no se repitieron en esta revisión de la marcha del GLB. El asset
permanece intacto en esta revisión; se modifican únicamente los controladores,
sus pruebas y esta documentación.

## Archivos del cambio

- `src/game/heroes/alden/animateAldenRigged.ts`: trayectoria, IK, torso, brazos y velocidad.
- `src/game/heroes/alden/aldenWalkPhases.ts`: hitos y curvas monótonas de marcha.
- `src/game/heroes/alden/aldenFootContact.ts`: silueta de contacto de las botas.
- `src/game/heroes/alden/animateAldenCape.ts`: pose caída y oscilación de capa.
- `src/game/heroes/alden/model/alden_rigged_socket.glb`: rig y pesos de capa.
- `src/game/heroes/animation/twoBoneLeg.ts`: resolución de piernas.
- `src/game/heroes/animation/rotateBoneInSpace.ts`: rotación de brazos en espacio del modelo.
- `src/game/heroes/animation/coherentBoneMotion.ts`: traslación coherente opcional.
- `src/game/heroes/devModels.ts`: reproducción con velocidad y mezcla idle/walk.
- `src/dev/HeroModelViewer.tsx`: inspección de velocidad y fase.
- `scripts/assets/rig-alden-cape.mjs`: modificación reproducible del asset.
- `tests/alden-rigged.test.mjs`: comprobaciones del asset y animación.
- Este documento: parámetros, auditoría y límites de integración.
