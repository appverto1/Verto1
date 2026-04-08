import React, { useState } from 'react';
import { 
  Calendar, 
  Clock, 
  User, 
  Plus, 
  Trash2, 
  Edit2,
  X,
  AlertCircle, 
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface Reservation {
  id: string;
  roomId: string;
  roomName: string;
  professionalId: string;
  professionalName: string;
  patientName?: string;
  date: string;
  startTime: string;
  endTime: string;
  status?: string;
}

export interface Room {
  id: string;
  name: string;
  specialties: string[];
}

export const RoomReservationTable = ({ 
  rooms, 
  reservations, 
  selectedDate, 
  user, 
  onDeleteReservation 
}: { 
  rooms: Room[], 
  reservations: Reservation[], 
  selectedDate: string, 
  user: any, 
  onDeleteReservation: (id: string) => void 
}) => {
  const timeSlots = Array.from({ length: 14 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`);

  return (
    <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50">
              <th className="p-4 text-left text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 w-32">Horário</th>
              {rooms.map(room => (
                <th key={room.id} className="p-4 text-left border-b border-slate-100 min-w-[200px]">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-widest">{room.name}</span>
                    <span className="text-[10px] font-medium text-slate-400 normal-case">{room.specialties.join(', ')}</span>
                  </div>
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

                  const isPending = reservation?.status === 'pending';
                  const isConfirmed = reservation?.status === 'confirmed';

                  return (
                    <td key={room.id} className="p-2 border-b border-slate-50 relative h-20">
                      {reservation ? (
                        <div className={`h-full w-full rounded-2xl p-3 flex flex-col justify-between transition-all ${
                          reservation.professionalId === user.id 
                            ? isPending 
                              ? 'bg-blue-50/40 border border-dashed border-blue-200 opacity-60' 
                              : 'bg-blue-50 border border-blue-100' 
                            : isPending
                              ? 'bg-slate-50/40 border border-dashed border-slate-200 opacity-60'
                              : 'bg-slate-50 border border-slate-100'
                        }`}>
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                              {reservation.startTime} - {reservation.endTime}
                            </p>
                            <p className={`text-xs font-bold text-slate-900 truncate ${isPending ? 'italic' : ''}`}>
                              {reservation.professionalName} {reservation.patientName ? `- ${reservation.patientName}` : ''}
                            </p>
                          </div>
                          {(reservation.professionalId === user.id || user.role === 'coordinator') && (
                            <button 
                              onClick={() => onDeleteReservation(reservation.id)}
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
  );
};

export function RoomReservation({ user, rooms, reservations, onDeleteReservation, onBack }: { 
  user: any, 
  rooms: Room[], 
  reservations: Reservation[], 
  onDeleteReservation: (id: string) => void,
  onBack: () => void
}) {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const handleDeleteReservation = (id: string) => {
    onDeleteReservation(id);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-all">
            <ChevronLeft size={24} className="text-slate-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Reserva de Salas</h1>
            <p className="text-slate-500 text-sm">Gerencie o uso das salas da clínica.</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-semibold text-slate-700"
          />
        </div>
      </div>

      <RoomReservationTable 
        rooms={rooms}
        reservations={reservations}
        selectedDate={selectedDate}
        user={user}
        onDeleteReservation={handleDeleteReservation}
      />
    </div>
  );
}
