export function isQuestion(query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.endsWith('?')) return true;

  const questionStarters = ['what', 'who', 'when', 'where', 'why', 'how', 'did', 'do', 'does', 'is', 'are', 'can', 'will', 'should'];
  return questionStarters.some((starter) => trimmed.startsWith(starter));
}
