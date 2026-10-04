export interface MatchWeights { skills: number; category: number; budget: number; availability: number; language: number }
export interface MatchProject {
  id: string; skillIds: string[]; categoryId: string | null; budgetMin: number | null; budgetMax: number | null; languages: string[];
}
export interface MatchProvider {
  id: string; skillIds: string[]; categoryIds: string[]; hourlyMin: number | null; hourlyMax: number | null;
  availability: "available" | "limited" | "unavailable"; languages: string[];
}

const band = (min: number | null, max: number | null): [number, number] | null => {
  const lo = min ?? max;
  const hi = max ?? min;
  return lo === null || hi === null ? null : [lo, hi];
};

/** Rule-based, explainable score. The numeric score exists only to order results; callers get reasons, never the number. */
export function scoreMatch(project: MatchProject, provider: MatchProvider, w: MatchWeights): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const overlap = project.skillIds.filter((s) => provider.skillIds.includes(s)).length;
  if (project.skillIds.length > 0 && overlap > 0) {
    score += (overlap / project.skillIds.length) * w.skills;
    if (w.skills > 0) reasons.push(`Matches ${overlap} of ${project.skillIds.length} skills`);
  }
  if (project.categoryId && provider.categoryIds.includes(project.categoryId)) {
    score += w.category;
    if (w.category > 0) reasons.push("Same category");
  }
  const p = band(provider.hourlyMin, provider.hourlyMax);
  const b = band(project.budgetMin, project.budgetMax);
  if (p && b && Math.max(p[0], b[0]) <= Math.min(p[1], b[1])) {
    score += w.budget;
    if (w.budget > 0) reasons.push("Within budget");
  }
  if (provider.availability === "available" || provider.availability === "limited") {
    score += (provider.availability === "available" ? 1 : 0.5) * w.availability;
    if (provider.availability === "available" && w.availability > 0) reasons.push("Available now");
  }
  const shared = project.languages.find((l) => provider.languages.includes(l));
  if (shared) {
    score += w.language;
    if (w.language > 0) reasons.push(`Speaks ${shared}`);
  }
  return { score, reasons };
}

const byScoreThenId = <T extends { score: number; key: string }>(a: T, b: T) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function rankProviders(project: MatchProject, providers: MatchProvider[], w: MatchWeights, limit: number) {
  return providers
    .filter((p) => p.availability !== "unavailable")
    .map((provider) => ({ provider, key: provider.id, ...scoreMatch(project, provider, w) }))
    .sort(byScoreThenId)
    .slice(0, Math.max(0, limit))
    .map(({ provider, reasons }) => ({ provider, reasons }));
}

export function recommendProjects(provider: MatchProvider, projects: MatchProject[], w: MatchWeights, limit: number) {
  return projects
    .map((project) => ({ project, key: project.id, ...scoreMatch(project, provider, w) }))
    .sort(byScoreThenId)
    .slice(0, Math.max(0, limit))
    .map(({ project, reasons }) => ({ project, reasons }));
}
