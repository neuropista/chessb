# Análisis y optimización del prompt

## 1. Diagnóstico del prompt original

El prompt original es **claro en la intención** (una captura = una pelea animada) pero deja
huecos que, en la práctica, producen un juego roto o incompleto. Los defectos detectados:

| # | Defecto | Riesgo concreto | Corrección aplicada |
|---|---------|-----------------|---------------------|
| 1 | **Disyuntiva sin resolver**: "vista isométrica 2.5D **o** tablero 2D plano" | El ejecutor elige lo más barato (2D plano) y se pierde el efecto Battle Chess | Se decide: tablero 2.5D con proyección en perspectiva de un punto y sprites *billboard* verticales |
| 2 | **"Reglas básicas del ajedrez"** | "Básicas" se interpreta como "solo los movimientos": se omiten enroque, captura al paso, promoción, jaque mate y tablas. Es el fallo nº1 en juegos de ajedrez generados | Lista explícita y cerrada de reglas, incluidas las 4 formas de tablas |
| 3 | **Sin criterios de aceptación verificables** | No hay forma de saber si está "bien"; los bugs de reglas pasan desapercibidos | Se exige validación con **perft** contra cifras canónicas y pruebas automáticas |
| 4 | **No define el control del turno durante la animación** | Bug clásico: el usuario hace clic mientras hay una animación y el estado se corrompe | Se especifica bloqueo de entrada, cola de animación, posibilidad de saltar y *watchdog* anti-bloqueo |
| 5 | **Ambigüedad de modo**: "un solo jugador ... **o** contra una IA" | Se implementa solo uno de los dos | Se piden ambos, seleccionables, más IA vs IA |
| 6 | **No fija restricciones técnicas** | Se usan CDNs, imágenes externas o fuentes remotas → el "único archivo HTML" deja de funcionar sin red | "Cero recursos externos": todo procedural, offline, un archivo |
| 7 | **No define de dónde salen los gráficos** | Sin assets, el ejecutor recurre a emojis o letras Unicode y desaparece el pixel-art | Pipeline explícito: sprites como mapas de píxeles indexados + paleta por bando |
| 8 | **"Secuencia de combate corta" sin métrica** | Sale un parpadeo de 200 ms, o una cinemática de 8 s que aburre | Duración objetivo por fase, coreografía **distinta por tipo de pieza**, control de velocidad |
| 9 | **Nada sobre rendimiento, responsive, accesibilidad ni idioma** | Se rompe en móvil, marea a usuarios sensibles al movimiento | 60 fps, diseño adaptable, `prefers-reduced-motion`, interfaz en español |
| 10 | **No dice qué pasa en jaque/mate/promoción** | Se ignoran justo los momentos más importantes de la partida | Retroalimentación explícita para cada uno |
| 11 | **Las restricciones son solo negativas** ("no agregues...") | El ejecutor no sabe qué **sí** debe existir | "Fuera de alcance" separado de "alcance mínimo obligatorio" |

## 2. Prompt optimizado

> **Rol.** Actúas como desarrollador de videojuegos web y pixel-artista retro.
>
> **Objetivo.** Un juego de ajedrez completo en **un único archivo `index.html` autocontenido**
> (sin red, sin CDNs, sin imágenes ni fuentes externas: todo procedural) cuya experiencia central
> es que **cada captura desencadena un combate animado** en la casilla de destino, al estilo de
> *Battle Chess* (Interplay, 1988-1991).
>
> **Presentación.**
> 1. Tablero **2.5D**: proyección en perspectiva de un punto (las filas lejanas se estrechan y se
>    acortan), piezas dibujadas como sprites verticales que se ordenan por profundidad.
> 2. Estética **pixel-art de 1993**: sprites de 24×32 píxeles con paleta indexada de 17 tonos,
>    3 fotogramas por pieza (reposo, caminar, atacar), escalado con vecino más cercano (sin
>    suavizado). Nada de emojis ni caracteres Unicode como piezas.
> 3. Bestiario medieval: Peón = soldado con lanza y escudo · Torre = gólem de piedra ·
>    Caballo = caballero montado · Alfil = obispo hechicero con báculo · Reina = reina hechicera ·
>    Rey = monarca con corona, capa y espadón. Bando blanco = acero y azul heráldico;
>    bando negro = hierro ennegrecido y carmesí.
>
> **Reglas (completas, no "básicas").** Movimientos de las seis piezas, **enroque** corto y largo
> con todas sus condiciones, **captura al paso**, **promoción** con elección de las 4 piezas,
> prohibición de auto-jaque, **jaque**, **jaque mate**, **ahogado**, **50 movimientos**,
> **triple repetición** y **material insuficiente**. Notación algebraica (SAN) correcta y
> desambiguada en el historial.
>
> **Animaciones.**
> - *Movimiento a casilla vacía*: desplazamiento con ciclo de caminata y balanceo (~0,45 s);
>   el caballo salta en parábola; el enroque mueve rey y torre coordinados.
> - *Captura*: la partida lógica se **pausa** y se ejecuta una secuencia de cuatro fases —
>   **aproximación → combate → derrota → ocupación** (~2-3 s en total). La coreografía del
>   combate es **distinta según la pieza atacante** (estocada de lanza, embestida a caballo,
>   proyectil mágico, mazazo del gólem, descarga arcana, duelo a espada) e incluye recursos de
>   dibujo animado: nube de pelea dentada, onomatopeyas tipo *¡CLANG!*, chispas, ondas de
>   choque y sacudida de pantalla. La pieza derrotada se **desintegra en sus propios píxeles**.
>   Solo al terminar se retira del tablero y se confirma el estado lógico.
> - *Robustez*: entrada bloqueada durante la animación, opción de saltar (clic o Espacio),
>   control de velocidad, y un *watchdog* que fuerza el final si una animación se atasca —
>   el juego **nunca** debe quedar bloqueado.
>
> **Modos.** Humano vs Humano en la misma pantalla, Humano vs IA y IA vs IA, con tres niveles
> de IA: aleatorio sesgado, alfa-beta de profundidad 2 y alfa-beta de profundidad 3-4 con
> tablas de posición y quiescencia. La IA debe responder en menos de ~700 ms.
>
> **Interfaz mínima (una sola barra + un panel, nada de menús anidados).** Indicador de turno,
> nuevo juego, deshacer, girar tablero, velocidad, sonido, selector de modo y nivel; panel con
> piezas capturadas, ventaja material e historial SAN. Avisos de jaque, mate y promoción.
> Sonido sintetizado con Web Audio (chiptune), silenciable.
>
> **Calidad exigible (criterios de aceptación).**
> - El motor de reglas supera **perft** en las 5 posiciones canónicas (inicial, Kiwipete,
>   posiciones 3, 4 y 5) hasta profundidad 4-5.
> - 60 fps con ~400 partículas; ningún `NaN` en el lienzo; sin fugas de estado del contexto 2D.
> - Adaptable a pantallas estrechas; respeta `prefers-reduced-motion`.
> - Funciona con doble clic en el archivo, sin servidor y sin conexión.
>
> **Fuera de alcance.** Multijugador en red, cuentas, torneos, guardado en la nube, motores
> externos, reloj de competición, análisis con evaluación numérica visible, menús de
> configuración anidados.
>
> **Idioma de la interfaz.** Español.

## 3. Qué cambia en la práctica

El prompt original produce, casi siempre, un tablero 2D con letras o emojis, sin enroque ni
captura al paso, y un "combate" que es un destello de medio segundo. El prompt optimizado fija
las tres cosas que el original dejaba al azar: **la vista**, **la completitud de las reglas
(verificable con perft)** y **la coreografía del combate como pieza central del diseño**.
