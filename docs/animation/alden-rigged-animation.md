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
Los pies conservan su orientación de reposo y elevan 5,5 cm a velocidad base.

Revisión de la zancada: el recorrido longitudinal se centra bajo la cadera,
en vez de alrededor del tobillo atrasado de la pose original. La pelvis ajusta
su altura a la longitud de ambas piernas y al apoyo, permitiendo casi extender
la rodilla adelantada al contactar. Un mínimo suave entre los límites de ambas
piernas mantiene el doble apoyo continuo, con 6 mm de compresión adicional
durante la carga. Se conserva una pequeña flexión para evitar bloquear la rodilla.

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

- Zancada: 43,75–58 cm (50 cm a velocidad base); elevación: 5,0875–6,325 cm.
- Brazos: ±6–12° (±8° a velocidad base); antebrazos: −5 a −1°.
- Torso: inclinación 0,8–2,3°, giro ±1,65–2,1°, balanceo ±0,65°.
- Pelvis: desplazamiento lateral ±1,8 cm; altura resuelta por apoyo y alcance
  de piernas, con rodilla adelantada entre 8,14 y 8,46° de flexión al contactar.
- Capa: pose local por cadena `[-18, -3, 8, 15, 18]°`, plegado lateral
  de ±45° en las raíces externas y separación trasera de 4,5 cm.
  Oscilación máxima de walk ±1,4° en pitch y ±0,65° en roll.

| Multiplicador | Ciclo | Zancada | Brazo |
| --- | --- | --- | --- |
| 0,50 | 1,925 s | 43,75 cm | ±6° |
| 1,00 | 1,10 s | 50 cm | ±8° |
| 1,25 | 0,935 s | 53,125 cm | ±9° |
| 1,50 | 0,825 s | 56,25 cm | ±10° |
| 2,00 | 0,638 s | 58 cm | ±12° |

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
- `npm test`: 130/130.
- `npm run test:seryn`: 6/6.
- `npm run test:alden-rigged`: 9/9, sobre el GLB real con GLTFLoader.
- Contacto de suelas: error máximo 0,000754 unidades del modelo (menos de 1 mm).
- Alcance de tobillos entre 50–200 %: error máximo 0,000000128 unidades.
- La capa mantiene más de 2 cm de separación del suelo en las fases muestreadas.
- Continuidad de posición y velocidad, 12.000 muestras de idle y 3.000 de walk
  sin deriva, transformaciones de colocación, socket y buffers runtime intactos.
- Comprobación binaria del asset original y pesos del cuerpo intactos.

Inspección visual en el navegador del Model Lab: frente, espalda, ambos perfiles,
detalle facial y wireframe; reproducción y poses de marcha a diferentes fases,
incluida velocidad 200 %. Se verificaron piernas más juntas, alternancia de
brazos, cabeza/pecho coherentes y capa caída. Cambio de héroe a Seryn verificado.
Los controles Walk speed y Walk pose permiten repetir la revisión.

Revisión posterior de extensión de rodilla: build y las 9 pruebas del GLB
repetidos; se añadió comprobación del ángulo real entre muslo y tibia al contacto
para ambos lados y velocidades 50, 100, 125, 150 y 200 %. Los resultados 130/130
y 6/6 anteriores corresponden a la entrega del rig de capa; esta revisión sólo
modifica la marcha del GLB y la información de reposo expuesta por su IK.

## Archivos del cambio

- `src/game/heroes/alden/animateAldenRigged.ts`: trayectoria, IK, torso, brazos y velocidad.
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
