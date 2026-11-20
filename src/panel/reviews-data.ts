// Reseñas transcritas a mano (D57). Solo reseñas reales: la fuente es obligatoria. RLS: apartado Sitio.
import { getSupabase } from '../lib/supabase';

export const SOURCES = ['Google', 'Instagram', 'WhatsApp', 'En persona'] as const;
export type ReviewSource = (typeof SOURCES)[number];

export interface Review {
  id: string;
  author: string;
  stars: number;
  body: string;
  approved: boolean;
  source: ReviewSource;
  review_date: string;
  position: number;
}
export interface ReviewForm {
  author: string;
  stars: number;
  body: string;
  source: ReviewSource | '';
  review_date: string;
  approved: boolean;
}

const COLUMNS = 'id, author, stars, body, approved, source, review_date, position';

/** Hoy en Bogotá como AAAA-MM-DD. */
export const todayBogota = (now = Date.now()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);

/** Valida el formulario; devuelve el mensaje de error o null. Los límites son los de la base. */
export function validateReview(form: ReviewForm, today = todayBogota()): string | null {
  const author = form.author.trim();
  if (author.length < 2 || author.length > 40) return 'El autor va de 2 a 40 caracteres.';
  if (!Number.isInteger(form.stars) || form.stars < 1 || form.stars > 5) return 'Elige de 1 a 5 estrellas.';
  const body = form.body.trim();
  if (body.length < 5) return 'Escribe el texto de la reseña (mínimo 5 caracteres).';
  if (body.length > 400) return 'El texto admite hasta 400 caracteres.';
  if (!form.source || !SOURCES.includes(form.source)) return 'Elige la fuente: dónde se dejó la reseña.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.review_date)) return 'Pon la fecha de la reseña.';
  if (form.review_date > today) return 'La fecha de la reseña no puede ser futura.';
  return null;
}

/** Orden final tras mover `id` una casilla; la misma lista si no se puede mover. */
export function moveId(ids: string[], id: string, dir: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to] as string, next[from] as string];
  return next;
}

function fail(error: { message: string; code?: string } | null, what: string): void {
  if (!error) return;
  if (error.code === '42501') throw new Error('No tienes permiso para este cambio.');
  if (error.code === '23514' || error.code === '22007' || error.code === '22P02')
    throw new Error('Revisa los datos de la reseña.');
  throw new Error(`No se pudo ${what}.`);
}

export async function loadReviews(restaurantId: string): Promise<Review[]> {
  const { data, error } = await getSupabase()
    .from('reviews')
    .select(COLUMNS)
    .eq('restaurant_id', restaurantId)
    .order('position')
    .order('review_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error('No pudimos cargar las reseñas.');
  return (data ?? []) as Review[];
}

export async function saveReview(
  restaurantId: string,
  form: ReviewForm,
  id: string | undefined,
  nextPosition: number,
): Promise<void> {
  const fields = {
    author: form.author.trim(),
    stars: form.stars,
    body: form.body.trim(),
    source: form.source,
    review_date: form.review_date,
    approved: form.approved,
  };
  const supabase = getSupabase();
  const { error } = id
    ? await supabase.from('reviews').update(fields).eq('id', id)
    : await supabase
        .from('reviews')
        .insert({ ...fields, restaurant_id: restaurantId, position: nextPosition });
  fail(error, 'guardar la reseña');
}

export async function setReviewApproved(id: string, approved: boolean): Promise<void> {
  const { error } = await getSupabase().from('reviews').update({ approved }).eq('id', id);
  fail(error, 'cambiar la reseña');
}

export async function deleteReview(id: string): Promise<void> {
  const { error } = await getSupabase().from('reviews').delete().eq('id', id);
  fail(error, 'borrar la reseña');
}

/** Guarda el orden: la posición de cada reseña es su lugar en `ids`; solo escribe las que cambian. */
export async function saveOrder(current: Review[], ids: string[]): Promise<void> {
  const supabase = getSupabase();
  const changed = ids
    .map((id, position) => ({ id, position, was: current.find((review) => review.id === id)?.position }))
    .filter((item) => item.was !== item.position);
  const results = await Promise.all(
    changed.map((item) => supabase.from('reviews').update({ position: item.position }).eq('id', item.id)),
  );
  fail(results.find((result) => result.error)?.error ?? null, 'ordenar las reseñas');
}
