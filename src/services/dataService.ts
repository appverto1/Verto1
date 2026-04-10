import { getSupabase } from '../lib/supabase';
import { db, generateId } from './localDb';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface DataErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
  }
}

async function handleDataError(error: unknown, operationType: OperationType, path: string | null) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  
  const errInfo: DataErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.id,
      email: user?.email,
    },
    operationType,
    path
  }
  console.error('Data Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function getAuthHeaders() {
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const headers: any = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// Helper to handle offline-first saving
async function saveOfflineFirst(id: string, data: any, type: any, endpoint: string, method: 'POST' | 'PATCH' = 'POST') {
  // 1. Save locally first
  await db.records.put({
    id,
    data,
    type,
    sync_status: 'pending',
    last_updated: Date.now(),
    method,
    endpoint
  });

  // 2. Try to sync with server
  try {
    const response = await fetch(endpoint, {
      method,
      headers: await getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify(data)
    });

    if (response.ok) {
      const result = await response.json();
      // 3. Mark as synced if successful
      await db.records.update(id, { sync_status: 'synced' });
      return result;
    }
  } catch (error) {
    console.log(`Working offline: ${type} saved locally.`);
  }

  // 4. Return local data if offline or error
  return { success: true, data, offline: true };
}

export const dataService = {
  async saveActivityLog(log: any) {
    const id = log.id || generateId();
    const data = { ...log, id, timestamp: log.timestamp || new Date().toISOString() };
    return await saveOfflineFirst(id, data, 'log', '/api/logs');
  },

  async getPatients() {
    try {
      const response = await fetch('/api/patients', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        // Update local cache
        for (const p of result.data) {
          await db.records.put({ id: p.id, data: p, type: 'patient', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: '/api/patients' });
        }
        return result;
      }
    } catch (error) {
      console.log('Fetching patients from local storage...');
    }
    const local = await db.records.where('type').equals('patient').toArray();
    return { success: true, data: local.map(r => r.data) };
  },

  async savePatient(patient: any) {
    const id = patient.id || generateId();
    const data = { ...patient, id, created_at: patient.created_at || new Date().toISOString() };
    return await saveOfflineFirst(id, data, 'patient', '/api/patients');
  },

  async createPatientUser(email: string, name: string) {
    try {
      const response = await fetch('/api/patients/create-user', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ email, name })
      });
      if (response.ok) {
        return await response.json();
      }
      return { success: false, error: 'Failed to create patient user' };
    } catch (error) {
      console.error('Error creating patient user:', error);
      return { success: false, error: String(error) };
    }
  },

  async updatePatient(id: string, updates: any) {
    return await saveOfflineFirst(id, updates, 'patient', `/api/patients/${id}`, 'PATCH');
  },

  async getActivityLogs() {
    try {
      const response = await fetch('/api/logs', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        for (const l of result.data) {
          await db.records.put({ id: l.id, data: l, type: 'log', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: '/api/logs' });
        }
        return result;
      }
    } catch (error) {
      console.log('Fetching logs from local storage...');
    }
    const local = await db.records.where('type').equals('log').toArray();
    return { success: true, data: local.map(r => r.data) };
  },

  async getNotes(patientId: string) {
    try {
      const response = await fetch(`/api/notes/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        for (const n of result.data) {
          await db.records.put({ id: n.id, data: n, type: 'note', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: '/api/notes' });
        }
        return result;
      }
    } catch (error) {
      console.log('Fetching notes from local storage...');
    }
    const local = await db.records.where('type').equals('note').toArray();
    return { success: true, data: local.filter(r => r.data.patient_id === patientId).map(r => r.data) };
  },

  async getNotesByEmail(email: string) {
    try {
      const response = await fetch(`/api/notes/email/${email}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching notes by email from local storage...');
    }
    const local = await db.records.where('type').equals('note').toArray();
    return { success: true, data: local.filter(r => r.data.patient_email === email).map(r => r.data) };
  },

  async addNote(note: any) {
    const id = note.id || generateId();
    const data = { ...note, id, created_at: note.created_at || new Date().toISOString() };
    return await saveOfflineFirst(id, data, 'note', '/api/notes');
  },

  async getHistory(patientId: string) {
    try {
      const response = await fetch(`/api/history/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        for (const h of result.data) {
          await db.records.put({ id: h.id, data: h, type: 'history', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: '/api/history' });
        }
        return result;
      }
    } catch (error) {
      console.log('Fetching history from local storage...');
    }
    const local = await db.records.where('type').equals('history').toArray();
    return { success: true, data: local.filter(r => r.data.patient_id === patientId).map(r => r.data) };
  },

  async getHistoryByEmail(email: string) {
    try {
      const response = await fetch(`/api/history/email/${email}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching history by email from local storage...');
    }
    const local = await db.records.where('type').equals('history').toArray();
    return { success: true, data: local.filter(r => r.data.patient_email === email).map(r => r.data) };
  },

  async addHistoryItem(item: any) {
    const id = item.id || generateId();
    const data = { ...item, id, created_at: item.created_at || new Date().toISOString() };
    return await saveOfflineFirst(id, data, 'history', '/api/history');
  },

  async getTasks(patientId: string) {
    try {
      const response = await fetch(`/api/tasks/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        for (const t of result.data) {
          await db.records.put({ id: t.id, data: t, type: 'task', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: '/api/tasks' });
        }
        return result;
      }
    } catch (error) {
      console.log('Fetching tasks from local storage...');
    }
    const local = await db.records.where('type').equals('task').toArray();
    return { success: true, data: local.filter(r => r.data.patient_id === patientId).map(r => r.data) };
  },

  async getTasksByEmail(email: string) {
    try {
      const response = await fetch(`/api/tasks/email/${email}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching tasks by email from local storage...');
    }
    const local = await db.records.where('type').equals('task').toArray();
    return { success: true, data: local.filter(r => r.data.patient_email === email).map(r => r.data) };
  },

  async addTask(task: any) {
    const id = task.id || generateId();
    const data = { ...task, id, created_at: task.created_at || new Date().toISOString() };
    return await saveOfflineFirst(id, data, 'task', '/api/tasks');
  },

  async saveUserProfile(userId: string, profile: any) {
    const data = { ...profile, updated_at: profile.updated_at || new Date().toISOString() };
    return await saveOfflineFirst(userId, data, 'profile', `/api/profile/${userId}`);
  },

  async getUserProfile(userId: string) {
    try {
      const response = await fetch(`/api/profile/${userId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        await db.records.put({ id: userId, data: result, type: 'profile', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: `/api/profile/${userId}` });
        return result;
      }
    } catch (error) {
      console.log('Fetching profile from local storage...');
    }
    const local = await db.records.get(userId);
    return local ? local.data : { success: false };
  },

  async uploadFile(bucket: string, path: string, file: File) {
    // Files are hard to sync offline without a complex worker, 
    // so we'll keep this online-only for now but handle the error.
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

      return { success: true, url: publicUrl };
    } catch (error: any) {
      console.error('Error uploading file:', error.message);
      return { success: false, error: error.message };
    }
  },

  async getClinicMembers() {
    try {
      const response = await fetch('/api/clinic/members', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        return await response.json();
      }
      return { success: false, error: 'Failed to fetch clinic members' };
    } catch (error) {
      console.error('Error fetching clinic members:', error);
      return { success: false, error: String(error) };
    }
  },

  async assignClinicRole(email: string, role: string) {
    try {
      const response = await fetch('/api/clinic/assign-role', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ email, role })
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json();
      return { success: false, error: err.error || 'Failed to assign role' };
    } catch (error) {
      console.error('Error assigning clinic role:', error);
      return { success: false, error: String(error) };
    }
  },
  
  async inviteToClinic(email: string, role: string) {
    try {
      const response = await fetch('/api/clinic/invite', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ email, role })
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json();
      return { success: false, error: err.error || 'Failed to send invitation' };
    } catch (error) {
      console.error('Error inviting to clinic:', error);
      return { success: false, error: String(error) };
    }
  },

  async getInvitations() {
    try {
      const response = await fetch('/api/clinic/invitations', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        return await response.json();
      }
      return { success: false, error: 'Failed to fetch invitations' };
    } catch (error) {
      console.error('Error fetching invitations:', error);
      return { success: false, error: String(error) };
    }
  },

  async updateMemberRole(memberId: string, role: string) {
    try {
      const response = await fetch(`/api/clinic/members/${memberId}/role`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ role })
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json();
      return { success: false, error: err.error || 'Failed to update role' };
    } catch (error) {
      console.error('Error updating member role:', error);
      return { success: false, error: String(error) };
    }
  },

  async acceptInvitation(invitationId: string) {
    try {
      const response = await fetch('/api/clinic/accept-invite', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ invitationId })
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json();
      return { success: false, error: err.error || 'Failed to accept invitation' };
    } catch (error) {
      console.error('Error accepting invitation:', error);
      return { success: false, error: String(error) };
    }
  }
};
