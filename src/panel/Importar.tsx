import { useEffect, useMemo, useState } from 'react';
import {
  buildRows,
  decodeCsv,
  FIELDS,
  MAX_ROWS,
  missingFields,
  parseCsv,
  previewCounts,
  resolveMap,
  type ColumnMap,
  type CsvTable,
  type ImportChannel,
  type ImportField,
  type PreviewCounts,
} from '../core/csv-import';
import { formatCop as money } from '../core/money';
import {
  importSales,
  loadImportMaps,
  loadPreviewContext,
  revertImport,
  saveImportMap,
  type ExternalSummary,
  type ImportResult,
} from './import-data';
import { useToast } from './ui';

const CHANNELS: Array<[ImportChannel, string]> = [
  ['rappi', 'Rappi'],
  ['didi', 'DiDi'],
];
const LABEL: Record<ImportChannel, string> = { rappi: 'Rappi', didi: 'DiDi' };
const MAX_BYTES = 5 * 1024 * 1024;
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });
const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('es-CO')} ${count === 1 ? one : many}`;

/** Ventas de Rappi y DiDi desde el reporte CSV del portal de aliados (D64). Van a external_sales, fuera de caja. */
export function Importar({
  restaurantId,
  summary,
  failed,
  onChanged,
}: {
  restaurantId: string;
  summary: ExternalSummary | null;
  failed: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [channel, setChannel] = useState<ImportChannel>('rappi');
  const [maps, setMaps] = useState<Record<string, unknown>>({});
  const [fileName, setFileName] = useState('');
  const [fileKey, setFileKey] = useState(0);
  const [table, setTable] = useState<CsvTable | null>(null);
  // Cambios a mano del mapeo; null = el guardado del canal o la propuesta por nombres comunes.
  const [edits, setEdits] = useState<ColumnMap | null>(null);
  const [estimated, setEstimated] = useState<{ for: object; value: PreviewCounts | 'error' } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadImportMaps(restaurantId)
      .then(setMaps)
      .catch((failure: unknown) => toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'));
  }, [restaurantId, toast]);

  // Mapeo: el guardado del canal manda; lo que falte se propone por nombres comunes.
  const map = useMemo(
    () => edits ?? (table ? resolveMap(table.headers, maps[channel]) : {}),
    [edits, table, maps, channel],
  );
  const built = useMemo(() => (table ? buildRows(table, map) : null), [table, map]);
  const missing = missingFields(map);
  const ready = Boolean(built && built.rows.length && !missing.length && built.rows.length <= MAX_ROWS);

  // Estimado de repetidas y ya registradas (el servidor da el dato definitivo al importar).
  const estimate = estimated && estimated.for === built ? estimated.value : null;
  useEffect(() => {
    if (!built || !built.rows.length || missing.length) return;
    let live = true;
    loadPreviewContext(restaurantId, channel, built.rows)
      .then((context) => {
        if (live)
          setEstimated({
            for: built,
            value: previewCounts(built.rows, context.existingIds, context.orders, context.alreadyMatched),
          });
      })
      .catch(() => {
        if (live) setEstimated({ for: built, value: 'error' });
      });
    return () => {
      live = false;
    };
  }, [built, channel, restaurantId, missing.length]);

  async function onFile(file: File | undefined) {
    setResult(null);
    setTable(null);
    setEdits(null);
    setFileName('');
    if (!file) return;
    if (file.size > MAX_BYTES)
      return toast('El archivo pesa más de 5 MB. Descarga un rango de fechas más corto.');
    try {
      const parsed = parseCsv(decodeCsv(new Uint8Array(await file.arrayBuffer())));
      if (!parsed.headers.length || !parsed.rows.length)
        return toast('El archivo no tiene filas para importar.');
      setFileName(file.name);
      setTable(parsed);
    } catch {
      toast('No pudimos leer el archivo. Debe ser CSV.');
    }
  }

  function pick(field: ImportField, header: string) {
    // Una columna sirve a un solo campo.
    const next: ColumnMap = Object.fromEntries(
      Object.entries(map).filter(([key, value]) => key !== field && value !== header),
    );
    if (header) next[field] = header;
    setEdits(next);
  }

  async function saveMap(quiet = false) {
    try {
      await saveImportMap(restaurantId, channel, map);
      setMaps((current) => ({ ...current, [channel]: map }));
      setEdits(null);
      if (!quiet) toast(`Mapeo de ${LABEL[channel]} guardado.`);
    } catch (failure) {
      if (!quiet) toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    }
  }

  async function submit() {
    if (!built || !ready) return;
    setBusy(true);
    try {
      const done = await importSales(channel, fileName, built.rows, built.lines);
      setResult(done);
      await saveMap(true);
      setTable(null);
      setFileName('');
      setFileKey((key) => key + 1);
      toast(
        done.inserted
          ? `${plural(done.inserted, 'venta importada', 'ventas importadas')} de ${LABEL[channel]}.`
          : 'No había ventas nuevas en el archivo.',
      );
      onChanged();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo importar.');
    } finally {
      setBusy(false);
    }
  }

  async function revert(batch: ExternalSummary['batches'][number]) {
    const label = batch.file || `lote de ${LABEL[batch.channel]}`;
    if (
      !confirm(`¿Revertir «${label}»? Se borran sus ${plural(batch.inserted, 'venta', 'ventas')} importadas.`)
    )
      return;
    try {
      const removed = await revertImport(batch.id);
      toast(`Lote revertido: ${plural(removed, 'venta borrada', 'ventas borradas')}.`);
      onChanged();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo revertir.');
    }
  }

  const fresh = estimate && estimate !== 'error' ? estimate : null;
  return (
    <>
      <section className="card imp" aria-label="Importar archivo de Rappi o DiDi">
        <div className="card-head">
          <div>
            <h2>Importar archivo</h2>
            <p>Reporte CSV del portal de aliados. Se suma aparte de la caja y cada lote se puede revertir.</p>
          </div>
        </div>
        <p className="note" data-testid="imp-nota">
          Cuando tengas el archivo real de Rappi o DiDi, el mapeo se ajusta una vez y queda guardado.
        </p>
        <div className="imp-step">
          <div className="seg" role="group" aria-label="Plataforma">
            {CHANNELS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={channel === value}
                onClick={() => {
                  setChannel(value);
                  setEdits(null);
                  setResult(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="field imp-file">
            <label htmlFor="imp-file">Archivo CSV</label>
            <input
              key={fileKey}
              id="imp-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
          </div>
        </div>

        {table && built ? (
          <>
            <h3 className="imp-title">Columnas de {LABEL[channel]}</h3>
            <div className="imp-map">
              {FIELDS.map((field) => (
                <div className="field" key={field.key}>
                  <label htmlFor={`imp-map-${field.key}`}>
                    {field.label}
                    {field.required ? '' : ' (opcional)'}
                  </label>
                  <select
                    className="select"
                    id={`imp-map-${field.key}`}
                    value={map[field.key] ?? ''}
                    onChange={(event) => pick(field.key, event.target.value)}
                  >
                    <option value="">— Sin columna —</option>
                    {table.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="btn-row">
              <button className="btn btn-soft btn-sm" type="button" onClick={() => void saveMap()}>
                Guardar mapeo
              </button>
            </div>
            {missing.length ? (
              <p className="note note-warn" role="status">
                Falta elegir: {missing.join(', ')}.
              </p>
            ) : (
              <Preview
                fileName={fileName}
                total={table.rows.length}
                built={built}
                estimate={estimate}
                fresh={fresh}
              />
            )}
            <button
              className="btn btn-primary"
              type="button"
              disabled={!ready || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Importando…' : `Importar ${plural(built.rows.length, 'venta', 'ventas')}`}
            </button>
          </>
        ) : null}

        {result ? <ResultNote result={result} /> : null}
      </section>

      <section className="card" aria-label="Lotes importados">
        <div className="card-head">
          <div>
            <h2>Lotes importados</h2>
            <p>Los últimos 20. Revertir borra solo las ventas de ese lote.</p>
          </div>
        </div>
        {failed ? (
          <p className="muted">No pudimos cargar los lotes. Recarga la página.</p>
        ) : !summary ? (
          <p className="muted">Cargando…</p>
        ) : summary.batches.length === 0 ? (
          <p className="muted">Aún no hay importaciones.</p>
        ) : (
          <div className="table-wrap imp-lots">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Canal</th>
                  <th>Archivo</th>
                  <th className="num">Nuevas</th>
                  <th className="num">Ya registradas</th>
                  <th className="num">Repetidas</th>
                  <th className="num">Errores</th>
                  <th>Por</th>
                  <th>
                    <span className="sr-only">Acción</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>{when(batch.at)}</td>
                    <td>{LABEL[batch.channel]}</td>
                    <td className="imp-name">{batch.file || '—'}</td>
                    <td className="num">{batch.inserted - batch.matched}</td>
                    <td className="num">{batch.matched}</td>
                    <td className="num">{batch.repeated}</td>
                    <td className="num">{batch.errors}</td>
                    <td>{batch.by}</td>
                    <td>
                      <button
                        className="btn btn-soft btn-sm"
                        type="button"
                        onClick={() => void revert(batch)}
                      >
                        Revertir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Preview({
  fileName,
  total,
  built,
  estimate,
  fresh,
}: {
  fileName: string;
  total: number;
  built: ReturnType<typeof buildRows>;
  estimate: PreviewCounts | null | 'error';
  fresh: PreviewCounts | null;
}) {
  const valid = built.rows.length;
  const sum = built.rows.reduce((acc, row) => acc + row.total, 0);
  return (
    <div className="imp-preview" data-testid="imp-vista-previa">
      <h3 className="imp-title">
        Vista previa · {fileName} ({plural(total, 'fila', 'filas')})
      </h3>
      <ul className="imp-counts">
        <li>
          <b data-testid="imp-validas">{valid.toLocaleString('es-CO')}</b> válidas · {money(sum)}
        </li>
        <li>
          <b data-testid="imp-nuevas">{fresh ? fresh.fresh : estimate === 'error' ? '—' : '…'}</b> nuevas
        </li>
        <li>
          <b data-testid="imp-repetidas">
            {fresh ? fresh.repeated + built.repeatedInFile : built.repeatedInFile}
          </b>{' '}
          repetidas
        </li>
        <li>
          <b data-testid="imp-ya-registradas">{fresh ? fresh.matched : estimate === 'error' ? '—' : '…'}</b>{' '}
          ya registradas a mano
        </li>
        <li className={built.errors.length ? 'imp-bad' : ''}>
          <b data-testid="imp-errores">{built.errors.length}</b> con error
        </li>
        {built.voided ? (
          <li>
            <b data-testid="imp-anuladas">{built.voided}</b> anuladas en la plataforma (no se importan)
          </li>
        ) : null}
      </ul>
      <p className="muted imp-small">
        {estimate === 'error'
          ? 'No pudimos estimar repetidas ni ya registradas; el resultado final lo da la importación.'
          : 'Repetidas y ya registradas son un estimado; la importación da el resultado final. Las ya registradas a mano no se suman dos veces.'}
        {built.commission !== null
          ? ` Comisión en el archivo: ${money(built.commission)} (informativa, no se guarda).`
          : ''}
      </p>
      {valid > MAX_ROWS ? (
        <p className="note note-warn" role="status">
          El archivo tiene más de {MAX_ROWS.toLocaleString('es-CO')} ventas válidas. Descárgalo por rangos de
          fechas más cortos.
        </p>
      ) : null}
      {built.errors.length ? (
        <details className="imp-errors">
          <summary>Ver filas con error</summary>
          <ul>
            {built.errors.slice(0, 50).map((error) => (
              <li key={error.line}>
                Fila {error.line}: {error.reason}
              </li>
            ))}
            {built.errors.length > 50 ? <li>… y {built.errors.length - 50} más.</li> : null}
          </ul>
        </details>
      ) : null}
      {valid ? (
        <div className="table-wrap imp-sample">
          <table>
            <caption className="sr-only">Primeras ventas del archivo</caption>
            <thead>
              <tr>
                <th>Id</th>
                <th>Fecha</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {built.rows.slice(0, 5).map((row) => (
                <tr key={row.external_id}>
                  <td className="imp-name">{row.external_id}</td>
                  <td>{row.date}</td>
                  <td className="num">{money(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function ResultNote({ result }: { result: ImportResult }) {
  return (
    <div className="note imp-result" role="status" data-testid="imp-resultado">
      <b>Importación lista:</b> {plural(result.inserted - result.matched, 'nueva', 'nuevas')} ·{' '}
      {plural(result.matched, 'ya registrada a mano', 'ya registradas a mano')} ·{' '}
      {plural(result.repeated, 'repetida', 'repetidas')} · {plural(result.errors, 'con error', 'con error')}.
      {result.errorRows.length ? (
        <ul>
          {result.errorRows.map((error) => (
            <li key={error.line}>
              Fila {error.line}: {error.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
