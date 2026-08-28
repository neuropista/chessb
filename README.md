# ⚔️ Battle Chess — Ajedrez de Batalla

Un ajedrez completo de fantasía medieval en **un único archivo HTML autocontenido**, inspirado
en el clásico *Battle Chess* (Interplay, 1988-1991): **cada captura detiene la partida y desata
un combate animado** en la casilla de destino.

👉 **Para jugar: abre [`index.html`](index.html) con doble clic.** No necesita servidor, ni
conexión, ni dependencias: no hay una sola petición de red en toda la página.

## Lo que hace

- **Dos vistas en el mismo archivo**, conmutables con el selector *Vista* o con `V`:
  - **2.5D pixel-art**: tablero en perspectiva de un punto (las filas lejanas se estrechan) con
    sprites verticales ordenados por profundidad, sombras y niebla.
  - **3D voxel** (WebGL, sin librerías): los mismos sprites convertidos en figuras con volumen.
    Cada tramo horizontal del dibujo se revoluciona sobre sí mismo, así que la pieza se
    reconoce desde cualquier ángulo — también desde arriba — sin perder ni un píxel del arte
    original. Tres cámaras (`C` las rota): **Clásica** (el ángulo de la 2.5D), **Isométrica**
    y **Cenital**, con encuadre calculado para que el tablero siempre quepa.
- **Pixel-art procedural**: cada pieza es un mapa de 24×32 píxeles con paleta indexada de 17
  tonos y tres fotogramas (reposo, caminar, atacar). No hay imágenes: los sprites se dibujan
  píxel a píxel en tiempo de carga.
  | Pieza | Personaje |
  |---|---|
  | Peón | Soldado con lanza y escudo |
  | Torre | Gólem de piedra |
  | Caballo | Caballero montado |
  | Alfil | Obispo hechicero |
  | Reina | Reina hechicera |
  | Rey | Monarca con espadón |
- **Cada pieza muestra su propio poder**, anunciado por su nombre al empezar el duelo:

  | Pieza | Poder | Qué hace |
  |---|---|---|
  | Peón | ¡CARGA DE LANZA! | Tres estocadas encadenadas, cada una más dura |
  | Caballo | ¡CARGA DE CABALLERÍA! | Retrocede, embiste y vuelve a pasar por encima |
  | Alfil | ¡RAYO ARCANO! | Traza un círculo de runas y **desintegra al enemigo** con su vara: el rival se deshace de abajo arriba y sus píxeles salen volando como motas de magia |
  | Torre | ¡TERREMOTO! | La tierra tiembla y descarga dos mazazos con onda sísmica |
  | Reina | ¡TORMENTA ARCANA! | Se eleva e invoca una lluvia de proyectiles, rematada con una explosión |
  | Rey | ¡DUELO REAL! | Cinco mandobles, nube de pelea con onomatopeyas y tajo final |

  Los demás caídos se **desintegran en sus propios píxeles**.
- **Reglas completas**: enroque, captura al paso, promoción con elección, jaque, jaque mate,
  ahogado, 50 movimientos, triple repetición y material insuficiente. Historial en notación
  algebraica (SAN) desambiguada.
- **Modos**: Humano vs Humano, Humano vs IA, IA vs Humano e IA vs IA, con tres niveles
  (Escudero / Caballero / Gran Maestre).
- **Sonido sintetizado** con Web Audio (sin archivos), silenciable.
- Ritmo de las animaciones configurable (Épico / Normal / Rápido / Sin combate), combate
  saltable con clic o **Espacio**, y respeto por `prefers-reduced-motion`.

## Controles

| Acción | Cómo |
|---|---|
| Mover | Clic en la pieza, clic en el destino |
| Acelerar el combate | Clic o `Espacio` |
| Deshacer | Botón o `U` |
| Nueva partida | Botón o `N` |
| Girar el tablero | Botón o `F` |
| Cambiar 2.5D ↔ 3D | Selector *Vista* o `V` |
| Rotar la cámara 3D | Selector *Cámara* o `C` |
| Silenciar | Botón o `M` |

## Estructura del repositorio

El archivo jugable es `index.html`, **generado** a partir de los módulos de `src/`:

```
src/theme.js      paletas de los dos bandos, tablero, escena e interfaz
src/engine.js     motor de reglas (validado con perft)
src/ai.js         IA alfa-beta con profundización iterativa
src/spr_*.js      los seis sprites de pixel-art
src/fx.js         partículas y efectos de combate
src/render3d.js   vista 3D en WebGL: voxelizado, cámaras y pintado
src/audio.js      síntesis de efectos de sonido
src/game.js       escena 2.5D, coreografía de combate, entrada e interfaz
src/ui.css        estilos de la página
build.mjs         empaqueta todo lo anterior en index.html
```

```bash
node build.mjs          # regenera index.html
npm test                # motor (perft), IA, efectos y audio en Node
node tools/e2e.mjs      # pruebas de extremo a extremo en Chromium
```

## Verificación

**Node** (`npm test`) — cuatro suites:

- **Motor**: **perft** en las cinco posiciones canónicas (inicial, *Kiwipete*, y las
  posiciones 3, 4 y 5) hasta profundidad 4-5 — la comprobación estándar de que la generación
  de jugadas es correcta — más FEN de ida y vuelta, no-mutación, SAN desambiguado y las
  cuatro formas de tablas.
- **IA**: 30 partidas de autojuego sin una sola jugada ilegal, mate en 1, material colgado y
  presupuesto de tiempo. El nivel 3 puntúa 100 % contra el nivel 1.
- **Efectos**: 600 fotogramas con un contexto 2D falso — `save`/`restore` balanceados, sin
  `NaN`, sin `shadowBlur`, todas las partículas mueren.
- **Audio**: los 16 sonidos con un doble de `AudioContext`.

**Navegador** (`node tools/e2e.mjs`) — 41 secciones en Chromium sin cabeza, entre ellas:

| Qué comprueba | Cómo |
|---|---|
| Proyección 2.5D | las 64 casillas resuelven a su índice en ambas orientaciones |
| Los seis guiones de combate | cada tipo de pieza, con recuento de partículas y fotogramas |
| Enroque, al paso y promoción | animados y con la SAN correcta |
| Nunca se bloquea | 40 clics aleatorios en mitad de un combate |
| Deshacer con IA al mando | la partida sigue viva en los tres modos |
| Geometría del duelo | los dos combatientes nunca se tapan (seis geometrías) |
| Rendimiento | 60 fps a DPR 1 y 59 fps a DPR 2 con animaciones completas |
| Autocontención | cero peticiones de red, interceptando el tráfico |
| Accesibilidad | `prefers-reduced-motion` sin fogonazos ni parpadeos; el teclado no secuestra los controles |
| Adaptable | siete tamaños de ventana sin recorte ni desbordamiento; el lienzo sigue al contenedor aunque el panel crezca |
| Vista 3D | 384 comprobaciones de hit-test (3 cámaras × 2 orientaciones), los seis poderes en 3D y el conmutador entre vistas |

El juego pasó además una revisión adversarial en seis dimensiones (reglas, animación, render,
fidelidad al encargo, robustez e interfaz), cuyos hallazgos se corrigieron con una prueba de
regresión cada uno.

El análisis del encargo original y el prompt reescrito están en [`PROMPT.md`](PROMPT.md).

## Nota sobre el rendimiento en 3D

Pintar las 32 piezas cuesta unos **0,05 ms de CPU por fotograma** (42 928 triángulos en 12
mallas, una por pieza y bando). El resto lo hace la GPU, así que la vista 3D va a 60 fps en
cualquier navegador con aceleración por hardware. En un entorno sin GPU —como el contenedor
donde se ejecutan estas pruebas, que usa el rasterizador por software SwiftShader— baja a
unos 10 fps; en ese caso la vista 2.5D sigue disponible y va a 60 fps.
