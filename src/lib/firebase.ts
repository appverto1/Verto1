import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Fetch the Firebase configuration from the server to keep it out of the bundle
const fetchConfig = async () => {
  try {
    const response = await fetch('/api/config');
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch Firebase config:', error);
    return null;
  }
};

let firebaseApp: any = null;
let firebaseAuth: any = null;

export const getFirebaseAuth = async () => {
  if (firebaseAuth) return firebaseAuth;
  
  if (getApps().length > 0) {
    firebaseApp = getApp();
  } else {
    const config = await fetchConfig();
    if (config) {
      firebaseApp = initializeApp(config);
    }
  }
  
  if (firebaseApp) {
    firebaseAuth = getAuth(firebaseApp);
  }
  return firebaseAuth;
};

// Placeholder for db - no Firestore on the client
export const db = null;
// Legacy export for compatibility during transition
export const auth = {} as any; 
