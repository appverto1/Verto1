import React, { useState } from 'react';
import { 
  Calendar, 
  Clock, 
  User, 
  Plus, 
  Trash2, 
  AlertCircle, 
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DoorOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Reservation {
  id: string;
  roomId: string;
  roomName: string;
  professionalId: string;
  professionalName: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface Room {
  id: string;
  name: string;
}

export function RoomReservation({ user }: { user: any }) {
  const [reservations, setReservations] = useState<Reservation[]>([
    {
      id: '1',
      roomId: 'room1',
      roomName: 'Sala 01 - Kids',
      professionalId: 'prof1',
      professionalName: 'Dra. Raísa',
      date: new Date().toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '10:00'
    }
  ]);

  const [rooms] = useState<Room[]>([
    { id: 'room1', name: 'Sala 01 - Kids' },
    { id: 'room2', name: 'Sala 02 - Adulto' },
    { id: 'room3', name: 'Sala 03 - Avaliação' },
    { id: 'room4', name: 'Sala 04 - TO' },
  ]);

  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newReservation, setNewReservation] = useState({
    roomId: '',
    startTime: '',
    endTime: ''
  });
  const [error, setError] = useState<string | null>(null);

  const handleAddReservation = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newReservation.roomId || !newReservation.startTime || !newReservation.endTime) {
      setError('Preencha todos os campos');
      return;
    }

    // Check for conflicts
    const hasConflict = reservations.some(res => 
      res.date === selectedDate && 
      res.roomId === newReservation.roomId && 
      ((newReservation.startTime >= res.startTime && newReservation.startTime < res.endTime) ||
       (newReservation.endTime > res.startTime && newReservation.endTime <= res.endTime))
    );

    if (hasConflict) {
      setError('Esta sala já está reservada para este horário');
      return;
    }

    const reservation: Reservation = {
      id: Date.now().toString(),
      roomId: newReservation.roomId,
      roomName: rooms.find(r => r.id === newReservation.roomId)?.name || '',
      professionalId: user.id,
      professionalName: user.name,
      date: selectedDate,
      startTime: newReservation.startTime,
      endTime: newReservation.endTime
    };

    setReservations([...reservations, reservation]);
    setIsModalOpen(false);
    setNewReservation({ roomId: '', startTime: '', endTime: '' });
  };

  const handleDeleteReservation = (id: string) => {
    const reservation = reservations.find(r => r.id === id);
    if (reservation?.professionalId !== user.id && user.role !== 'coordinator') {
      alert('Você só pode cancelar suas próprias reservas');
      return;
    }
    setReservations(reservations.filter(r => r.id !== id));
  };

  const timeSlots = Array.from({ length: 13 }, (_, i) => `${(i + 8).toString().padStart(2, '0')}:00`);

  return (
    <div className="p-6 max-w-6xl mx-auto font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Reserva de Salas</h1>
          <p className="text-slate-500 text-sm">Gerencie o uso das salas da clínica.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
          />
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-[#4318FF] text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            <Plus size={18} />
            Nova Reserva
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50">
                <th className="p-4 text-left text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 w-32">Horário</th>
                {rooms.map(room => (
                  <th key={room.id} className="p-4 text-left text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 min-w-[200px]">
                    {room.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeSlots.map(time => (
                <tr key={time} className="group">
                  <td className="p-4 text-sm font-bold text-slate-500 border-b border-slate-50 bg-slate-50/30">
                    {time}
                  </td>
                  {rooms.map(room => {
                    const reservation = reservations.find(r => 
                      r.date === selectedDate && 
                      r.roomId === room.id && 
                      time >= r.startTime && time < r.endTime
                    );

                    return (
                      <td key={room.id} className="p-2 border-b border-slate-50 relative h-20">
                        {reservation ? (
                          <div className={`h-full w-full rounded-2xl p-3 flex flex-col justify-between transition-all ${reservation.professionalId === user.id ? 'bg-blue-50 border border-blue-100' : 'bg-slate-50 border border-slate-100'}`}>
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                                {reservation.startTime} - {reservation.endTime}
                              </p>
                              <p className="text-xs font-bold text-slate-900 truncate">
                                {reservation.professionalName}
                              </p>
                            </div>
                            {(reservation.professionalId === user.id || user.role === 'coordinator') && (
                              <button 
                                onClick={() => handleDeleteReservation(reservation.id)}
                                className="absolute top-2 right-2 p-1.5 text-slate-300 hover:text-red-500 hover:bg-white rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="h-full w-full rounded-2xl border border-dashed border-slate-100 group-hover:border-blue-200 transition-all"></div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-[32px] shadow-2xl p-8"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                    <DoorOpen size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Nova Reserva</h2>
                    <p className="text-slate-500 text-xs font-medium">Selecione a sala e o horário</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-all"
                >
                  <ChevronLeft size={20} />
                </button>
              </div>

              <form onSubmit={handleAddReservation} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Sala</label>
                  <select 
                    value={newReservation.roomId}
                    onChange={(e) => setNewReservation({...newReservation, roomId: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                    required
                  >
                    <option value="">Selecione uma sala</option>
                    {rooms.map(room => (
                      <option key={room.id} value={room.id}>{room.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Início</label>
                    <input 
                      type="time" 
                      value={newReservation.startTime}
                      onChange={(e) => setNewReservation({...newReservation, startTime: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Fim</label>
                    <input 
                      type="time" 
                      value={newReservation.endTime}
                      onChange={(e) => setNewReservation({...newReservation, endTime: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-xs flex items-center gap-2 animate-shake">
                    <AlertCircle size={16} />
                    {error}
                  </div>
                )}

                <button 
                  type="submit"
                  className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
                >
                  Confirmar Reserva
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
