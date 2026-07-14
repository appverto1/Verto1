import React from 'react';
import { BatteryCharging, BatteryFull, Ear, Users, Brain, Check, CheckCircle, Activity, DollarSign, Briefcase, Heart, Plus } from 'lucide-react';
import logoVerto from '../assets/Logoverto.png';

export const ENERGY_TAGS = [
  { id: 'sensory', label: 'Sensorial', icon: <Ear size={18} />, color: 'bg-purple-100 text-purple-600 border-purple-200' },
  { id: 'social', label: 'Social', icon: <Users size={18} />, color: 'bg-blue-100 text-blue-600 border-blue-200' },
  { id: 'focus', label: 'Foco', icon: <Brain size={18} />, color: 'bg-orange-100 text-orange-600 border-orange-200' },
  { id: 'rest', label: 'Descanso', icon: <BatteryCharging size={18} />, color: 'bg-green-100 text-green-600 border-green-200' }
];

export const ADULT_CONVENTIONAL_TAGS = [
  { id: 'family', label: 'Família', icon: <Users size={18} />, color: 'bg-blue-100 text-blue-600 border-blue-200' },
  { id: 'money', label: 'Dinheiro', icon: <DollarSign size={18} />, color: 'bg-green-100 text-green-600 border-green-200' },
  { id: 'work', label: 'Trabalho', icon: <Briefcase size={18} />, color: 'bg-orange-100 text-orange-600 border-orange-200' },
  { id: 'relationship', label: 'Relacionamento', icon: <Heart size={18} />, color: 'bg-pink-100 text-pink-600 border-pink-200' },
  { id: 'thought', label: 'Pensamento', icon: <Brain size={18} />, color: 'bg-purple-100 text-purple-600 border-purple-200' },
  { id: 'others', label: 'Outros', icon: <Plus size={18} />, color: 'bg-gray-100 text-gray-600 border-gray-200' }
];

export const LogoVerto = ({ size = 64, className = "", showText = false }: { size?: number, className?: string, showText?: boolean }) => (
  <div className={`flex items-center gap-2 shrink-0 ${className}`}>
    <div style={{ width: size, height: size }} className="flex items-center justify-center">
      <img src={logoVerto} alt="Verto Logo" className="w-full h-full object-contain" />
    </div>
    {showText && (
      <span className="text-2xl font-logo font-bold tracking-tighter text-[#7a32fc] lowercase" style={{ fontSize: size * 0.5 }}>verto</span>
    )}
  </div>
);

export const GlobalStyles = () => (
  <style>{`
    body { background-color: #F4F7FE; font-family: 'Inter', sans-serif; }
    body.theme-dark { background-color: #0b1220; color: #e2e8f0; }
    body.theme-dark #root { background-color: #0b1220; }
    body.theme-dark .bg-\\[\\#F4F7FE\\],
    body.theme-dark .bg-\\[\\#F4F7FE\\]\\/85 { background-color: #0f172a !important; }
    body.theme-dark .bg-\\[\\#F8FAFC\\],
    body.theme-dark .bg-\\[\\#F8FAFF\\] { background-color: #111b2f !important; }
    body.theme-dark .bg-\\[\\#f6f0ff\\] { background-color: rgba(122, 50, 252, 0.16) !important; }
    body.theme-dark .bg-white { background-color: #111b2f !important; }
    body.theme-dark .bg-white\\/60,
    body.theme-dark .bg-white\\/70,
    body.theme-dark .bg-white\\/80,
    body.theme-dark .bg-white\\/90 { background-color: rgba(17, 27, 47, 0.9) !important; }
    body.theme-dark .bg-gray-50,
    body.theme-dark .bg-gray-100 { background-color: #16243b !important; }
    body.theme-dark .bg-gray-200 { background-color: #20304a !important; }
    body.theme-dark .bg-slate-50,
    body.theme-dark .bg-slate-50\\/50,
    body.theme-dark .bg-slate-50\\/60,
    body.theme-dark .bg-slate-50\\/70,
    body.theme-dark .bg-slate-50\\/80,
    body.theme-dark .bg-slate-100\\/70,
    body.theme-dark .bg-slate-100 { background-color: #16243b !important; }
    body.theme-dark .bg-slate-200 { background-color: #20304a !important; }
    body.theme-dark .bg-purple-50,
    body.theme-dark .bg-violet-50,
    body.theme-dark .bg-indigo-50,
    body.theme-dark .bg-blue-50,
    body.theme-dark .bg-purple-50\\/50,
    body.theme-dark .bg-purple-50\\/60,
    body.theme-dark .bg-purple-50\\/70,
    body.theme-dark .bg-violet-50\\/40,
    body.theme-dark .bg-violet-50\\/70,
    body.theme-dark .bg-indigo-50\\/40,
    body.theme-dark .bg-indigo-50\\/50,
    body.theme-dark .bg-indigo-50\\/60,
    body.theme-dark .bg-blue-50\\/40,
    body.theme-dark .bg-blue-50\\/70 { background-color: rgba(122, 50, 252, 0.16) !important; }
    body.theme-dark .bg-cyan-50,
    body.theme-dark .bg-sky-50,
    body.theme-dark .bg-cyan-50\\/70,
    body.theme-dark .bg-sky-50\\/80 { background-color: rgba(14, 165, 233, 0.14) !important; }
    body.theme-dark .bg-amber-50,
    body.theme-dark .bg-orange-50,
    body.theme-dark .bg-yellow-50,
    body.theme-dark .bg-amber-50\\/30,
    body.theme-dark .bg-amber-50\\/60,
    body.theme-dark .bg-amber-50\\/70 { background-color: rgba(245, 158, 11, 0.16) !important; }
    body.theme-dark .bg-amber-100,
    body.theme-dark .bg-orange-100,
    body.theme-dark .bg-yellow-100 { background-color: rgba(245, 158, 11, 0.24) !important; }
    body.theme-dark .bg-red-50,
    body.theme-dark .bg-rose-50,
    body.theme-dark .bg-pink-50,
    body.theme-dark .bg-rose-50\\/60,
    body.theme-dark .bg-pink-50\\/50,
    body.theme-dark .bg-pink-50\\/70 { background-color: rgba(239, 68, 68, 0.14) !important; }
    body.theme-dark .bg-red-100,
    body.theme-dark .bg-rose-100,
    body.theme-dark .bg-pink-100 { background-color: rgba(239, 68, 68, 0.22) !important; }
    body.theme-dark .bg-emerald-50,
    body.theme-dark .bg-green-50,
    body.theme-dark .bg-emerald-50\\/30,
    body.theme-dark .bg-emerald-50\\/40,
    body.theme-dark .bg-emerald-50\\/60,
    body.theme-dark .bg-emerald-50\\/70,
    body.theme-dark .bg-emerald-50\\/80 { background-color: rgba(16, 185, 129, 0.14) !important; }
    body.theme-dark .bg-emerald-100,
    body.theme-dark .bg-green-100 { background-color: rgba(16, 185, 129, 0.2) !important; }
    body.theme-dark .text-slate-950,
    body.theme-dark .text-slate-900,
    body.theme-dark .text-slate-800 { color: #e5e7eb !important; }
    body.theme-dark .text-slate-700,
    body.theme-dark .text-slate-600,
    body.theme-dark .text-slate-500 { color: #cbd5e1 !important; }
    body.theme-dark .text-slate-400 { color: #a8b7cf !important; }
    body.theme-dark .text-purple-500,
    body.theme-dark .text-purple-600,
    body.theme-dark .text-purple-700,
    body.theme-dark .text-purple-800,
    body.theme-dark .text-purple-900,
    body.theme-dark .text-purple-950,
    body.theme-dark .text-violet-500,
    body.theme-dark .text-violet-600,
    body.theme-dark .text-violet-700,
    body.theme-dark .text-violet-800,
    body.theme-dark .text-violet-900,
    body.theme-dark .text-violet-950,
    body.theme-dark .text-indigo-500,
    body.theme-dark .text-indigo-600,
    body.theme-dark .text-indigo-700,
    body.theme-dark .text-indigo-800,
    body.theme-dark .text-indigo-900,
    body.theme-dark .text-\\[\\#6f2cf5\\],
    body.theme-dark .text-\\[\\#7a32fc\\] { color: #c4b5fd !important; }
    body.theme-dark .text-blue-500,
    body.theme-dark .text-blue-600,
    body.theme-dark .text-blue-700,
    body.theme-dark .text-blue-800,
    body.theme-dark .text-blue-900,
    body.theme-dark .text-cyan-700,
    body.theme-dark .text-cyan-800,
    body.theme-dark .text-cyan-900,
    body.theme-dark .text-sky-500,
    body.theme-dark .text-sky-600,
    body.theme-dark .text-sky-700,
    body.theme-dark .text-sky-800,
    body.theme-dark .text-sky-900,
    body.theme-dark .text-sky-950,
    body.theme-dark .text-sky-950\\/75 { color: #7dd3fc !important; }
    body.theme-dark .text-amber-600,
    body.theme-dark .text-amber-700,
    body.theme-dark .text-amber-800,
    body.theme-dark .text-amber-800\\/80,
    body.theme-dark .text-amber-900,
    body.theme-dark .text-amber-950,
    body.theme-dark .text-amber-950\\/75,
    body.theme-dark .text-orange-600,
    body.theme-dark .text-orange-700,
    body.theme-dark .text-orange-800,
    body.theme-dark .text-orange-900 { color: #fcd34d !important; }
    body.theme-dark .text-red-500,
    body.theme-dark .text-red-600,
    body.theme-dark .text-red-700,
    body.theme-dark .text-red-800,
    body.theme-dark .text-red-900,
    body.theme-dark .text-rose-600,
    body.theme-dark .text-rose-700,
    body.theme-dark .text-rose-800,
    body.theme-dark .text-rose-900,
    body.theme-dark .text-pink-600,
    body.theme-dark .text-pink-700,
    body.theme-dark .text-pink-800,
    body.theme-dark .text-pink-900 { color: #fda4af !important; }
    body.theme-dark .text-emerald-500,
    body.theme-dark .text-emerald-600,
    body.theme-dark .text-emerald-700,
    body.theme-dark .text-emerald-800,
    body.theme-dark .text-emerald-900,
    body.theme-dark .text-emerald-950,
    body.theme-dark .text-emerald-950\\/75,
    body.theme-dark .text-green-500,
    body.theme-dark .text-green-600,
    body.theme-dark .text-green-700,
    body.theme-dark .text-green-800,
    body.theme-dark .text-green-900 { color: #6ee7b7 !important; }
    body.theme-dark .bg-emerald-300.text-emerald-950,
    body.theme-dark .bg-emerald-400.text-emerald-950,
    body.theme-dark .bg-emerald-300 .text-emerald-950,
    body.theme-dark .bg-emerald-400 .text-emerald-950,
    body.theme-dark .bg-emerald-300 .text-emerald-950\/75,
    body.theme-dark .bg-emerald-400 .text-emerald-950\/75 { color: #022c22 !important; }
    body.theme-dark .bg-amber-300.text-amber-950,
    body.theme-dark .bg-amber-400.text-amber-950,
    body.theme-dark .bg-amber-300 .text-amber-950,
    body.theme-dark .bg-amber-400 .text-amber-950,
    body.theme-dark .bg-amber-300 .text-amber-950\/75,
    body.theme-dark .bg-amber-400 .text-amber-950\/75 { color: #422006 !important; }
    body.theme-dark .bg-sky-300.text-sky-950,
    body.theme-dark .bg-sky-400.text-sky-950,
    body.theme-dark .bg-sky-300 .text-sky-950,
    body.theme-dark .bg-sky-400 .text-sky-950,
    body.theme-dark .bg-sky-300 .text-sky-950\/75,
    body.theme-dark .bg-sky-400 .text-sky-950\/75 { color: #082f49 !important; }
    body.theme-dark .text-slate-300 { color: #cbd5e1 !important; }
    body.theme-dark .text-gray-900 { color: #f8fafc !important; }
    body.theme-dark .text-gray-800,
    body.theme-dark .text-gray-700 { color: #e2e8f0 !important; }
    body.theme-dark .text-gray-600,
    body.theme-dark .text-gray-500 { color: #cbd5e1 !important; }
    body.theme-dark .text-gray-400 { color: #94a3b8 !important; }
    body.theme-dark .text-\\[\\#0B1533\\],
    body.theme-dark .text-\\[\\#111827\\] { color: #f8fafc !important; }
    body.theme-dark .border-slate-50,
    body.theme-dark .border-slate-100,
    body.theme-dark .border-slate-200 { border-color: #25344f !important; }
    body.theme-dark .border-gray-100,
    body.theme-dark .border-gray-200 { border-color: #2a3a57 !important; }
    body.theme-dark .border-white,
    body.theme-dark .border-white\\/70,
    body.theme-dark .border-white\\/80 { border-color: rgba(148, 163, 184, 0.26) !important; }
    body.theme-dark .border-purple-100,
    body.theme-dark .border-purple-200,
    body.theme-dark .border-violet-100,
    body.theme-dark .border-violet-200,
    body.theme-dark .border-indigo-100,
    body.theme-dark .border-indigo-200,
    body.theme-dark .border-blue-100,
    body.theme-dark .border-blue-200 { border-color: #445b82 !important; }
    body.theme-dark .border-sky-100,
    body.theme-dark .border-sky-200 { border-color: rgba(125, 211, 252, 0.35) !important; }
    body.theme-dark .border-amber-100,
    body.theme-dark .border-amber-200,
    body.theme-dark .border-orange-100,
    body.theme-dark .border-orange-200,
    body.theme-dark .border-yellow-100,
    body.theme-dark .border-yellow-200 { border-color: rgba(251, 191, 36, 0.34) !important; }
    body.theme-dark .border-red-100,
    body.theme-dark .border-red-200,
    body.theme-dark .border-rose-100,
    body.theme-dark .border-rose-200,
    body.theme-dark .border-pink-100,
    body.theme-dark .border-pink-200 { border-color: rgba(253, 164, 175, 0.34) !important; }
    body.theme-dark .border-emerald-100,
    body.theme-dark .border-emerald-200,
    body.theme-dark .border-green-100,
    body.theme-dark .border-green-200 { border-color: rgba(110, 231, 183, 0.34) !important; }
    body.theme-dark .hover\\:bg-gray-100:hover,
    body.theme-dark .hover\\:bg-gray-200:hover,
    body.theme-dark .hover\\:bg-slate-50:hover { background-color: #223552 !important; }
    body.theme-dark .hover\\:bg-red-100:hover,
    body.theme-dark .hover\\:bg-rose-100:hover { background-color: rgba(239, 68, 68, 0.26) !important; }
    body.theme-dark .hover\\:bg-orange-100:hover,
    body.theme-dark .hover\\:bg-amber-100:hover { background-color: rgba(245, 158, 11, 0.28) !important; }
    body.theme-dark .hover\\:text-slate-900:hover { color: #f8fafc !important; }
    body.theme-dark button.bg-white,
    body.theme-dark a.bg-white {
      background-color: #122544 !important;
      color: #e2e8f0 !important;
      border-color: #334866 !important;
    }
    body.theme-dark button.bg-white:hover,
    body.theme-dark a.bg-white:hover {
      background-color: #1a3258 !important;
      color: #f8fafc !important;
    }
    body.theme-dark .bg-white.text-slate-400,
    body.theme-dark .bg-white.text-slate-500,
    body.theme-dark .bg-white.text-slate-600,
    body.theme-dark .bg-white.text-slate-700 {
      color: #e2e8f0 !important;
    }
    body.theme-dark .bg-white .text-slate-400,
    body.theme-dark .bg-white .text-slate-500 { color: #cbd5e1 !important; }
    body.theme-dark .shadow-sm,
    body.theme-dark .shadow-lg,
    body.theme-dark .shadow-xl { box-shadow: 0 10px 28px rgba(2, 6, 23, 0.45) !important; }
    body.theme-dark input,
    body.theme-dark textarea,
    body.theme-dark select { color: #e2e8f0; background-color: #16243b !important; }
    body.theme-dark input::placeholder,
    body.theme-dark textarea::placeholder { color: #94a3b8; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    
    input[type=range] { -webkit-appearance: none; width: 100%; background: transparent; }
    input[type=range]::-webkit-slider-thumb { 
      -webkit-appearance: none; height: 32px; width: 32px; border-radius: 50%; background: #FFFFFF; cursor: pointer; margin-top: -12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3); transition: transform 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275); border: 4px solid rgba(255,255,255,0.8);
    }
    input[type=range]:active::-webkit-slider-thumb { transform: scale(1.3); background: #F4F7FE; }
    input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 8px; cursor: pointer; background: rgba(255, 255, 255, 0.3); border-radius: 10px; backdrop-filter: blur(4px); }

    .big-slider-container { position: relative; width: 100%; height: 60px; background: #F0F3FA; border-radius: 20px; overflow: hidden; box-shadow: inset 0 2px 6px rgba(0,0,0,0.05); }
    .big-slider-fill { position: absolute; top: 0; left: 0; height: 100%; background: linear-gradient(90deg, #EE5D50 0%, #FFB547 50%, #05CD99 100%); border-radius: 20px; transition: width 0.1s linear; }
    .big-slider-input { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; z-index: 20; }
    .slider-thumb-indicator { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 40px; height: 40px; background: white; border-radius: 50%; box-shadow: 0 4px 15px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; font-size: 20px; pointer-events: none; z-index: 10; transition: left 0.1s linear; }
    
    .card-shadow { box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); }
    .animate-slide-up { animation: slideUp 0.4s ease-out forwards; }
    .animate-slide-down { animation: slideDown 0.4s ease-out forwards; }
    .animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
    .animate-pop { animation: pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
    @keyframes successBounce { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.2); opacity: 1; } 75% { transform: scale(0.9); } 100% { transform: scale(1); } }
    .animate-success-bounce { animation: successBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
    @keyframes pop { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
    @keyframes slideUp { 0% { transform: translateY(20px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
    @keyframes slideDown { 0% { transform: translateY(-20px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
    @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
    @keyframes bounceSlight { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
    .animate-bounce-slight { animation: bounceSlight 2s infinite ease-in-out; }
    
    .tutorial-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100; pointer-events: auto; }
    .tutorial-card { position: fixed; z-index: 102; width: 300px; background: white; padding: 20px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); animation: pop 0.3s forwards; }
    .tutorial-arrow { position: absolute; width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; }
    .arrow-top { border-bottom: 10px solid white; top: -10px; left: 50%; transform: translateX(-50%); }
    .arrow-bottom { border-top: 10px solid white; bottom: -10px; left: 50%; transform: translateX(-50%); }

    .custom-scrollbar::-webkit-scrollbar { width: 6px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 10px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #CBD5E1; }

    .chart-glow { filter: drop-shadow(0 0 8px rgba(67, 24, 255, 0.15)); }
  `}</style>
);

export const SuccessOverlay = ({ title = "Fantástico!", message = "Você está indo muito bem!" }) => ( 
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
    <div className="bg-white rounded-[40px] p-10 flex flex-col items-center animate-pop shadow-2xl relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-green-400 rounded-full blur-3xl animate-pulse"></div>
      </div>
      <div className="w-28 h-28 bg-green-500 rounded-full flex items-center justify-center mb-6 text-white shadow-lg shadow-green-200 animate-success-bounce z-10">
        <Check size={64} strokeWidth={4} />
      </div>
      <h3 className="text-3xl font-semibold text-gray-800 mb-2 z-10">{title}</h3>
      <p className="text-gray-500 font-medium text-lg text-center z-10">{message}</p>
    </div>
  </div> 
);

export const BigEnergySlider = ({ value, onChange, onCommit, showLabel = true, label = 'Energia', labelHelp, scaleLabels }: any) => { 
  const numericValue = Number(value) || 0;
  const resolvedScaleLabels = Array.isArray(scaleLabels) && scaleLabels.length === 3
    ? scaleLabels
    : ['Baixa', 'Média', 'Alta'];
  const getMoodEmoji = (val: number) => { 
    if (val < 20) return "😫"; 
    if (val < 40) return "😕"; 
    if (val < 60) return "😐"; 
    if (val < 80) return "🙂"; 
    return "🤩"; 
  }; 
  return ( 
    <div className="w-full"> 
      {showLabel && (
        <div className="flex justify-between items-center mb-4">
          <span className="font-semibold text-gray-700 flex items-center gap-2">
            <BatteryCharging size={20} className="text-[#7a32fc]" />
            {labelHelp ? (
              <span className="relative group cursor-help" tabIndex={0} title={labelHelp} aria-label={`${label}: ${labelHelp}`}>
                {label}
                <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-56 rounded-2xl bg-slate-900 px-3 py-2 text-xs font-semibold leading-relaxed text-white shadow-xl group-hover:block group-focus:block">
                  {labelHelp}
                </span>
              </span>
            ) : (
              label
            )}
          </span>
          <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full shadow-sm">
            <span className="text-2xl">{getMoodEmoji(numericValue)}</span>
            <span className="text-xl font-semibold text-[#7a32fc]">{numericValue}%</span>
          </div>
        </div>
      )} 
      <div className="big-slider-container">
        <div className="big-slider-fill" style={{ width: `${numericValue}%` }}></div>
        <div className="slider-thumb-indicator" style={{ left: `${numericValue}%` }}>{getMoodEmoji(numericValue)}</div>
        <input type="range" min="0" max="100" value={numericValue} onChange={onChange} onMouseUp={onCommit} onTouchEnd={onCommit} className="big-slider-input" />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-2 font-semibold px-1"><span>{resolvedScaleLabels[0]}</span><span>{resolvedScaleLabels[1]}</span><span>{resolvedScaleLabels[2]}</span></div> 
    </div> 
  ); 
};


