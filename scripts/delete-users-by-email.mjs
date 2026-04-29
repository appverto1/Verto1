import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const TARGET_EMAILS = [
  'alexandre@verto.com',
  'appverto1@gmail.com',
  'fabio@verto.com',
  'h@gmail.com',
  'mateus.com96@gmail.com',
  'mateus.exos@gmail.com',
  'mateus.highline@gmail.com',
  'mateusn1digital@gmail.com',
  'oanhvosfv@gmail.com',
  'p@gmail.com',
  'paciente.convencional@verto.com',
  'paciente.kids@verto.com',
  'profissionalmps1@gmail.com'
].map(e => e.trim().toLowerCase());

const TABLES = [
  'activity_logs',
  'clinic_memberships',
  'invitations',
  'notes',
  'history',
  'tasks',
  'assigned_tasks',
  'patients',
  'users'
];

const CANDIDATE_COLS = [
  'email',
  'patient_email',
  'user_id',
  'therapist_id',
  'professional_id',
  'invited_by',
  'patient_id',
  'id'
];

async function getColumns(table) {
  const { data, error } = await supabase
    .from('information_schema.columns')
    .select('column_name')
    .eq('table_schema', 'public')
    .eq('table_name', table);

  if (error) return [];
  return (data || []).map(r => r.column_name);
}

async function tryDelete(table, col, value, mode = 'eq') {
  let q = supabase.from(table).delete();
  q = mode === 'ilike' ? q.ilike(col, value) : q.eq(col, value);
  const { error } = await q;
  if (error) {
    console.warn(`- ${table}.${col}: ${error.message}`);
    return false;
  }
  return true;
}

async function deleteEmail(email) {
  console.log(`\n=== ${email} ===`);

  // 1) localizar auth user (id) primeiro
  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    console.error('Erro listando auth.users:', listErr.message);
    return;
  }
  const authUser = listed.users.find(u => (u.email || '').toLowerCase() === email);
  const authId = authUser?.id || null;

  // 2) localizar public.users por email (caso exista)
  const { data: publicByEmail } = await supabase
    .from('users')
    .select('id,email')
    .ilike('email', email)
    .maybeSingle();

  const userId = authId || publicByEmail?.id || null;

  // 3) limpar tabelas dinamicamente conforme colunas existentes
  for (const table of TABLES) {
    const cols = await getColumns(table);
    if (!cols.length) continue;

    for (const col of CANDIDATE_COLS) {
      if (!cols.includes(col)) continue;

      // por email
      if (col === 'email' || col === 'patient_email') {
        await tryDelete(table, col, email, 'ilike');
      }

      // por UUID
      if (userId && ['user_id', 'therapist_id', 'professional_id', 'invited_by', 'patient_id', 'id'].includes(col)) {
        await tryDelete(table, col, userId, 'eq');
      }
    }
  }

  // 4) garantir remoção de public.users por email (sobrou algo)
  await tryDelete('users', 'email', email, 'ilike');

  // 5) apagar auth.users por id
  if (authId) {
    const { error: delAuthErr } = await supabase.auth.admin.deleteUser(authId);
    if (delAuthErr) {
      console.error(`auth.users erro (${email}):`, delAuthErr.message);
    } else {
      console.log('auth.users removido.');
    }
  } else {
    console.log('auth.users não encontrado (ok).');
  }
}

(async () => {
  for (const email of TARGET_EMAILS) {
    try {
      await deleteEmail(email);
    } catch (e) {
      console.error(`Falha inesperada em ${email}:`, e?.message || e);
    }
  }
  console.log('\nConcluído.');
})();
