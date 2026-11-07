// The clinic's explicit Save must only succeed after the authenticated server
// confirms persistence. This is never a local/outbox acknowledgement.
export interface ConfirmedClinicSaveDependencies {
  request: (url: string, init: RequestInit) => Promise<Response>;
  authHeaders: () => Promise<HeadersInit>;
  parseResponse: (response: Response) => Promise<any>;
}

export const persistConfirmedClinicSettings = async (
  endpoint: string,
  data: Record<string, any>,
  { request, authHeaders, parseResponse }: ConfirmedClinicSaveDependencies,
): Promise<any> => {
  try {
    const response = await request(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: await authHeaders(),
      body: JSON.stringify(data),
    });
    const result = await parseResponse(response);
    if (!response.ok || result?.success !== true) {
      return {
        success: false,
        error: result?.message || result?.error || 'Não foi possível confirmar o salvamento das configurações da clínica.',
      };
    }
    return result;
  } catch {
    return { success: false, error: 'Não foi possível confirmar o salvamento das configurações da clínica.' };
  }
};
