-- =============================================================================
-- JP Smoke · v0.18: valores nuevos de enums (van solos: un valor nuevo no se puede usar
-- en la misma transacción que lo crea).
-- D46: movimiento "inicial" (existencia de partida). D46: aviso de WhatsApp "stock_bajo".
-- =============================================================================
alter type public.supply_move_kind add value if not exists 'inicial';
alter type public.wa_kind add value if not exists 'stock_bajo';
