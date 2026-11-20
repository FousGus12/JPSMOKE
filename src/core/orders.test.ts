import { describe, expect, it } from 'vitest';
import {
  readCancelledToday,
  applyMoves,
  asksRestore,
  cancelWhatsApp,
  deferredConflicts,
  publicCancelText,
  restoreFlag,
  undoSecondsLeft,
  DELIVER_UNDO_MS,
  canDrag,
  canDrop,
  customerWhatsApp,
  dropConfirmText,
  dropRejection,
  needsDropConfirm,
  edgeScroll,
  passedThreshold,
  staleMoves,
  formatPhone,
  groupBoard,
  isCompact,
  isLate,
  nestItems,
  nextStep,
  orderActions,
  startOfBogotaDay,
  statusErrorText,
  toggleOpen,
  voidReasonText,
  type OrderStatus,
  type PendingMove,
} from './orders';

const NOW = Date.parse('2026-11-01T20:00:00Z'); // 3:00 p. m. en Bogotá

describe('tablero', () => {
  it('siguiente estado en orden y nada después de entregado', () => {
    expect(nextStep('nuevo')).toEqual({ status: 'confirmado', label: 'Confirmar' });
    expect(nextStep('en_camino')?.status).toBe('entregado');
    expect(nextStep('entregado')).toBeNull();
    expect(nextStep('cancelado')).toBeNull();
    expect(nextStep('en_cocina', 'recoger')).toEqual({ status: 'en_camino', label: 'Listo para recoger' });
    expect(nextStep('en_camino', 'recoger')?.label).toBe('Ya lo recogió');
  });
  it('pedido abierto de más de 45 min es tarde; cerrado nunca', () => {
    expect(isLate('nuevo', '2026-11-01T19:00:00Z', NOW)).toBe(true);
    expect(isLate('en_cocina', '2026-11-01T19:30:00Z', NOW)).toBe(false);
    expect(isLate('entregado', '2026-11-01T10:00:00Z', NOW)).toBe(false);
  });
  it('el día empieza a medianoche de Bogotá', () =>
    expect(new Date(startOfBogotaDay(NOW)).toISOString()).toBe('2026-11-01T05:00:00.000Z'));
  it('agrupa: abiertos de ayer siguen; entregados de ayer no; más viejos primero', () => {
    const board = groupBoard(
      [
        { id: 'a', status: 'nuevo' as const, created_at: '2026-11-01T19:50:00Z' },
        { id: 'b', status: 'nuevo' as const, created_at: '2026-11-01T19:10:00Z' },
        { id: 'c', status: 'en_cocina' as const, created_at: '2026-10-31T23:00:00Z' },
        { id: 'd', status: 'entregado' as const, created_at: '2026-10-31T23:00:00Z' },
        { id: 'e', status: 'entregado' as const, created_at: '2026-11-01T18:00:00Z' },
      ],
      NOW,
    );
    expect(board.nuevo.map((order) => order.id)).toEqual(['b', 'a']);
    expect(board.en_cocina.map((order) => order.id)).toEqual(['c']);
    expect(board.entregado.map((order) => order.id)).toEqual(['e']);
  });
  it('celular legible y enlace de WhatsApp', () => {
    expect(formatPhone('3105551234')).toBe('310 555 1234');
    expect(customerWhatsApp('3105551234', 'Ana María', 'JP-0001', 'JP Smoke')).toContain(
      'wa.me/573105551234',
    );
  });
});

describe('nestItems (D40)', () => {
  it('cada adición queda debajo de su plato', () => {
    const items = [
      { id: 'a', parent: null, position: 1, name: 'Burger' },
      { id: 'b', parent: null, position: 2, name: 'Burger' },
      { id: 'c', parent: 'b', position: 3, name: 'Huevo' },
      { id: 'd', parent: null, position: 4, name: 'Papas' },
    ];
    expect(nestItems(items).map((item) => `${item.isAddon ? '+' : ''}${item.name}`)).toEqual([
      'Burger',
      'Burger',
      '+Huevo',
      'Papas',
    ]);
  });
  it('pedidos viejos sin id ni padre quedan iguales', () => {
    const old: Array<{ name: string; id?: string }> = [{ name: 'A' }, { name: 'B' }];
    expect(nestItems(old).map((item) => item.name)).toEqual(['A', 'B']);
  });
});

describe('anular pedidos (D42)', () => {
  it('admin anula en cualquier estado no cancelado, también entregado', () => {
    for (const status of ['nuevo', 'confirmado', 'en_cocina', 'en_camino', 'entregado'] as const)
      expect(orderActions(status, 'admin').canVoid).toBe(true);
    expect(orderActions('cancelado', 'admin').canVoid).toBe(false);
    expect(orderActions('entregado', 'admin').canCancel).toBe(false);
  });
  it('operador solo cancela en estados abiertos y nunca anula', () => {
    expect(orderActions('en_camino', 'operador')).toMatchObject({ canCancel: true, canVoid: false });
    expect(orderActions('entregado', 'operador')).toMatchObject({ canCancel: false, canVoid: false });
    expect(orderActions('cancelado', 'operador').canCancel).toBe(false);
  });
  it('sin rol conocido se puede cancelar como hoy, pero no anular', () => {
    expect(orderActions('nuevo', null)).toMatchObject({ canCancel: true, canVoid: false });
    expect(orderActions('entregado', null)).toMatchObject({ canCancel: false, canVoid: false });
    expect(orderActions('nuevo', null).next?.status).toBe('confirmado');
  });
  it('motivo: conserva el prefijo que lee la base y exige texto en "Otro"', () => {
    expect(voidReasonText('', 'algo')).toBeNull();
    expect(voidReasonText('Pedido de prueba', '')).toBe('Pedido de prueba');
    expect(voidReasonText('Pedido falso', '  llamó  dos veces ')).toBe('Pedido falso · llamó dos veces');
    expect(voidReasonText('Otro', ' a ')).toBeNull();
    expect(voidReasonText('Otro', 'Se repitió el pedido')).toBe('Se repitió el pedido');
    expect(voidReasonText('Otro', 'x'.repeat(300))).toHaveLength(200);
    expect(voidReasonText('Pedido de prueba', 'y'.repeat(300))?.startsWith('Pedido de prueba · ')).toBe(true);
  });
  it('errores de la base en texto legible', () => {
    expect(statusErrorText({ code: '42501', message: 'Solo el admin anula un pedido entregado' })).toMatch(
      /Solo el admin/,
    );
    expect(statusErrorText({ code: '42501', message: 'Sin permiso' })).toMatch(/permiso/);
    expect(statusErrorText({ code: '22023', message: 'El pedido ya está cancelado' })).toMatch(/ya estaba/);
    expect(statusErrorText({ code: '22023', message: 'El pedido ya está cerrado' })).toMatch(/cerrado/);
    expect(statusErrorText({ code: '22023', message: 'Cancelar exige un motivo' })).toMatch(/motivo/);
    expect(statusErrorText({ code: '22023', message: 'Ese estado no sigue al actual' })).toMatch(/cambió/);
    expect(statusErrorText({ message: null })).toMatch(/No se pudo/);
  });
  it('entregados compactos y tarjetas que se abren y cierran', () => {
    expect(isCompact('entregado')).toBe(true);
    expect(isCompact('en_camino')).toBe(false);
    const first = new Set<string>();
    const opened = toggleOpen(first, 'a');
    expect([...opened]).toEqual(['a']);
    expect(first.size).toBe(0);
    expect(toggleOpen(opened, 'a').size).toBe(0);
  });
});

describe('tablero arrastrable (D53)', () => {
  const ALL: OrderStatus[] = ['nuevo', 'confirmado', 'en_cocina', 'en_camino', 'entregado', 'cancelado'];

  it('solo hacia adelante y se pueden saltar estados', () => {
    expect(canDrop('nuevo', 'confirmado')).toBe(true);
    expect(canDrop('nuevo', 'entregado')).toBe(true);
    expect(canDrop('confirmado', 'en_camino')).toBe(true);
    expect(canDrop('en_camino', 'confirmado')).toBe(false);
    expect(canDrop('en_cocina', 'en_cocina')).toBe(false);
  });

  it('nunca a cancelado ni desde entregado o cancelado', () => {
    for (const from of ALL) expect(canDrop(from, 'cancelado')).toBe(false);
    for (const to of ALL) {
      expect(canDrop('entregado', to)).toBe(false);
      expect(canDrop('cancelado', to)).toBe(false);
    }
    expect(canDrag('entregado')).toBe(false);
    expect(canDrag('cancelado')).toBe(false);
    expect(canDrag('en_camino')).toBe(true);
  });

  it('aviso al soltar donde no se puede; misma columna sin aviso', () => {
    expect(dropRejection('en_cocina', 'en_cocina')).toBeNull();
    expect(dropRejection('nuevo', 'en_camino')).toBeNull();
    expect(dropRejection('en_camino', 'nuevo')).toBe('Solo se avanza: no puede volver a Nuevo.');
    expect(dropRejection('entregado', 'nuevo')).toMatch(/ya no se mueve/);
    expect(dropRejection('nuevo', 'cancelado')).toMatch(/motivo/);
  });

  it('confirma al soltar en Entregado o al saltarse estados; un paso no', () => {
    expect(needsDropConfirm('nuevo', 'confirmado')).toBe(false);
    expect(needsDropConfirm('en_cocina', 'en_camino')).toBe(false);
    expect(needsDropConfirm('en_camino', 'entregado')).toBe(true);
    expect(needsDropConfirm('nuevo', 'en_cocina')).toBe(true);
    expect(needsDropConfirm('nuevo', 'entregado')).toBe(true);
    expect(needsDropConfirm('en_camino', 'nuevo')).toBe(false);
    expect(needsDropConfirm('entregado', 'entregado')).toBe(false);
    expect(dropConfirmText('JP-0007', 'en_camino', 'entregado')).toBe(
      '¿Marcar JP-0007 como entregado? El operador no puede deshacerlo.',
    );
    expect(dropConfirmText('JP-0007', 'nuevo', 'en_camino')).toMatch(/de Nuevo a En camino/);
  });

  it('movimiento optimista: aplica mientras siga en el estado de origen', () => {
    const orders = [
      { id: 'a', status: 'nuevo' as OrderStatus },
      { id: 'b', status: 'en_cocina' as OrderStatus },
    ];
    const moves = new Map<string, PendingMove>([['a', { from: 'nuevo', to: 'en_cocina' }]]);
    expect(applyMoves(orders, moves).map((order) => order.status)).toEqual(['en_cocina', 'en_cocina']);
    expect(orders[0]?.status).toBe('nuevo');
    expect(applyMoves(orders, new Map())).toBe(orders);
    expect(staleMoves(orders, moves)).toEqual([]);
    // Llegó el dato real (u otro cambio en vivo): el movimiento caduca.
    const arrived = [{ id: 'a', status: 'en_cocina' as OrderStatus }];
    expect(applyMoves(arrived, moves)[0]?.status).toBe('en_cocina');
    expect(staleMoves(arrived, moves)).toEqual(['a']);
    expect(staleMoves([], moves)).toEqual(['a']);
  });

  it('autoscroll solo cerca del borde y con tope', () => {
    expect(edgeScroll(500, 0, 1000)).toBe(0);
    expect(edgeScroll(0, 0, 1000)).toBe(-18);
    expect(edgeScroll(28, 0, 1000)).toBe(-9);
    expect(edgeScroll(1000, 0, 1000)).toBe(18);
    expect(edgeScroll(1200, 0, 1000)).toBe(18);
    expect(edgeScroll(10, 0, 100)).toBe(0);
  });

  it('umbral de 6 px para no confundir un clic con un arrastre', () => {
    expect(passedThreshold(3, 4)).toBe(false);
    expect(passedThreshold(6, 0)).toBe(false);
    expect(passedThreshold(5, 4)).toBe(true);
  });
});

describe('anular con mensaje para el cliente (D59)', () => {
  it('sin mensaje elegido no manda nada; los fijos van tal cual', () => {
    expect(publicCancelText('', 'algo')).toBeNull();
    expect(publicCancelText('No llegamos a tu zona', 'ignorado')).toBe('No llegamos a tu zona');
  });
  it('"Otro" exige texto y lo corta a 160', () => {
    expect(publicCancelText('Otro', '  a ')).toBeUndefined();
    expect(publicCancelText('Otro', '  Se  dañó   el barril ')).toBe('Se dañó el barril');
    expect(publicCancelText('Otro', 'x'.repeat(300))).toHaveLength(160);
  });
  it('solo pregunta por insumos desde En el barril; antes siempre vuelven', () => {
    expect(asksRestore('nuevo')).toBe(false);
    expect(asksRestore('confirmado')).toBe(false);
    expect(asksRestore('en_cocina')).toBe(true);
    expect(asksRestore('en_camino')).toBe(true);
    expect(asksRestore('entregado')).toBe(true);
    expect(restoreFlag('confirmado', false)).toBe(true);
    expect(restoreFlag('en_cocina', false)).toBe(false);
    expect(restoreFlag('entregado', true)).toBe(true);
  });
  it('WhatsApp prellenado con código y mensaje', () => {
    const url = cancelWhatsApp('3001234567', ' Ana  María', 'JP-0042', 'JP Smoke', 'No llegamos a tu zona');
    expect(url.startsWith('https://wa.me/573001234567?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1] ?? '')).toBe(
      'Hola Ana, te escribimos de JP Smoke: tu pedido JP-0042 fue cancelado. No llegamos a tu zona',
    );
  });
  it('el error de conservar insumos antes del barril se explica', () => {
    expect(
      statusErrorText({ code: '22023', message: 'Los insumos se conservan solo desde En el barril' }),
    ).toContain('aún no entra al barril');
  });
});

describe('deshacer entregado (D60)', () => {
  it('cuenta regresiva en segundos enteros', () => {
    expect(DELIVER_UNDO_MS).toBe(10_000);
    expect(undoSecondsLeft(NOW + 10_000, NOW)).toBe(10);
    expect(undoSecondsLeft(NOW + 9_001, NOW)).toBe(10);
    expect(undoSecondsLeft(NOW + 1, NOW)).toBe(1);
    expect(undoSecondsLeft(NOW - 500, NOW)).toBe(0);
  });
  it('detecta pedidos que cambió otro dispositivo o que ya no están', () => {
    const deferred = new Map<string, { from: OrderStatus }>([
      ['a', { from: 'en_camino' }],
      ['b', { from: 'en_camino' }],
      ['c', { from: 'nuevo' }],
    ]);
    const orders = [
      { id: 'a', status: 'en_camino' as OrderStatus },
      { id: 'b', status: 'cancelado' as OrderStatus },
    ];
    expect(deferredConflicts(orders, deferred)).toEqual(['b', 'c']);
  });
});

describe('cancelados de hoy (D60)', () => {
  it('lee la RPC, excluye prueba y ordena del más reciente', () => {
    const list = readCancelledToday([
      {
        id: 'a',
        code: 'JP-0001',
        total: 30000,
        customer_name: 'Ana',
        cancel_reason: 'Cliente canceló',
        cancel_public: null,
        voided_from: 'en_cocina',
        supplies_restored: false,
        is_test: false,
        at: '2026-11-01T14:00:00Z',
        by: 'Admin',
      },
      { id: 'p', code: 'JP-0002', is_test: true, at: '2026-11-01T15:00:00Z' },
      { id: 'b', code: 'JP-0003', at: '2026-11-01T19:00:00Z', voided_from: 'raro' },
      { id: 'sin-hora', code: 'JP-0004' },
      'basura',
    ]);
    expect(list.map((row) => row.id)).toEqual(['b', 'a']);
    expect(list[1]).toMatchObject({
      code: 'JP-0001',
      reason: 'Cliente canceló',
      voidedFrom: 'en_cocina',
      suppliesRestored: false,
      by: 'Admin',
    });
    expect(list[0]).toMatchObject({ total: 0, voidedFrom: null, suppliesRestored: null, by: '—' });
    expect(readCancelledToday(null)).toEqual([]);
  });
});
