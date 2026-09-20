# H002 — Seryn, la Vigía del Horizonte

Estado: **diseño/gameplay definido; todavía no registrada como héroe jugable**.

La decisión es intencional. Seryn no debe aparecer en Hero Select ni en la página HEROES hasta que existan sus imágenes, modelo/rig, animaciones y resolver de combate. Registrar una definición incompleta rompería la presentación y permitiría seleccionar un héroe cuyo runtime todavía no existe.

## Identidad

- ID: `H002`
- Nombre: **Seryn**
- Clase: **Vigía**
- Atributo principal: **AGI**
- Arquetipo: **Tiradora-Escaramuzadora**
- Despliegue principal: **NORTH / SOUTH**
- Despliegue secundario: **MID**
- Dawnreach conserva el reparto de equipo **2 / 1 / 2**. Seryn no es un "carry", "support" o "jungler" obligatorio.
- Dificultad: **Media**
- Recurso: **Maná**
- Alcance de ataque: **575**

## Presupuesto de poder

| Área | Objetivo |
| --- | --- |
| Burst | Medio |
| Daño sostenido | Alto |
| Control | Medio |
| Movilidad | Media |
| Durabilidad | Baja |
| Alcance | Alto |

La regla de balance es que Seryn paga su alcance y DPS con una vida/defensas claramente menores que Alden. W aporta movilidad pero **cero daño**. E aporta el control duro, pero su raíz máxima es de **1 s**, requiere acertar el centro y tiene **0.55 s de armado**. R tiene alcance alto y tres impactos, pero usa una línea telegráfica y los impactos repetidos contra el mismo objetivo bajan al **65%**.

A nivel 1, sin objetos:

- Vida: **540**
- Maná: **360**
- Ataque: **54**
- Armadura: **24**
- Resistencia mágica: **22**
- Velocidad de ataque: **0.86768**
- Movimiento: **330**
- Alcance: **575**

Como referencia, Alden empieza con 640 de vida, 66 de ataque, 32 de armadura, 28 de resistencia mágica y 175 de alcance. Seryn es más segura por distancia y más rápida atacando, pero pierde margen de error si la alcanzan.

El archivo `balance.ts` mantiene un cálculo puro del presupuesto de daño. Con estadísticas base, a nivel 18 y rangos máximos, Q + E + los 3 disparos de R + un básico + un proc de la innata queda bajo un techo de **1450 de daño bruto antes de resistencias**. Ese techo es una alarma de regresión, no un objetivo para todas las partidas.

## Kit

### Innata — Línea de Horizonte

Básicos contra héroes/élites/jefes desde al menos 450 de distancia aplican Trazo. A 3 Trazos el objetivo queda Alineado; el siguiente básico consume el estado e inflige daño físico adicional. Existe lockout por objetivo para que el proc no convierta la fase de línea en daño automático permanente.

### Q — Flecha de Refracción

Skillshot lineal físico de 925. Puede atravesar unidades normales con daño reducido y se detiene en el primer héroe/élite/jefe. Es la herramienta principal de poke, no un burst instantáneo.

### W — Paso de Vector

Dash terrestre de 300, sin daño. Después concede velocidad de ataque durante 3 s. Sirve para conservar o corregir distancia, pero usarlo ofensivamente deja una ventana clara sin escape.

### E — Ancla Prismática

Zona con 0.55 s de armado. Daño mágico moderado + slow. Solo el centro de 95 aplica root. El control potente requiere precisión y tiene respuesta visual.

### R — Meridiano Partido

Tres disparos por una línea de 1200. El primero contra un objetivo hace daño completo; el segundo y tercero hacen 65% cada uno. La línea y el tiempo entre disparos permiten salir del meridiano.

## Orden de implementación

1. Cerrar arte definitivo y generar los assets de `images/`.
2. Construir `buildSeryn.ts` reutilizando el rig humanoide compartido; no copiar el rig de Alden.
3. Crear `animateSeryn.ts` para idle, básico, Q/W/E/R.
4. Crear resolver de combate de H002 y eliminar el supuesto actual de `combat.ts` / `abilityControls.ts` de que solo H001 tiene resolver.
5. Crear runtime/presentación de habilidades y VFX.
6. Registrar H002 en `catalog.ts`.
7. Conectar imágenes en HEROES, Hero Select, Loading, HUD, scoreboard y post-match.
8. Añadir tests de duelo H001 vs H002 y revisar daño a niveles 1/6/11/18/30.

## Assets

Ver `images/README.md` y `visualSpec.ts`. Todas las imágenes nuevas deben prepararse en **WebP**.
