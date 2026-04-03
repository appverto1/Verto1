import React from 'react';
import { BatteryCharging, BatteryFull, Ear, Users, Brain, Check, CheckCircle, Activity } from 'lucide-react';

export const ENERGY_TAGS = [
  { id: 'sensory', label: 'Sensorial', icon: <Ear size={18} />, color: 'bg-purple-100 text-purple-600 border-purple-200' },
  { id: 'social', label: 'Social', icon: <Users size={18} />, color: 'bg-blue-100 text-blue-600 border-blue-200' },
  { id: 'focus', label: 'Foco', icon: <Brain size={18} />, color: 'bg-orange-100 text-orange-600 border-orange-200' },
  { id: 'rest', label: 'Descanso', icon: <BatteryCharging size={18} />, color: 'bg-green-100 text-green-600 border-green-200' }
];

export const LogoVerto = ({ size = 64, className = "", showText = false }: { size?: number, className?: string, showText?: boolean }) => (
  <div className={`flex items-center gap-2 shrink-0 ${className}`}>
    <div style={{ width: size, height: size }} className="flex items-center justify-center">
      <img 
        src="https://lh3.googleusercontent.com/d/1XMJ_mW9MSwFFApVB6dxndkY_RLnDgoH-" 
        alt="Verto Logo" 
        className="w-full h-full object-contain"
        referrerPolicy="no-referrer"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent) {
            parent.className = `flex items-center justify-center bg-[#4318FF] rounded-2xl shadow-lg shadow-blue-500/20`;
            parent.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 0.6}" height="${size * 0.6}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-activity"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
          }
        }}
      />
    </div>
    {showText && (
      <span className="text-2xl font-logo font-bold tracking-tighter text-[#4318FF] lowercase" style={{ fontSize: size * 0.5 }}>verto</span>
    )}
  </div>
);

export const GlobalStyles = () => (
  <style>{`
    body { background-color: #F4F7FE; font-family: 'Inter', sans-serif; }
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

export const BigEnergySlider = ({ value, onChange, onCommit, showLabel = true }: any) => { 
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
          <span className="font-semibold text-gray-700 flex items-center gap-2"><BatteryCharging size={20} className="text-[#4318FF]" /> Energia</span>
          <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full shadow-sm">
            <span className="text-2xl">{getMoodEmoji(value)}</span>
            <span className="text-xl font-semibold text-[#4318FF]">{value}%</span>
          </div>
        </div>
      )} 
      <div className="big-slider-container">
        <div className="big-slider-fill" style={{ width: `${value}%` }}></div>
        <div className="slider-thumb-indicator" style={{ left: `${value}%` }}>{getMoodEmoji(value)}</div>
        <input type="range" min="0" max="100" value={value} onChange={onChange} onMouseUp={onCommit} onTouchEnd={onCommit} className="big-slider-input" />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-2 font-semibold px-1"><span>Baixa</span><span>Média</span><span>Alta</span></div> 
    </div> 
  ); 
};
