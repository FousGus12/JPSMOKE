-- =============================================================================
-- JP Smoke · v0.19: valores nuevos de enums (van solos: un valor nuevo no se puede usar
-- en la misma transacción que lo crea).
-- D59: aviso de WhatsApp al cliente cuando se anula su pedido con motivo público.
-- =============================================================================
alter type public.wa_kind add value if not exists 'pedido_cancelado';
