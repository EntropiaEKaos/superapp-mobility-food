export const PARTNER_KINDS = ['DRIVER', 'COURIER', 'RESTAURANT'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export type PartnerRequest = {
  kind: PartnerKind;
  displayName: string;
  city: string;
};

type ValidationResult = { ok: true; data: PartnerRequest } | { ok: false; error: string };

export function validatePartnerRequest(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Dados inválidos.' };
  }

  const data = input as Record<string, unknown>;
  if (!PARTNER_KINDS.some(kind => kind === data.kind)) {
    return { ok: false, error: 'Escolha um tipo válido de parceria.' };
  }
  if (typeof data.displayName !== 'string' || typeof data.city !== 'string') {
    return { ok: false, error: 'Informe nome e cidade.' };
  }

  const displayName = data.displayName.trim();
  const city = data.city.trim();
  const badChars = /[\u0000-\u001f\u007f]/;

  if (displayName.length < 2 || displayName.length > 80 || badChars.test(displayName)) {
    return { ok: false, error: 'O nome deve ter entre 2 e 80 caracteres.' };
  }
  if (city.length < 2 || city.length > 80 || badChars.test(city)) {
    return { ok: false, error: 'A cidade deve ter entre 2 e 80 caracteres.' };
  }

  return { ok: true, data: { kind: data.kind as PartnerKind, displayName, city } };
}
