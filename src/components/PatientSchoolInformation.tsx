import React, { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, CheckCircle2, Clock, History, Loader2, Plus, ShieldAlert } from 'lucide-react';
import { dataService } from '../services/dataService';

export function PatientSchoolInformation({ patientId, canManage = false, isPanelDark = false }: { patientId: string; canManage?: boolean; isPanelDark?: boolean }) {
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ schoolId: '', schoolUnitId: '', academicYear: String(new Date().getFullYear()), gradeLevel: '', className: '', shift: '', startedAt: new Date().toISOString().slice(0, 10), previousExitReason: '' });

  const load = async () => {
    setLoading(true);
    const [enrollmentResult, schoolResult] = await Promise.all([dataService.getPatientSchoolEnrollments(patientId), dataService.getSchoolAutocomplete('')]);
    setEnrollments(enrollmentResult?.success ? enrollmentResult.data || [] : []);
    setSchools(schoolResult?.success ? schoolResult.data || [] : []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, [patientId]);
  const current = useMemo(() => enrollments.find((row) => row.is_current), [enrollments]);
  const selectedSchool = schools.find((school) => school.id === form.schoolId);

  const save = async () => {
    if (!form.schoolId) return;
    setSaving(true); setMessage('');
    const result = await dataService.createPatientSchoolEnrollment(patientId, { ...form, academicYear: Number(form.academicYear), closeCurrent: true, idempotencyKey: crypto.randomUUID() });
    if (result?.success) { setShowForm(false); setMessage('Vínculo escolar atualizado sem apagar o histórico anterior.'); await load(); }
    else setMessage(result?.message || 'Não foi possível salvar o vínculo escolar.');
    setSaving(false);
  };

  if (loading) return <div className="flex min-h-56 items-center justify-center"><Loader2 className="animate-spin text-violet-500" /></div>;
  const card = isPanelDark ? 'border-slate-700 bg-[#101b2e] text-slate-100' : 'border-slate-100 bg-white text-slate-900';
  return <div className="space-y-5 animate-fade-in" data-patient-school-information>
    {message && <div className="rounded-2xl border border-violet-100 bg-violet-50 p-3 text-sm font-medium text-violet-800">{message}</div>}
    <div className={`rounded-3xl border p-5 shadow-sm ${card}`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 text-lg font-semibold"><Building2 className="text-violet-500" size={20}/> Informações escolares</h3><p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Vínculo atual, turma, turno, contatos e histórico preservado.</p></div>{canManage && <button type="button" onClick={() => setShowForm((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2.5 text-sm font-semibold text-white"><Plus size={16}/>{current ? 'Trocar escola' : 'Vincular escola'}</button>}</div>
      {current ? <div className={`mt-5 grid grid-cols-1 gap-3 rounded-2xl p-4 sm:grid-cols-3 ${isPanelDark ? 'bg-slate-900/60' : 'bg-slate-50'}`}><div className="sm:col-span-2"><p className="text-xs uppercase tracking-wide text-slate-400">Escola atual</p><p className="mt-1 font-semibold">{current.schools?.display_name || 'Escola vinculada'}</p><p className="mt-1 text-xs text-slate-500">{current.school_units?.name || 'Unidade principal'} · {[current.grade_level,current.class_name].filter(Boolean).join(' · ') || 'Turma não informada'}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-400">Ano e turno</p><p className="mt-1 font-semibold">{current.academic_year || '—'} · {current.shift || 'Não informado'}</p></div></div> : <div className={`mt-5 rounded-2xl border border-dashed p-8 text-center ${isPanelDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}><Building2 className="mx-auto mb-2 opacity-40"/><p className="font-medium">Nenhum vínculo escolar atual</p></div>}
    </div>
    {showForm && <div className={`rounded-3xl border p-5 ${card}`}><h3 className="font-semibold">Novo vínculo escolar</h3><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-1 block text-xs font-medium text-slate-500">Escola *</span><select value={form.schoolId} onChange={(e)=>setForm((f)=>({...f,schoolId:e.target.value,schoolUnitId:''}))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800"><option value="">Selecione</option>{schools.map((school)=><option key={school.id} value={school.id}>{school.display_name} · {[school.city,school.state].filter(Boolean).join('/')}</option>)}</select></label><label><span className="mb-1 block text-xs font-medium text-slate-500">Ano letivo</span><input value={form.academicYear} onChange={(e)=>setForm((f)=>({...f,academicYear:e.target.value}))} className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-800" inputMode="numeric"/></label><label><span className="mb-1 block text-xs font-medium text-slate-500">Série/ano</span><input value={form.gradeLevel} onChange={(e)=>setForm((f)=>({...f,gradeLevel:e.target.value}))} className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-800"/></label><label><span className="mb-1 block text-xs font-medium text-slate-500">Turma</span><input value={form.className} onChange={(e)=>setForm((f)=>({...f,className:e.target.value}))} className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-800"/></label><label><span className="mb-1 block text-xs font-medium text-slate-500">Turno</span><select value={form.shift} onChange={(e)=>setForm((f)=>({...f,shift:e.target.value}))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800"><option value="">Selecione</option><option value="MORNING">Manhã</option><option value="AFTERNOON">Tarde</option><option value="EVENING">Noite</option><option value="FULL_TIME">Integral</option><option value="OTHER">Outro</option></select></label>{current && <label className="sm:col-span-2"><span className="mb-1 block text-xs font-medium text-slate-500">Motivo da saída da escola anterior</span><input value={form.previousExitReason} onChange={(e)=>setForm((f)=>({...f,previousExitReason:e.target.value}))} className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-800"/></label>}</div><div className="mt-4 flex justify-end"><button type="button" disabled={saving||!form.schoolId} onClick={()=>void save()} className="rounded-xl bg-[#7a32fc] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?'Salvando…':'Salvar vínculo'}</button></div></div>}
    <div className={`rounded-3xl border p-5 ${card}`}><h3 className="flex items-center gap-2 font-semibold"><History size={18} className="text-violet-500"/> Histórico escolar</h3><div className="mt-4 space-y-3">{enrollments.map((row)=><div key={row.id} className={`rounded-2xl border p-4 ${isPanelDark?'border-slate-700 bg-slate-900/50':'border-slate-100 bg-slate-50'}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{row.schools?.display_name || 'Escola'}</p><p className="mt-1 text-xs text-slate-500">{[row.school_units?.name,row.grade_level,row.class_name,row.shift].filter(Boolean).join(' · ') || 'Detalhes não informados'}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${row.is_current?'bg-emerald-50 text-emerald-700':'bg-slate-200 text-slate-600'}`}>{row.is_current?'Atual':'Encerrado'}</span></div><p className="mt-3 flex items-center gap-1 text-xs text-slate-500"><Clock size={13}/>{row.started_at || 'Início não informado'} até {row.ended_at || 'atual'}</p></div>)}</div></div>
  </div>;
}
