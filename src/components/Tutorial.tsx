import React, { useState, useCallback, useLayoutEffect } from 'react';
import { X, ChevronRight } from 'lucide-react';

export const TutorialOverlay = ({ steps, onClose, currentStepIndex, onStepChange }: any) => { 
  const [coords, setCoords] = useState<any>(null); 
  const updatePosition = useCallback(() => { 
    const step = steps[currentStepIndex]; 
    if (!step) return; 
    const element = document.getElementById(step.targetId); 
    if (element) { 
      const rect = element.getBoundingClientRect(); 
      setCoords({ top: rect.top, left: rect.left, width: rect.width, height: rect.height, placement: step.placement || 'bottom' }); 
      element.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
    } 
  }, [currentStepIndex, steps]); 

  useLayoutEffect(() => { 
    updatePosition(); 
    const timer = setTimeout(updatePosition, 100); 
    window.addEventListener('resize', updatePosition); 
    return () => { 
      window.removeEventListener('resize', updatePosition); 
      clearTimeout(timer); 
    } 
  }, [updatePosition, currentStepIndex]); 

  if (!coords) return null; 
  const step = steps[currentStepIndex]; 
  const isLast = currentStepIndex === steps.length - 1; 
  let cardStyle: any = {}; 
  if (step.placement === 'bottom') cardStyle = { top: coords.top + coords.height + 20, left: coords.left + coords.width/2 - 150 }; 
  else if (step.placement === 'top') cardStyle = { top: coords.top - 200, left: coords.left + coords.width/2 - 150 }; 
  if (cardStyle.left < 10) cardStyle.left = 10; 
  if (window.innerWidth - cardStyle.left < 310) cardStyle.left = window.innerWidth - 320; 
  if (cardStyle.top < 10) cardStyle.top = 10; 

  return ( 
    <div className="fixed inset-0 z-[100] overflow-hidden"> 
      <div style={{ position: 'absolute', top: coords.top - 5, left: coords.left - 5, width: coords.width + 10, height: coords.height + 10, borderRadius: '16px', boxShadow: '0 0 0 4px #4318FF, 0 0 0 9999px rgba(0,0,0,0.6)', zIndex: 101, pointerEvents: 'none', transition: 'all 0.4s ease' }}></div> 
      <div className="tutorial-card" style={cardStyle}> 
        {step.placement === 'bottom' && <div className="tutorial-arrow arrow-top"></div>} 
        {step.placement === 'top' && <div className="tutorial-arrow arrow-bottom"></div>} 
        <div className="flex justify-between items-center mb-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Passo {currentStepIndex + 1} de {steps.length}</span>
          <button onClick={onClose}><X size={16} className="text-gray-400 hover:text-gray-600"/></button>
        </div> 
        <h3 className="font-bold text-gray-800 text-lg mb-1">{step.title}</h3>
        <p className="text-gray-600 text-sm mb-4 leading-relaxed">{step.content}</p> 
        <div className="flex justify-between items-center"> 
          {currentStepIndex > 0 ? (<button onClick={() => onStepChange(currentStepIndex - 1)} className="text-xs font-bold text-gray-400 hover:text-[#4318FF]">Voltar</button>) : <div></div>} 
          <button onClick={() => isLast ? onClose() : onStepChange(currentStepIndex + 1)} className="bg-[#4318FF] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-[#4318FF]/30 hover:opacity-90 transition-all flex items-center gap-2">
            {isLast ? 'Concluir' : 'Próximo'} <ChevronRight size={14}/>
          </button> 
        </div> 
      </div> 
    </div> 
  ); 
};
