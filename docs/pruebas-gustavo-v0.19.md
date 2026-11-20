# Pruebas para Gustavo · JP Smoke v0.19.1 (en producción)

Sitio: https://jpsmoke.vercel.app · Panel: https://jpsmoke.vercel.app/panel
Todo lo automático ya pasó (244 pruebas en escritorio, Android e iPhone simulados). Esto es lo que solo se confirma con tu celular real, tu impresora y tus datos. Marca ✅ o anota lo que veas.

**Antes de empezar:** la bienvenida "Gran apertura" del 15 de noviembre sigue activa hasta el 30. Cámbiala o apágala en Panel → Contenido → Bienvenida. El cupón HUMO20 también vence el 30.

## 1. Pedido (celular con datos móviles) — lo más importante

| # | Haz esto | Debe pasar |
|---|---|---|
| 1 | Haz un pedido real de prueba con un cupón | Entra una sola vez al tablero, con el total correcto, y te llega el enlace de seguimiento |
| 2 | En Confirmar pon el modo avión, toca Confirmar, quita el modo avión y vuelve a confirmar | Mismo código de pedido, un solo pedido, el cupón se usa una vez |
| 3 | Toca Confirmar dos veces seguidas rápido | Un solo pedido |
| 4 | Haz un segundo pedido (ya con tus datos guardados) | Abre directo en Confirmar, pide la casilla de datos; la de promociones sale **desmarcada**; "Cambiar datos" vuelve al formulario |
| 5 | "Repetir mi último pedido" con un producto que marques agotado | Avisa y agrega el resto con precios actuales |
| 6 | En Safari del iPhone, si aparece la verificación de Cloudflare, resuélvela | El pedido pasa. Luego en Panel → Administración → Seguridad no debe aparecer un frenado "robot" tuyo |

## 2. Panel · Pedidos

| # | Haz esto | Debe pasar |
|---|---|---|
| 7 | Anula el pedido con cupón estando en Nuevo | El cupón recupera el uso (Contenido → Promociones) y los insumos vuelven |
| 8 | Anula uno en En el barril y responde "No, ya se usaron"; repite con "Sí" | Con No el inventario no sube; con Sí sube |
| 9 | Anula con "Mensaje para el cliente" | El seguimiento muestra ese mensaje (no el motivo interno); "Avisar por WhatsApp" abre el chat con el texto listo |
| 10 | Pasa un pedido a Entregado y toca Deshacer antes de 10 s | Vuelve a su columna |
| 11 | Pásalo a Entregado y cierra la pestaña o cambia de app | Al volver, queda Entregado |
| 12 | Con el panel abierto en dos equipos: entrega en uno y cancela en el otro antes de 10 s | Aviso "cambió en otro dispositivo" |
| 13 | Abre "Cancelados de hoy" | Motivo, estado previo, insumos y quién lo hizo |
| 14 | En el celular, mantén presionado un pedido y arrástralo a otra columna | Se mueve sin desplazar el tablero; a Entregado pide confirmación |
| 15 | Recibo y Comanda: imprime en tirilla de 58 y 80 mm; comparte el recibo como imagen | La comanda sale sin precios ni celular; la imagen se comparte o descarga |

## 3. Pausa y hora estimada

| # | Haz esto | Debe pasar |
|---|---|---|
| 16 | Como operador, toca ⏸ Pausar 15 min | En el sitio, al abrir el carrito: "Volvemos a las HH:MM"; Reanudar lo abre sin recargar |
| 17 | Con la pausa activa, intenta confirmar un pedido que ya tenías abierto | Mensaje de pausa, no se crea el pedido |
| 18 | Activa la hora estimada dinámica (Editar página) con 3 pedidos activos | La hora sube en el carrito y en el seguimiento |

## 4. Sitio público

| # | Haz esto | Debe pasar |
|---|---|---|
| 19 | Abre el inicio en tu iPhone | Las 4 fotos entran solas, cabe en una pantalla; la barra de abajo queda fija y se esconde al escribir en el buscador |
| 20 | Cobertura → "Usar mi ubicación" (permite y luego niega) | Te ubica en tu localidad y dice si llegamos; al negar, mensaje claro |
| 21 | Pon a un evento de bienvenida fecha final de ayer | No aparece |
| 22 | Edita un título (con Enter), el cierre, los botones y los textos del cupón; escribe `<b>prueba</b>`; publica | Se ve tal cual, como texto, sin negrita |
| 23 | Reseñas: crea, aprueba, ordena y oculta; publica | El sitio refleja el orden y la fuente; sin aprobadas, la sección no aparece |
| 24 | Abre el enlace de seguimiento en cada estado | Animación de cada estado y hora estimada; cancelado sin mensaje muestra el texto genérico |

## 5. Ventas, inventario y administración (computador)

| # | Haz esto | Debe pasar |
|---|---|---|
| 25 | Ventas → Ventas de Rappi y DiDi: sube el CSV real del portal | Propone el mapeo y muestra la vista previa; ajusta columnas si hace falta y guarda |
| 26 | Vuelve a importar el mismo archivo; luego "Revertir" el lote | Todo sale como repetido; al revertir desaparece de Plataformas y la caja no cambia |
| 27 | Inventario → Lista de compras con insumos bajo el mínimo | Cantidades en unidad de compra; Copiar y Compartir por WhatsApp funcionan en el celular |
| 28 | Inventario: registra costos y mira Recetas | Costo, margen y precio sugerido por producto |
| 29 | Clientes → Exportar (admin) y abre el CSV en Excel | Tildes bien, sin fórmulas raras; aparece en Seguridad → Auditoría |
| 30 | Clientes → "Retirar autorización" a alguien | La etiqueta desaparece y ya no sale en la exportación |
| 31 | Seguridad: frenado de un celular que ya era cliente | Tiene Desbloquear y WhatsApp; uno de número nuevo no tiene acciones |
| 32 | Deja el panel abierto mientras publico una versión nueva | Aparece "Hay una versión nueva del panel" |

## Pendientes que dependen de ti

- Dominio `jpsmoke.co` (con `panel.jpsmoke.co`) y Vercel Pro (D4).
- WhatsApp real (D48): cuenta de WhatsApp Business en Meta, número, 6 plantillas y método de pago.
- Archivo real de Rappi/DiDi para afinar el mapeo (prueba 25).
