import React, { useState } from 'react';
import { ChevronLeft, Filter, ChevronDown, Search, User, Activity, Brain, Phone, MessageCircle, ChevronRight } from 'lucide-react';

export const PatientRegistry = ({ patients, clinicalRecords, onBack, onSelectPatient, userRole }: any) => { 
  const [filterName, setFilterName] = useState(""); 
  const [filterAge, setFilterAge] = useState(""); 
  const [filterType, setFilterType] = useState(""); 
  const [filterApproach, setFilterApproach] = useState(""); 
  const [showFilters, setShowFilters] = useState(false);
  
  const filteredPatients = patients.filter((p: any) => { 
    const matchName = p.name.toLowerCase().includes(filterName.toLowerCase()); 
    let matchAge = true; 
    if (filterAge === 'child') matchAge = p.age <= 12; 
    else if (filterAge === 'teen') matchAge = p.age > 12 && p.age <= 18; 
    else if (filterAge === 'adult') matchAge = p.age > 18 && p.age < 60; 
    else if (filterAge === 'senior') matchAge = p.age >= 60; 
    const matchType = filterType ? (p.type === filterType) : true; 
    const matchApproach = filterApproach ? (p.approach === filterApproach) : true; 
    return matchName && matchAge && matchType && matchApproach; 
  }); 

  const getPatientCategory = (p: any) => {
    const clinicalRecord = clinicalRecords?.find((r: any) => r.patientId === p.id);
    if (clinicalRecord?.anamnesisData?.formType) {
        return clinicalRecord.anamnesisData.formType === 'child' ? 'Criança' : 'Adulto';
    }
    return (p.age !== undefined && p.age <= 12) ? 'Criança' : 'Adulto';
  };

  return ( 
    <div className="min-h-screen bg-gray-50 flex flex-col"> 
      <div className="bg-white px-6 py-6 shadow-sm mb-6 flex items-center gap-4"> 
        <button onClick={onBack} className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full"><ChevronLeft size={24}/></button> 
        <h1 className="text-xl font-bold text-gray-800 tracking-tight">
          {userRole === 'receptionist' ? 'Cadastro de Pacientes' : 'Meus Pacientes'} ({filteredPatients.length})
        </h1> 
      </div> 
      <div className="px-6 flex-1 w-full max-w-5xl mx-auto"> 
        <div className="bg-white p-4 rounded-[24px] shadow-sm border border-gray-100 mb-6 animate-slide-up"> 
          <button onClick={() => setShowFilters(!showFilters)} className="w-full flex items-center justify-between text-[#4318FF]"> 
            <div className="flex items-center gap-2">
              <Filter size={18} /> 
              <h3 className="font-bold text-xs uppercase tracking-wider">Filtros de Busca</h3> 
            </div>
            <ChevronDown size={20} className={`text-gray-300 transition-transform ${showFilters ? 'rotate-180 text-[#4318FF]' : ''}`} />
          </button> 
          
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-50 animate-fade-in"> 
              <div className="relative"> 
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} /> 
                <input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 pl-9 text-sm outline-none focus:border-[#4318FF]" placeholder="Buscar por nome..." value={filterName} onChange={(e) => setFilterName(e.target.value)} /> 
              </div> 
              <div> 
                <select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#4318FF]" value={filterAge} onChange={(e) => setFilterAge(e.target.value)}> 
                  <option value="">Faixa Etária (Todas)</option> 
                  <option value="child">0 a 12 anos</option> 
                  <option value="teen">13 a 18 anos</option> 
                  <option value="adult">19 a 59 anos</option> 
                  <option value="senior">60 anos ou mais</option> 
                </select> 
              </div> 
              <div> 
                <select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#4318FF]" value={filterType} onChange={(e) => setFilterType(e.target.value)}> 
                  <option value="">Tipo de Terapia (Todos)</option> 
                  <option value="conventional">Convencional</option> 
                  <option value="neurodevelopment">Neurodesenvolvimento</option> 
                  <option value="occupational">Terapia Ocupacional</option> 
                </select> 
              </div> 
              <div> 
                <select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#4318FF]" value={filterApproach} onChange={(e) => setFilterApproach(e.target.value)}> 
                  <option value="">Abordagem (Todas)</option> 
                  <option value="TCC">TCC</option> 
                  <option value="ABA">ABA</option> 
                  <option value="Integração Sensorial">Integração Sensorial</option> 
                  <option value="Psicanálise">Psicanálise</option> 
                  <option value="TO">TO</option> 
                </select> 
              </div> 
            </div> 
          )}
        </div> 
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up"> 
          {filteredPatients.length > 0 ? ( 
            filteredPatients.map((p: any) => {
              const category = getPatientCategory(p);
              return ( 
                <div key={p.id} onClick={() => onSelectPatient(p.id)} className={`bg-white p-5 rounded-[24px] shadow-sm border transition-all cursor-pointer group relative overflow-hidden ${category === 'Criança' ? 'border-pink-100 hover:border-pink-300 hover:shadow-pink-100' : 'border-indigo-100 hover:border-indigo-300 hover:shadow-indigo-100'}`}> 
                  <div className={`absolute top-0 right-0 w-16 h-16 rounded-bl-full opacity-10 transition-transform group-hover:scale-110 ${category === 'Criança' ? 'bg-pink-500' : 'bg-indigo-500'}`}></div> 
                  <div className="flex items-center gap-4 mb-3"> 
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg text-white ${category === 'Criança' ? 'bg-pink-400' : 'bg-indigo-400'}`}> {p.name.charAt(0)} </div> 
                    <div> 
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-800 text-lg tracking-tight">{p.name}</h3> 
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${category === 'Criança' ? 'bg-pink-100 text-pink-500' : 'bg-indigo-50 text-indigo-500'}`}>
                           {category === 'Criança' ? 'Criança' : 'Adulto'}
                        </span>
                        {p.status === 'delinquent' && (
                          <span className="bg-red-50 text-red-500 text-[8px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest border border-red-100">Inadimplente</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 font-medium">{p.age ? `${p.age} anos` : 'Idade N/A'}</p> 
                    </div> 
                  </div> 
                  <div className="space-y-2 mb-3"> 
                    <div className="flex items-center gap-2 text-xs text-gray-600"> <Activity size={14} className="text-gray-400"/> <span className="font-bold">{p.diagnosis || 'Sem diagnóstico'}</span> </div> 
                    <div className="flex items-center gap-2 text-xs text-gray-600"> <Brain size={14} className="text-gray-400"/> <span>{p.approach || 'Abordagem N/A'}</span> </div> 
                    <div className="flex items-center gap-2 text-xs text-gray-600"> <Phone size={14} className="text-gray-400"/> <span>{p.phone}</span> </div> 
                  </div> 
                  <div className="mt-4 pt-3 border-t border-gray-50 flex justify-between items-center">
                    <a 
                      href={`https://wa.me/${p.phone.replace(/\D/g, '')}`} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="p-2 bg-green-50 text-green-600 rounded-xl hover:bg-green-100 transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-tight"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MessageCircle size={16} /> WhatsApp
                    </a>
                    {userRole !== 'receptionist' && (
                      <span className="text-xs font-bold text-[#4318FF] flex items-center gap-1 group-hover:gap-2 transition-all">Ver Prontuário <ChevronRight size={14}/></span>
                    )}
                  </div> 
                </div> 
              );
            }) 
          ) : ( 
            <div className="col-span-full text-center py-10"> 
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-400"> <User size={32} /> </div> 
              <p className="text-gray-500 font-bold">Nenhum paciente encontrado.</p> 
              <p className="text-xs text-gray-400">Tente ajustar os filtros.</p> 
            </div> 
          )} 
        </div> 
      </div> 
    </div> 
  ); 
};
