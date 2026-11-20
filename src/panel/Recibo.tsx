import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildReceipt, wrapText, type Receipt } from '../core/receipt';
import type { PanelOrder } from './data';
import { Modal, useToast } from './ui';

type PaperSize = 't58' | 't80' | 'hoja';
const SIZES: Array<[PaperSize, string]> = [
  ['t58', 'Tirilla 58 mm'],
  ['t80', 'Tirilla 80 mm'],
  ['hoja', 'Hoja'],
];
const SIZE_KEY = 'jp-recibo-tamano';

function readSize(): PaperSize {
  try {
    const saved = localStorage.getItem(SIZE_KEY);
    if (saved === 't58' || saved === 't80' || saved === 'hoja') return saved;
  } catch {
    // sin almacenamiento: tirilla de 80 mm
  }
  return 't80';
}

/** Duplicado a propósito de src/components/Logo.astro (no se puede importar un .astro en React): todo en negro puro para térmica. */
function LogoMark() {
  return (
    <svg className="recibo-logo" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="7" y="9" width="26" height="26" rx="6" fill="none" stroke="#000" strokeWidth="2.4" />
      <path d="M7 17h26M7 27h26" stroke="#000" strokeWidth="2.4" />
      <path
        d="M15 7c0-3 3-3 3-6M21 7c0-3 3-3 3-6"
        fill="none"
        stroke="#000"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Recibo({
  order,
  business,
}: {
  order: PanelOrder;
  business: { name: string; phone?: string; address?: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-soft" type="button" onClick={() => setOpen(true)}>
        Recibo
      </button>
      {open &&
        createPortal(
          <div className="recibo-root">
            <Modal title={`Recibo ${order.code}`} onClose={() => setOpen(false)}>
              <ReciboBody order={order} business={business} />
            </Modal>
          </div>,
          document.body,
        )}
    </>
  );
}

function ReciboBody({
  order,
  business,
}: {
  order: PanelOrder;
  business: { name: string; phone?: string; address?: string };
}) {
  const toast = useToast();
  const [size, setSize] = useState<PaperSize>(readSize);
  const [busy, setBusy] = useState(false);
  const receipt = buildReceipt(order, business);

  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, size);
    } catch {
      // no pasa nada si no se puede recordar
    }
  }, [size]);

  async function share() {
    setBusy(true);
    try {
      const blob = await renderPng(receipt);
      const file = new File([blob], `recibo-${receipt.code}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Recibo ${receipt.code}` });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError')
        toast('No pudimos generar la imagen. Prueba con Imprimir.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`recibo recibo-${size}`}>
      <div className="recibo-tools">
        <div className="seg" role="group" aria-label="Tamaño del papel">
          {SIZES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={size === value} onClick={() => setSize(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn" type="button" onClick={() => window.print()}>
            Imprimir
          </button>
          <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void share()}>
            {busy ? 'Generando…' : 'Compartir imagen'}
          </button>
        </div>
        <p className="recibo-hint">Para PDF elige “Guardar como PDF” al imprimir.</p>
        <p className="recibo-hint">
          La imagen incluye nombre y dirección del cliente; compártela solo con quien la necesite.
        </p>
      </div>
      <div className="recibo-frame">
        <article className="recibo-paper" aria-label={`Recibo ${receipt.code}`}>
          {receipt.voided && <div className="recibo-stamp">ANULADO</div>}
          <header className="recibo-head">
            <LogoMark />
            <h3>{receipt.business.name}</h3>
            {receipt.business.address && <p>{receipt.business.address}</p>}
            {receipt.business.phone && <p>Tel. {receipt.business.phone}</p>}
          </header>
          <dl className="recibo-meta">
            <div>
              <dt>Pedido</dt>
              <dd className="recibo-code">{receipt.code}</dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{receipt.dateText}</dd>
            </div>
            <div>
              <dt>Canal</dt>
              <dd>{receipt.channel}</dd>
            </div>
            <div>
              <dt>Cliente</dt>
              <dd>{receipt.customer}</dd>
            </div>
            {receipt.phone && (
              <div>
                <dt>Celular</dt>
                <dd>{receipt.phone}</dd>
              </div>
            )}
            {receipt.delivery.pickup ? (
              <div>
                <dt>Entrega</dt>
                <dd>Recoge en tienda</dd>
              </div>
            ) : (
              <>
                <div>
                  <dt>Dirección</dt>
                  <dd>{receipt.delivery.address}</dd>
                </div>
                {receipt.delivery.barrio && (
                  <div>
                    <dt>Barrio</dt>
                    <dd>{receipt.delivery.barrio}</dd>
                  </div>
                )}
              </>
            )}
          </dl>
          <ul className="recibo-items">
            {receipt.items.map((item, index) => (
              <li key={index} className={item.addon ? 'recibo-addon' : undefined}>
                <span>
                  {item.addon ? '+ ' : `${item.qty} × `}
                  {item.addon && item.qty > 1 ? `${item.qty} × ` : ''}
                  {item.name}
                </span>
                <span>{item.amount}</span>
              </li>
            ))}
          </ul>
          <dl className="recibo-totals">
            {receipt.totals.map((row) => (
              <div key={row.label} className={row.strong ? 'recibo-total' : undefined}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          {receipt.payment.length > 0 && (
            <dl className="recibo-totals recibo-pay">
              {receipt.payment.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {receipt.gift && <p className="recibo-note">Regalo: {receipt.gift}</p>}
          {receipt.notes && <p className="recibo-note">Nota: {receipt.notes}</p>}
          <footer className="recibo-foot">
            <p className="recibo-thanks">{receipt.thanks}</p>
            <p className="recibo-legal">{receipt.legal}</p>
          </footer>
        </article>
      </div>
    </div>
  );
}

/* ---------- Imagen compartida: SVG → canvas → PNG (sin librerías ni fuentes externas) ---------- */

const WIDTH = 400;
const PAD = 24;
const FONT = 'Arial, Helvetica, sans-serif';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function receiptSvg(receipt: Receipt): { svg: string; height: number } {
  const out: string[] = [];
  let y = 20;
  const text = (
    value: string,
    x: number,
    size: number,
    opts: { bold?: boolean; anchor?: 'start' | 'middle' | 'end'; color?: string } = {},
  ) =>
    out.push(
      `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${opts.bold ? 700 : 400}" text-anchor="${opts.anchor ?? 'start'}" fill="${opts.color ?? '#000'}">${esc(value)}</text>`,
    );
  const rule = () => {
    out.push(
      `<line x1="${PAD}" y1="${y}" x2="${WIDTH - PAD}" y2="${y}" stroke="#000" stroke-width="1" stroke-dasharray="4 3"/>`,
    );
    y += 18;
  };
  const row = (label: string, value: string, bold = false, size = 14) => {
    y += size + 4;
    text(label, PAD, size, { bold });
    text(value, WIDTH - PAD, size, { bold, anchor: 'end' });
  };
  const para = (label: string, value: string) => {
    const lines = wrapText(`${label}: ${value}`, 36);
    for (const line of lines) {
      y += 19;
      text(line, PAD, 14);
    }
  };

  // Logo
  out.push(
    `<g transform="translate(${WIDTH / 2 - 24} ${y}) scale(1.2)"><rect x="7" y="9" width="26" height="26" rx="6" fill="none" stroke="#000" stroke-width="2.4"/><path d="M7 17h26M7 27h26" stroke="#000" stroke-width="2.4"/><path d="M15 7c0-3 3-3 3-6M21 7c0-3 3-3 3-6" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round"/></g>`,
  );
  y += 58;
  y += 22;
  text(receipt.business.name, WIDTH / 2, 22, { bold: true, anchor: 'middle' });
  for (const line of [receipt.business.address, receipt.business.phone && `Tel. ${receipt.business.phone}`]) {
    if (!line) continue;
    y += 18;
    text(line, WIDTH / 2, 13, { anchor: 'middle' });
  }
  y += 16;
  rule();
  row('Pedido', receipt.code, true, 16);
  row('Fecha', receipt.dateText);
  row('Canal', receipt.channel);
  para('Cliente', receipt.customer);
  if (receipt.phoneMasked) para('Celular', receipt.phoneMasked);
  if (receipt.delivery.pickup) para('Entrega', 'Recoge en tienda');
  else {
    para('Dirección', receipt.delivery.address);
    if (receipt.delivery.barrio) para('Barrio', receipt.delivery.barrio);
  }
  y += 12;
  rule();
  for (const item of receipt.items) {
    const prefix = item.addon ? '+ ' : `${item.qty} × `;
    const lines = wrapText(item.name, item.addon ? 28 : 30);
    lines.forEach((line, index) => {
      y += 19;
      text(`${index === 0 ? prefix : ''}${line}`, item.addon ? PAD + 16 : PAD, 14);
      if (index === 0) text(item.amount, WIDTH - PAD, 14, { anchor: 'end' });
    });
  }
  y += 12;
  rule();
  for (const total of receipt.totals) row(total.label, total.value, total.strong, total.strong ? 18 : 14);
  if (receipt.payment.length) {
    y += 10;
    for (const pay of receipt.payment) row(pay.label, pay.value);
  }
  if (receipt.gift) para('Regalo', receipt.gift);
  if (receipt.notes) para('Nota', receipt.notes);
  y += 16;
  rule();
  y += 6;
  text(receipt.thanks, WIDTH / 2, 18, { bold: true, anchor: 'middle' });
  y += 20;
  text(receipt.legal, WIDTH / 2, 11, { anchor: 'middle' });
  y += 20;
  const height = y;
  if (receipt.voided) {
    out.push(
      `<g transform="translate(${WIDTH / 2} ${height / 2}) rotate(-18)"><rect x="-90" y="-28" width="180" height="56" rx="8" fill="#fff" fill-opacity="0.85" stroke="#000" stroke-width="4"/><text x="0" y="12" font-family="${FONT}" font-size="34" font-weight="700" text-anchor="middle" fill="#000">ANULADO</text></g>`,
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}"><rect width="100%" height="100%" fill="#fff"/>${out.join('')}</svg>`;
  return { svg, height };
}

async function renderPng(receipt: Receipt): Promise<Blob> {
  const { svg, height } = receiptSvg(receipt);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png'))), 'image/png'),
  );
}
