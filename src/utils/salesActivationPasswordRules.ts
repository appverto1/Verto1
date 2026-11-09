export const validateActivationPassword = (value: string): string | null => {
  if (value.length < 12) return 'A senha deve ter no mínimo 12 caracteres.';
  if (value.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (!/[A-Z]/.test(value)) return 'Inclua ao menos uma letra maiúscula.';
  if (!/[a-z]/.test(value)) return 'Inclua ao menos uma letra minúscula.';
  if (!/\d/.test(value)) return 'Inclua ao menos um número.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Inclua ao menos um símbolo.';
  return null;
};
