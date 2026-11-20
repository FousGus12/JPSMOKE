import { describe, expect, it } from 'vitest';
import { cleanLine, heroNote, readCopy, readLeadCopy, titleLines } from './site-copy';

describe('readCopy', () => {
  it('sin bloques usa los textos de hoy', () => {
    for (const blocks of [null, undefined, {}, 'x', [], { titles: 'x', final: 3, cta: [] }]) {
      const copy = readCopy(blocks);
      expect(copy.titles.arsenal).toEqual({
        kicker: 'El arsenal pesado',
        title: ['Directo', 'del barril'],
        text: null,
      });
      expect(copy.titles.carta.title).toEqual(['Conócelos', 'todos']);
      expect(copy.titles.promos).toEqual({ kicker: 'Cupones activos', title: [], text: '' });
      expect(copy.titles.eventos.title).toEqual(['Lo que se', 'está cocinando']);
      expect(copy.titles.resenas.kicker).toBe('Prueba social');
      expect(copy.titles.cobertura.title).toEqual(['¿Llegamos', 'a tu barrio?']);
      expect(copy.final).toEqual({
        kicker: '',
        title: ['El barril', 'está encendido'],
        text: '',
        button: 'Pedir ahora',
      });
      expect(copy.cta.primary).toBe('Pedir ahora');
      expect(copy.cta.whatsapp).toBe('Pedir por WhatsApp');
    }
  });

  it('campos vacíos o en blanco = texto por defecto; lo escrito manda', () => {
    const copy = readCopy({
      titles: {
        arsenal: { kicker: '   ', title: 'Lo más\npedido', text: 'Las que salen' },
        resenas: { title: '\n \n' },
      },
      final: { button: 'Pide ya', title: '' },
      cta: { primary: 'Quiero una', note_open: 'Visítanos en Chapinero' },
    });
    expect(copy.titles.arsenal).toEqual({
      kicker: 'El arsenal pesado',
      title: ['Lo más', 'pedido'],
      text: 'Las que salen',
    });
    expect(copy.titles.resenas.title).toEqual(['El rugido', 'de la manada']);
    expect(copy.final.button).toBe('Pide ya');
    expect(copy.final.title).toEqual(['El barril', 'está encendido']);
    expect(copy.cta.primary).toBe('Quiero una');
    expect(heroNote(copy, true)).toBe('Visítanos en Chapinero');
    expect(heroNote(copy, false)).toBe('Solo domicilio · punto físico muy pronto');
  });

  it('respeta los topes de longitud', () => {
    const copy = readCopy({
      titles: { carta: { kicker: 'k'.repeat(90), text: 't'.repeat(500), title: 'a'.repeat(200) } },
      cta: { note_closed: 'n'.repeat(200), whatsapp: 'w'.repeat(60) },
    });
    expect(copy.titles.carta.kicker).toHaveLength(40);
    expect(copy.titles.carta.text).toHaveLength(240);
    expect(copy.titles.carta.title.join('')).toHaveLength(80);
    expect(copy.cta.noteClosed).toHaveLength(80);
    expect(copy.cta.whatsapp).toHaveLength(30);
  });

  it('no interpreta HTML: lo deja como texto para escaparlo al pintar', () => {
    const copy = readCopy({ titles: { eventos: { text: '<script>alert(1)</script>' } } });
    expect(copy.titles.eventos.text).toBe('<script>alert(1)</script>');
  });
});

describe('titleLines', () => {
  it('parte por Enter, limpia espacios y descarta renglones vacíos', () => {
    expect(titleLines('  Directo \r\n\n  del   barril ')).toEqual(['Directo', 'del barril']);
  });
  it('máximo 3 renglones: lo que sobra se pega al último', () => {
    expect(titleLines('a\nb\nc\nd')).toEqual(['a', 'b', 'c d']);
  });
  it('el tope cuenta todo el título y no parte emojis', () => {
    expect(titleLines('🔥🔥🔥\n🔥🔥', 4)).toEqual(['🔥🔥🔥', '🔥']);
  });
  it('lo que no es texto da vacío', () => {
    expect(titleLines(42)).toEqual([]);
  });
});

describe('cleanLine', () => {
  it('quita controles y saltos', () => {
    expect(cleanLine('hola\u0000\nmundo‮', 40)).toBe('hola mundo');
    expect(cleanLine(null, 40)).toBe('');
  });
});

describe('readLeadCopy', () => {
  it('sin textos = los del cupón de hoy', () => {
    expect(readLeadCopy(null)).toEqual({
      kicker: 'Cupón de bienvenida',
      title: ['Tu primera mordida va con descuento'],
      text: 'Déjanos tu nombre y celular y te damos un cupón para tu pedido.',
      button: 'Quiero mi cupón',
    });
  });
  it('usa lo escrito y conserva el resto', () => {
    const copy = readLeadCopy({ title: 'Prueba\nel humo', button: '' });
    expect(copy.title).toEqual(['Prueba', 'el humo']);
    expect(copy.button).toBe('Quiero mi cupón');
  });
});
