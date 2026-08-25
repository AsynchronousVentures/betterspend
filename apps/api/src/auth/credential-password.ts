export async function hashCredentialPassword(password: string): Promise<string> {
  const { hashPassword } = await import('better-auth/crypto');
  return hashPassword(password);
}
