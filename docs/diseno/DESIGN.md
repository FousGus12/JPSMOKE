# Guía visual · JP Smoke

> Adaptación de `REFERENCIA-impossible.md` (la guía que mandó Gustavo) a una hamburguesería al barril. Se conserva el lenguaje (titulares gigantes condensados, fondo oscuro, un solo color de acción, píldoras, plano, fotos con recorte) y se cambia la paleta y las fuentes. Tokens en `mockup/assets/base.css`.

## Tres direcciones (D3: se eligió Vino)

| | A · Brasa | **B · Vino (elegida, D3)** | C · Mostaza |
|---|---|---|---|
| Idea | Carbón, brasa encendida y hueso. Huele a humo | La paleta de la referencia tal cual | Póster de carnicería: negro, mostaza y salsa |
| Fondo / superficie | `#0e0b09` / `#1a1411` | `#260212` / `#4f0423` | `#111111` / `#1d1d1b` |
| Acción | `#ff5a1f` con texto `#170904` | `#e10600` con texto blanco | `#f5b700` con texto `#141100` |
| Texto / secundario | `#f5ece2` / `#c9b9a8` | `#ffffff` / `#ffc7c6` | `#fafaf5` / `#d6d4c8` |
| Acento 2 (etiquetas) | Ámbar `#f3b23a` | Rubor `#ffc7c6` | Rojo `#e2342a` |
| Display | **Anton** | **Bebas Neue** | **Big Shoulders Display** 800 |
| Texto | **Inter** | **Inter** | **Space Grotesk** |
| Por qué sí / no | Se diferencia de Barril Burger y de la referencia; el naranja brasa es la marca | Muy bonita pero es la identidad de otra marca | Muy "street food"; el amarillo compite con las fotos |

Todas las fuentes son libres (OFL) y van **autoalojadas** (`mockup/assets/fonts/`), sin CDN.

## Reglas

- **Titulares gigantes**: 56–240 px, mayúsculas, interlineado 0,96–1 (D18: las frases de dos líneas no se pegan). Cada sección abre con uno, con antetítulo entre `◂ ▸`.
- **Un solo color de acción**: botones primarios, estado activo, precios destacados y cupones. Nunca para párrafos.
- **Píldoras de 15 px** en botones, filtros y chips; tarjetas de 14 px; tarjeta protagonista de 38 px.
- **Plano**: sin sombras ni degradados en tarjetas o botones. Los únicos degradados son los velos sobre fotos para leer texto y el resplandor de brasa del inicio. La intensidad del ambiente se ajusta con tres tokens: `--glow` (resplandor, 13 %), `--smoke` (humo, 0,22) y `--grain` (grano, 0,025).
- **Primario + fantasma** en la misma fila (Pedir ahora + Pedir por WhatsApp).
- **Fotos**: comida que llene el cuadro, fondos oscuros. Cerca del titular, recorte orgánico (tarjetas giradas, polígono en "JP on Tour").
- **Grano** sutil sobre todo el sitio (textura de humo, 4–6 %).
- **Contraste AA** en todo texto. En Brasa y Mostaza el texto sobre la acción es oscuro; en Vino, blanco.
- **Rojo de texto aparte (D27):** en Vino el rojo de los botones (`#e10600`) no sirve para texto sobre el fondo (3,8:1). Texto rojo = `--accent-text` `#ff6a5c` (6,8:1). Títulos de sección en blanco; el rojo coral solo para antetítulos, una palabra del titular, códigos de cupón y precios destacados.

## Movimiento

| Dónde | Qué hace |
|---|---|
| Intro de evento | Pantalla completa con la foto del evento haciendo zoom lento, barra de carga y botones que aparecen al terminar |
| Inicio (escritorio) | 4 productos apilados abajo; al bajar se abren a los lados del titular, crecen y muestran nombre y precio |
| Inicio (celular) | El titular sube y el texto se desvanece; los 4 productos se abren en una cuadrícula 2×2 grande |
| Chispas | Brasas que suben en el inicio |
| Secciones | Aparecen subiendo 24 px al entrar en pantalla |
| Franja | Cinta de eventos en movimiento continuo (se pausa al pasar el cursor) |
| Carrito | La foto del producto "vuela" al carrito y el contador rebota |

Duraciones 160 / 240 / 500 / 900 ms, curva `cubic-bezier(.2,.7,.2,1)`. Con `prefers-reduced-motion` todo queda en su posición final.

## Logo

Pendiente (F1). El mockup usa un logotipo tipográfico "JP **Smoke**" con un barril de líneas y dos hilos de humo en el color de acción. Cuando llegue el logo real se reemplaza `JP.logoSvg` y el favicon.
