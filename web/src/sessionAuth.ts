export type SessionRole = 'owner' | 'collaborator' | 'bot';

export function canControl(role: SessionRole): boolean {
  return role === 'owner' || role === 'collaborator' || role === 'bot';
}

export function assignRole(ownerUserId: string | null, userId: string): 'owner' | 'collaborator' {
  if (!ownerUserId || ownerUserId === userId) return 'owner';
  return 'collaborator';
}

export function scopedRecipients<T extends { guildId: string }>(guildId: string, recipients: T[]): T[] {
  return recipients.filter((r) => r.guildId === guildId);
}
