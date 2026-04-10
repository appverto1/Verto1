import Dexie, { Table } from 'dexie';
import CryptoJS from 'crypto-js';

// Chave mestra de desenvolvimento (Em produção, deve ser injetada via Secret)
const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY || 'verto-dev-secret-key';

export interface Patient {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  gender?: string;
  address?: string;
  diagnosis?: string;
  status: 'active' | 'inactive';
  therapist_id: string;
  clinic_id?: string;
  created_at: string;
  updated_at?: string;
  photo_url?: string;
}

export interface Note {
  id: string;
  patient_id: string;
  therapist_id: string;
  content: string;
  type: 'session' | 'observation' | 'evolution';
  created_at: string;
  updated_at?: string;
}

export interface HistoryEntry {
  id: string;
  patient_id: string;
  therapist_id: string;
  action: string;
  description: string;
  metadata?: any;
  created_at: string;
}

export interface Task {
  id: string;
  patient_id: string;
  therapist_id: string;
  title: string;
  description?: string;
  due_date?: string;
  status: 'pending' | 'completed' | 'cancelled';
  created_at: string;
}

export class VertoDatabase extends Dexie {
  patients!: Table<Patient>;
  notes!: Table<Note>;
  history!: Table<HistoryEntry>;
  tasks!: Table<Task>;

  constructor() {
    super('VertoDatabase');
    this.version(1).stores({
      patients: 'id, name, email, therapist_id, clinic_id, status',
      notes: 'id, patient_id, therapist_id, type, created_at',
      history: 'id, patient_id, therapist_id, created_at',
      tasks: 'id, patient_id, therapist_id, status, due_date'
    });

    // Middleware de Criptografia Transparente (HIPAA/LGPD Compliance)
    this.use({
      stack: "dbcore",
      name: "EncryptionMiddleware",
      create(downlevelDatabase) {
        return {
          ...downlevelDatabase,
          table(tableName) {
            const table = downlevelDatabase.table(tableName);
            return {
              ...table,
              mutate: async (req) => {
                if (req.type === 'add' || req.type === 'put') {
                  req.values = req.values.map(obj => {
                    const encrypted = { ...obj };
                    // Criptografando campos sensíveis (PHI)
                    if (obj.name) encrypted.name = CryptoJS.AES.encrypt(obj.name, ENCRYPTION_KEY).toString();
                    if ('content' in obj && obj.content) {
                      encrypted.content = CryptoJS.AES.encrypt(obj.content, ENCRYPTION_KEY).toString();
                    }
                    if ('description' in obj && obj.description) {
                      encrypted.description = CryptoJS.AES.encrypt(obj.description, ENCRYPTION_KEY).toString();
                    }
                    if ('diagnosis' in obj && obj.diagnosis) {
                      encrypted.diagnosis = CryptoJS.AES.encrypt(obj.diagnosis, ENCRYPTION_KEY).toString();
                    }
                    return encrypted;
                  });
                }
                return table.mutate(req);
              },
              get: async (req) => {
                const res = await table.get(req);
                if (res) {
                  try {
                    if (res.name) {
                      const bytes = CryptoJS.AES.decrypt(res.name, ENCRYPTION_KEY);
                      res.name = bytes.toString(CryptoJS.enc.Utf8);
                    }
                    if ('content' in res && res.content) {
                      const bytes = CryptoJS.AES.decrypt(res.content, ENCRYPTION_KEY);
                      res.content = bytes.toString(CryptoJS.enc.Utf8);
                    }
                    if ('description' in res && res.description) {
                      const bytes = CryptoJS.AES.decrypt(res.description, ENCRYPTION_KEY);
                      res.description = bytes.toString(CryptoJS.enc.Utf8);
                    }
                    if ('diagnosis' in res && res.diagnosis) {
                      const bytes = CryptoJS.AES.decrypt(res.diagnosis, ENCRYPTION_KEY);
                      res.diagnosis = bytes.toString(CryptoJS.enc.Utf8);
                    }
                  } catch (e) {
                    console.error("Falha ao decriptografar registro. Verifique a chave.");
                  }
                }
                return res;
              }
            };
          }
        };
      }
    });
  }
}

export const db = new VertoDatabase();