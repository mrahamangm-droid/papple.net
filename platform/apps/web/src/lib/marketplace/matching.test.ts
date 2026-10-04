import { describe, expect, it } from "vitest";
import { rankProviders, recommendProjects, scoreMatch, type MatchProject, type MatchProvider, type MatchWeights } from "./matching";

const W: MatchWeights = { skills: 50, category: 20, budget: 15, availability: 10, language: 5 };
const project = (o: Partial<MatchProject> = {}): MatchProject => ({
  id: "p0", skillIds: ["a", "b", "c", "d"], categoryId: "cat1", budgetMin: 100, budgetMax: 200, languages: ["en"], ...o,
});
const provider = (id: string, o: Partial<MatchProvider> = {}): MatchProvider => ({
  id, skillIds: [], categoryIds: [], hourlyMin: null, hourlyMax: null, availability: "available", languages: ["en"], ...o,
});

describe("scoreMatch", () => {
  it("scores full skill overlap above partial overlap", () => {
    const full = scoreMatch(project(), provider("x", { skillIds: ["a", "b", "c", "d"] }), W).score;
    const part = scoreMatch(project(), provider("y", { skillIds: ["a", "b"] }), W).score;
    expect(full).toBeGreaterThan(part);
  });
  it("adds weight for a category match", () => {
    const base = scoreMatch(project(), provider("x"), W).score;
    expect(scoreMatch(project(), provider("x", { categoryIds: ["cat1"] }), W).score).toBeGreaterThan(base);
  });
  it("treats overlapping rate and budget bands as within budget", () => {
    const inBand = scoreMatch(project(), provider("x", { hourlyMin: 150, hourlyMax: 300 }), W);
    const outBand = scoreMatch(project(), provider("x", { hourlyMin: 500, hourlyMax: 900 }), W);
    expect(inBand.reasons).toContain("Within budget");
    expect(outBand.reasons).not.toContain("Within budget");
    expect(inBand.score).toBeGreaterThan(outBand.score);
  });
  it("explains matches with fixed human reasons", () => {
    const r = scoreMatch(project({ languages: ["en", "ar"] }), provider("x", { skillIds: ["a", "b", "z"], categoryIds: ["cat1"], languages: ["ar"] }), W).reasons;
    expect(r).toEqual(expect.arrayContaining(["Matches 2 of 4 skills", "Same category", "Available now", "Speaks ar"]));
  });
  it("gives no skills reason and no NaN when there are no skills on either side", () => {
    const out = scoreMatch(project({ skillIds: [] }), provider("x"), W);
    expect(Number.isFinite(out.score)).toBe(true);
    expect(out.reasons.some((x) => x.startsWith("Matches"))).toBe(false);
  });
  it("a zero weight removes that factor", () => {
    const noSkills = { ...W, skills: 0 };
    const a = scoreMatch(project(), provider("x", { skillIds: ["a", "b", "c", "d"] }), noSkills).score;
    const b = scoreMatch(project(), provider("x"), noSkills).score;
    expect(a).toBe(b);
  });
});

describe("rankProviders", () => {
  it("orders by score, excludes unavailable providers and breaks ties by id", () => {
    const ps = [
      provider("b", { skillIds: ["a"] }),
      provider("a", { skillIds: ["a"] }),
      provider("z", { skillIds: ["a", "b", "c", "d"] }),
      provider("u", { skillIds: ["a", "b", "c", "d"], availability: "unavailable" }),
    ];
    expect(rankProviders(project(), ps, W, 10).map((r) => r.provider.id)).toEqual(["z", "a", "b"]);
  });
  it("respects the limit", () => {
    const ps = ["a", "b", "c"].map((id) => provider(id));
    expect(rankProviders(project(), ps, W, 2)).toHaveLength(2);
  });
  it("still orders correctly when weights do not sum to 100", () => {
    const heavy = { skills: 500, category: 0, budget: 0, availability: 0, language: 0 };
    const ps = [provider("a", { skillIds: ["a"] }), provider("b", { skillIds: ["a", "b"] })];
    expect(rankProviders(project(), ps, heavy, 5)[0].provider.id).toBe("b");
  });
  it("never returns a numeric score to callers", () => {
    const out = rankProviders(project(), [provider("a", { skillIds: ["a"] })], W, 5)[0];
    expect(Object.keys(out).sort()).toEqual(["provider", "reasons"]);
  });
});

describe("recommendProjects", () => {
  it("ranks projects for a provider using the same factors", () => {
    const me = provider("me", { skillIds: ["a", "b"], categoryIds: ["cat1"] });
    const good = project({ id: "good", skillIds: ["a", "b"] });
    const poor = project({ id: "poor", skillIds: ["x", "y"], categoryId: "other" });
    const out = recommendProjects(me, [poor, good], W, 5);
    expect(out.map((r) => r.project.id)).toEqual(["good", "poor"]);
    expect(Object.keys(out[0]).sort()).toEqual(["project", "reasons"]);
  });
});
