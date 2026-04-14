
import { getSupabase } from '../lib/supabase';

export const googleCalendarService = {
  async connect() {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar.events',
        redirectTo: window.location.origin
      }
    });

    if (error) {
      console.error('Error connecting to Google Calendar:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  },

  async syncEvent(event: { title: string, description?: string, startTime: string, endTime: string, location?: string }) {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session || !session.provider_token) {
      console.error('No Google session found. Please connect first.');
      return { success: false, error: 'Not connected to Google' };
    }

    try {
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.provider_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summary: event.title,
          description: event.description,
          start: {
            dateTime: event.startTime,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          end: {
            dateTime: event.endTime,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          location: event.location
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      return { success: true, data };
    } catch (error: any) {
      console.error('Error syncing event to Google Calendar:', error);
      return { success: false, error: error.message };
    }
  },

  async isConnected() {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    return !!(session && session.provider_token);
  }
};
