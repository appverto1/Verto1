import Dexie, { Table } from 'dexie';

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

// Sync function to push pending changes to the server
export const syncOfflineData = async () => {
  if (!navigator.onLine || isSyncing) return;
  
  isSyncing = true;
  console.log('Starting offline sync...');

  try {
    const pending = await db.records.where('sync_status').equals('pending').toArray();
    
    // Sort by last_updated to ensure chronological order
    pending.sort((a, b) => a.last_updated - b.last_updated);

    for (const record of pending) {
      try {
        const response = await fetch(record.endpoint, {
          method: record.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record.data)
        });

        if (response.ok) {
          await db.records.update(record.id, { sync_status: 'synced' });
          console.log(`Synced ${record.type}: ${record.id}`);
        } else {
          const errorData = await response.json();
          console.error(`Server rejected ${record.type} sync:`, errorData);
          // If it's a 404 or something that won't recover, we might want to handle it,
          // but for now we just keep it as pending to retry later.
        }
      } catch (error) {
        console.error(`Failed to sync ${record.type}:`, error);
        break; // Stop syncing if we hit a network error during the loop
      }
    }
  } finally {
    isSyncing = false;
    console.log('Offline sync finished.');
  }
};
