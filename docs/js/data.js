import { supabase } from './config.js';

// ============================================================
// DATA ACCESS — every Supabase read/write goes through here
// ============================================================
function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function loadAllData() {
  const [sessions, sets] = await Promise.all([
    supabase.from('sessions').select('*').order('date', { ascending: true }).then(unwrap),
    supabase.from('sets').select('*').order('created_at', { ascending: true }).then(unwrap),
  ]);
  return { sessions, sets };
}

export async function upsertSession(userId, date, dayNumber) {
  return unwrap(await supabase
    .from('sessions')
    .upsert({ user_id: userId, date, day_number: dayNumber }, { onConflict: 'user_id,date' })
    .select()
    .single());
}

export async function updateSessionDay(sessionId, dayNumber) {
  unwrap(await supabase.from('sessions').update({ day_number: dayNumber }).eq('id', sessionId));
}

export async function deleteSession(sessionId) {
  unwrap(await supabase.from('sessions').delete().eq('id', sessionId));
}

export async function upsertSet(payload) {
  return unwrap(await supabase
    .from('sets')
    .upsert(payload, { onConflict: 'session_id,exercise_name,set_number' })
    .select()
    .single());
}

export async function deleteSet(setId) {
  unwrap(await supabase.from('sets').delete().eq('id', setId));
}

export async function updateAlternative(sessionId, exerciseName, isAlternative, note) {
  return unwrap(await supabase
    .from('sets')
    .update({ is_alternative: isAlternative, alternative_note: note })
    .eq('session_id', sessionId)
    .eq('exercise_name', exerciseName)
    .select());
}
