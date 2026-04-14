import Dexie, { Table } from 'dexie';
import { getSupabase } from '../lib/supabase';

// Define the structure of our records
export interface OfflineRecord {
  id: string;
  data: any;
  type: 'patient' | 'note' | 'history' | 'log' | 'profile' | 'task';
  sync_status: 'synced' | 'pending';
  last_updated: number;
  method: 'POST' | 'PATCH' | 'DELETE';
  endpoint: string;
}

export class MyDatabase extends Dexie {
  // Tables
  records!: Table<OfflineRecord>;

  constructor() {
    super('OfflineVertoDB');
    this.version(1).stores({
      records: 'id, type, sync_status, last_updated' // Primary key and indexes
    });
  }
}

export const db = new MyDatabase();

// Helper to generate a unique ID
export const generateId = () => crypto.randomUUID();

let isSyncing = false;
let lastSyncAttempt = 0;
const SYNC_COOLDOWN = 5000; // 5 seconds between sync attempts

// Sync function to push pending changes to the server
export const syncOfflineData = async () => {
  const now = Date.now();
  if (!navigator.onLine || isSyncing || (now - lastSyncAttempt < SYNC_COOLDOWN)) return;
  
  isSyncing = true;
  lastSyncAttempt = now;
  console.log('Starting offline sync...');

  try {
    const pending = await db.records.where('sync_status').equals('pending').toArray();
    
    if (pending.length === 0) {
      console.log('No pending records to sync.');
      return;
    }

    // Sort by last_updated to ensure chronological order
    pending.sort((a, b) => a.last_updated - b.last_updated);

    for (const record of pending) {
      let success = false;
      let retries = 2;
      let delay = 1000;

      while (retries >= 0 && !success) {
        try {
          const supabase = await getSupabase();
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;

          const response = await fetch(record.endpoint, {
            method: record.method,
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': token ? `Bearer ${token}` : ''
            },
            credentials: 'include',
            body: JSON.stringify(record.data)
          });

          if (response.ok) {
            await db.records.update(record.id, { sync_status: 'synced' });
            console.log(`Synced ${record.type}: ${record.id}`);
            success = true;
          } else {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            
            // If it's a 429, wait and retry if we have retries left
            if (response.status === 429 && retries > 0) {
              console.warn(`Rate limit hit during sync of ${record.type}. Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2;
              retries--;
              continue;
            }

            console.error(`Server rejected ${record.type} sync:`, errorData);
            
            // If it's a 404 or 400, it might be invalid data, mark as synced to stop looping
            if (response.status === 404 || response.status === 400) {
              console.warn(`Marking ${record.type} ${record.id} as "synced" (failed) to prevent retry loop.`);
              await db.records.update(record.id, { sync_status: 'synced' }); 
              success = true; // Stop retrying this record
            } else {
              // For other errors (500, etc), stop the whole sync process for now
              throw new Error(`Server error ${response.status}`);
            }
          }
        } catch (error: any) {
          if (retries > 0 && (error.name === 'TypeError' || error.message === 'Failed to fetch')) {
            console.warn(`Network error syncing ${record.type}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
            retries--;
            continue;
          }
          console.error(`Failed to sync ${record.type}:`, error);
          isSyncing = false;
          return; // Stop the whole sync process on persistent error
        }
      }
    }
  } finally {
    isSyncing = false;
    console.log('Offline sync finished.');
  }
};
