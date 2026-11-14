// Gráficas del panel (F8) en SVG: una sola serie, barras finas con punta redondeada, ejes discretos,
// información al pasar el cursor o enfocar con teclado, y tabla para lectores de pantalla.
// Sin atributos style (CSP): tamaños con atributos SVG y colores con clases.
import { useState } from 'react';
import { niceMax } from '../core/sales';

export interface Bar {
  label: string;
  value: number;
  detail: string;
}

/** Barras verticales (ventas por día, pedidos por hora). */
export function Columns({
  bars,
  caption,
  axis,
}: {
  bars: Bar[];
  caption: string;
  axis: (value: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...bars.map((bar) => bar.value)));
  const width = 720;
  const height = 200;
  const slot = width / Math.max(1, bars.length);
  const barWidth = Math.max(3, Math.min(28, slot - 2));
  const shown = active !== null ? bars[active] : null;
  return (
    <figure className="chart">
      <div className="chart-tip" aria-live="polite">
        {shown ? (
          <>
            <b>{shown.label}</b> · {shown.detail}
          </>
        ) : (
          <span className="muted">Pasa el cursor por una barra para ver el detalle</span>
        )}
      </div>
      <div className="chart-area">
        <span className="chart-max">{axis(max)}</span>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={caption}>
          <line className="chart-grid" x1="0" x2={width} y1={height / 2} y2={height / 2} />
          <line className="chart-base" x1="0" x2={width} y1={height} y2={height} />
          {bars.map((bar, i) => {
            const barHeight = bar.value > 0 ? Math.max(3, (bar.value / max) * (height - 4)) : 0;
            const x = i * slot + (slot - barWidth) / 2;
            return (
              <g
                key={bar.label}
                className={`chart-col ${active === i ? 'is-on' : ''}`}
                tabIndex={0}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onBlur={() => setActive(null)}
              >
                <rect className="chart-hit" x={i * slot} y="0" width={slot} height={height} />
                {barHeight > 0 ? (
                  <rect
                    className="chart-bar"
                    x={x}
                    y={height - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx={Math.min(4, barWidth / 2)}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="chart-axis" aria-hidden="true">
        <span>{bars[0]?.label}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.label}>
              <th>{bar.label}</th>
              <td>{bar.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Barras horizontales con etiqueta y valor escritos (canal, medio de pago): el color no es lo único que informa. */
export function Rows({ rows }: { rows: Array<{ label: string; value: number; text: string }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="muted">Sin ventas en el periodo.</p>;
  return (
    <div className="hbars">
      {rows.map((row) => (
        <div className="hbar" key={row.label}>
          <span>{row.label}</span>
          <svg className="hbar-track" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
            <rect
              className="chart-bar"
              x="0"
              y="0"
              width={Math.max(1, (row.value / max) * 100)}
              height="12"
              rx="2"
            />
          </svg>
          <span className="v">{row.text}</span>
        </div>
      ))}
    </div>
  );
}
