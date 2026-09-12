export const SENSITIVE_FIELDS = ['documentNumber', 'owner', 'issuer'] as const;

export function isSensitiveField(field: string): boolean {
  return SENSITIVE_FIELDS.includes(field as any);
}
