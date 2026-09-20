# H002 — Seryn, la Vigía del Horizonte

Estado: **registrada como H002 y conectada al roster, Hero Select y runtime de combate**.

Seryn comparte la infraestructura genérica de héroes con Alden: catálogo, selección, loading, HUD, minimapa, MatchState y resolución de combate. Su modelo 3D actual es procedural y específico de H002; puede refinarse visualmente sin cambiar su definición de gameplay.

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

1. Refinar el modelo/rig procedural de Seryn cuando exista el turnaround definitivo.
2. Completar animaciones específicas de Q/W/E/R sobre el rig actual.
3. Generar `H002P.webp` para la innata **Línea de Horizonte**.
4. Sustituir `H002W.png` por `H002W.webp` cuando esté disponible la versión comprimida.
5. Continuar pruebas de duelo H001 vs H002 y revisar daño a niveles 1/6/11/18/30.

## Assets

Ver `images/README.md` y `visualSpec.ts`. Todas las imágenes nuevas deben prepararse en **WebP**.
