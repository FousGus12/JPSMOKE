// Reseñas (D57): transcripción de reseñas reales con fuente y fecha. Nada se inventa: sin semilla.
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  SOURCES,
  deleteReview,
  loadReviews,
  moveId,
  saveOrder,
  saveReview,
  setReviewApproved,
  todayBogota,
  validateReview,
  type Review,
  type ReviewForm,
} from './reviews-data';
import { Modal, useToast } from './ui';

const dateLabel = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const formatDay = (day: string) => {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? dateLabel.format(ms) : day;
};
const stars = (count: number) => '★'.repeat(count) + '☆'.repeat(5 - count);

export function Resenas({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [list, setList] = useState<Review[] | null>(null);
  const [editing, setEditing] = useState<Review | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      loadReviews(restaurantId)
        .then(setList)
        .catch((failure: unknown) => {
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar las reseñas.');
          setList((current) => current ?? []);
        }),
    [restaurantId, toast],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<void>, message?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      if (message) toast(message);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo hacer el cambio.');
    } finally {
      await reload();
      setBusy(false);
    }
  }

  const move = (review: Review, dir: -1 | 1) =>
    list &&
    run(() =>
      saveOrder(
        list,
        moveId(
          list.map((item) => item.id),
          review.id,
          dir,
        ),
      ),
    );
  const toggle = (review: Review) =>
    run(
      () => setReviewApproved(review.id, !review.approved),
      review.approved ? 'Reseña oculta.' : 'Reseña aprobada: se verá al publicar.',
    );
  const remove = (review: Review) => {
    if (!confirm(`¿Borrar la reseña de ${review.author}? No se puede deshacer.`)) return;
    void run(() => deleteReview(review.id), 'Reseña borrada.');
  };

  const nextPosition = list?.length ? Math.max(...list.map((item) => item.position)) + 1 : 0;

  return (
    <section className="reviews">
      <div className="note reviews-note">
        <b>Solo reseñas reales; se ven en la página al publicar.</b> Transcribe cada una con su autor, fuente
        y fecha. Sin reseñas aprobadas, la sección no aparece.
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" type="button" onClick={() => setEditing('new')}>
          ＋ Nueva reseña
        </button>
      </div>
      {list === null ? (
        <p className="muted center">Cargando…</p>
      ) : list.length === 0 ? (
        <p className="muted center reviews-empty">
          Aún no hay reseñas. Agrega la primera cuando tengas una real.
        </p>
      ) : (
        <ul className="reviews-list">
          {list.map((review, index) => (
            <li className={`card review ${review.approved ? '' : 'is-hidden'}`} key={review.id}>
              <div className="review-top">
                <span className="review-stars" role="img" aria-label={`${review.stars} de 5 estrellas`}>
                  {stars(review.stars)}
                </span>
                <span className={`chip review-state ${review.approved ? 'is-on' : ''}`}>
                  {review.approved ? 'Visible' : 'Oculta'}
                </span>
              </div>
              <p className="review-body">{review.body}</p>
              <p className="review-meta muted">
                <b>{review.author}</b> · {review.source} · {formatDay(review.review_date)}
              </p>
              <div className="btn-row review-actions">
                <button
                  className="btn btn-soft btn-sm"
                  type="button"
                  disabled={busy}
                  onClick={() => void toggle(review)}
                >
                  {review.approved ? 'Ocultar' : 'Aprobar'}
                </button>
                <button
                  className="btn btn-soft btn-sm"
                  type="button"
                  disabled={busy || index === 0}
                  aria-label={`Subir la reseña de ${review.author}`}
                  onClick={() => void move(review, -1)}
                >
                  ↑ Subir
                </button>
                <button
                  className="btn btn-soft btn-sm"
                  type="button"
                  disabled={busy || index === list.length - 1}
                  aria-label={`Bajar la reseña de ${review.author}`}
                  onClick={() => void move(review, 1)}
                >
                  ↓ Bajar
                </button>
                <button
                  className="btn btn-soft btn-sm"
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(review)}
                >
                  Editar
                </button>
                <button
                  className="btn btn-soft btn-sm"
                  type="button"
                  disabled={busy}
                  onClick={() => remove(review)}
                >
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ReviewModal
          review={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (form) => {
            await saveReview(restaurantId, form, editing === 'new' ? undefined : editing.id, nextPosition);
            setEditing(null);
            toast(editing === 'new' ? 'Reseña agregada.' : 'Reseña guardada.');
            await reload();
          }}
        />
      ) : null}
    </section>
  );
}

function ReviewModal({
  review,
  onClose,
  onSave,
}: {
  review: Review | null;
  onClose: () => void;
  onSave: (form: ReviewForm) => Promise<void>;
}) {
  const [form, setForm] = useState<ReviewForm>(() => ({
    author: review?.author ?? '',
    stars: review?.stars ?? 0,
    body: review?.body ?? '',
    source: review?.source ?? '',
    review_date: review?.review_date ?? todayBogota(),
    approved: review?.approved ?? false,
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set =
    <K extends keyof ReviewForm>(key: K) =>
    (event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const target = event.currentTarget;
      const value =
        target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
      setForm((current) => ({ ...current, [key]: value }));
    };

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (saving) return;
    const problem = validateReview(form);
    if (problem) return setError(problem);
    setError('');
    setSaving(true);
    try {
      await onSave(form);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
      setSaving(false);
    }
  }

  return (
    <Modal title={review ? `Editar reseña de ${review.author}` : 'Nueva reseña'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-2">
          <div className="field">
            <label htmlFor="rv-author">Autor</label>
            <input
              className="input"
              id="rv-author"
              maxLength={40}
              value={form.author}
              onChange={set('author')}
            />
          </div>
          <div className="field">
            <label htmlFor="rv-source">Fuente</label>
            <select className="select" id="rv-source" value={form.source} onChange={set('source')}>
              <option value="">Elige dónde la dejaron</option>
              {SOURCES.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label" id="rv-stars-label">
              Estrellas
            </span>
            <div className="review-stars-pick" role="group" aria-labelledby="rv-stars-label">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="btn btn-soft btn-sm"
                  aria-pressed={form.stars === value}
                  aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'}`}
                  onClick={() => setForm((current) => ({ ...current, stars: value }))}
                >
                  {value}★
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="rv-date">Fecha de la reseña</label>
            <input
              className="input"
              id="rv-date"
              type="date"
              max={todayBogota()}
              value={form.review_date}
              onChange={set('review_date')}
            />
          </div>
          <div className="field span-2">
            <label htmlFor="rv-body">Texto</label>
            <textarea
              className="textarea"
              id="rv-body"
              maxLength={400}
              value={form.body}
              onChange={set('body')}
            />
            <small className="muted">{form.body.trim().length}/400</small>
          </div>
          <label className="chip-check span-2">
            <input type="checkbox" checked={form.approved} onChange={set('approved')} /> Visible en la página
            al publicar
          </label>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar reseña'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
