# ⚔️ Battle Chess — Ajedrez de Batalla

Un ajedrez completo de fantasía medieval en **un único archivo HTML autocontenido**, inspirado
en el clásico *Battle Chess* (Interplay, 1988-1991): **cada captura detiene la partida y desata
un combate animado** en la casilla de destino.

👉 **Para jugar: abre [`index.html`](index.html) con doble clic.** No necesita servidor, ni
conexión, ni dependencias: no hay una sola petición de red en toda la página.

## Lo que hace

- **Escena 2.5D**: tablero en perspectiva de un punto (las filas lejanas se estrechan) con
  sprites verticales ordenados por profundidad, sombras y niebla.
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
- **Un guion de combate distinto por atacante**: estocadas de lanza, embestida a caballo,
  proyectil mágico del hechicero, mazazo del gólem, descarga arcana de la reina y duelo a
  espada del monarca (con nube de pelea de dibujo animado y onomatopeyas). La pieza derrotada
  se **desintegra en sus propios píxeles**.
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
| Silenciar | Botón o `M` |

## Estructura del repositorio

El archivo jugable es `index.html`, **generado** a partir de los módulos de `src/`:

```
src/theme.js      paletas de los dos bandos, tablero, escena e interfaz
src/engine.js     motor de reglas (validado con perft)
src/ai.js         IA alfa-beta con profundización iterativa
src/spr_*.js      los seis sprites de pixel-art
src/fx.js         partículas y efectos de combate
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

- El motor supera **perft** en las cinco posiciones canónicas (inicial, *Kiwipete*, y las
  posiciones 3, 4 y 5) — la comprobación estándar de que la generación de jugadas es correcta.
- La suite de extremo a extremo comprueba el hit-test de las 64 casillas en ambas
  orientaciones, los seis guiones de combate, enroque/al paso/promoción animados, autojuego
  IA vs IA, rendimiento, robustez ante clics durante el combate y el diseño en móvil.

El análisis del encargo original y el prompt reescrito están en [`PROMPT.md`](PROMPT.md).
