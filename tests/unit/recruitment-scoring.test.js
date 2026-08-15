/**
 * Applicant scoring (0525).
 *
 * The dimensions are pure arithmetic with a rationale written above each one in
 * vacancy.scoring.js, and every case below pins a decision from that rationale
 * rather than the implementation that happens to satisfy it. Three of them are
 * the difference between a useful ordering aid and a number that quietly
 * discards good candidates:
 *
 *   * A dimension nobody can answer must be NULL and must be ABSENT from the
 *     average — scoring "we could not tell" as zero drags every incomplete
 *     application to the bottom of the list.
 *   * Asking for LESS than the salary band is not a defect.
 *   * A vacancy that lists no required skills must not hand every applicant a
 *     free 100.
 */
"use strict";

const s = require("../../src/modules/hr/vacancy/vacancy.scoring");

describe("skillsScore", () => {
  it("is null when the role asked for nothing — not a free 100", () => {
    // "We did not ask for anything" is not "they have everything". Scoring it
    // as a perfect match lets an empty vacancy inflate every candidate.
    expect(s.skillsScore([], ["forklift"])).toBeNull();
    expect(s.skillsScore(null, ["forklift"])).toBeNull();
  });

  it("counts the proportion of required skills claimed", () => {
    expect(
      s.skillsScore(["customs", "french", "forklift"], ["customs", "french"]),
    ).toBe(67);
    expect(s.skillsScore(["customs"], ["customs", "french"])).toBe(100);
    expect(s.skillsScore(["customs"], ["welding"])).toBe(0);
  });

  it("matches substrings in both directions and ignores case", () => {
    // "customs clearance (sea)" must satisfy a "customs clearance" requirement,
    // and "SQL" must be satisfied by "PostgreSQL".
    expect(
      s.skillsScore(["customs clearance"], ["Customs Clearance (sea)"]),
    ).toBe(100);
    expect(s.skillsScore(["sql"], ["PostgreSQL"])).toBe(100);
  });
});

describe("experienceScore", () => {
  it("degrades proportionally below the minimum rather than falling off a cliff", () => {
    // Two years against three is most of the way there. A hard cutoff would
    // discard candidates a human would happily interview.
    expect(s.experienceScore(3, 2)).toBe(67);
    expect(s.experienceScore(3, 0)).toBe(0);
  });

  it("caps at 100 — twenty years against a three-year minimum is not 7x", () => {
    expect(s.experienceScore(3, 3)).toBe(100);
    expect(s.experienceScore(3, 20)).toBe(100);
  });

  it("is null when the candidate said nothing", () => {
    expect(s.experienceScore(3, null)).toBeNull();
    expect(s.experienceScore(3, undefined)).toBeNull();
  });
});

describe("salaryScore", () => {
  it("treats asking for LESS than the band as a perfect fit", () => {
    // The band is what the company decided the role is worth. Someone asking
    // under it is not a worse candidate, and penalising them would rank people
    // by how expensive they are.
    expect(s.salaryScore(100, 200, 50)).toBe(100);
  });

  it("treats the very top of the band as a perfect fit too", () => {
    expect(s.salaryScore(100, 200, 200)).toBe(100);
  });

  it("decays over one further band-width above the top", () => {
    expect(s.salaryScore(100, 200, 250)).toBe(50);
    expect(s.salaryScore(100, 200, 300)).toBe(0);
    expect(s.salaryScore(100, 200, 1000)).toBe(0);
  });

  it("does not divide by zero when min equals max", () => {
    // A single-point band would otherwise make every over-ask, however slight,
    // score 0 — or produce NaN, which the column's CHECK would reject.
    expect(s.salaryScore(200, 200, 220)).toBe(90);
  });

  it("is null when either side said nothing", () => {
    expect(s.salaryScore(null, null, 100)).toBeNull();
    expect(s.salaryScore(100, 200, null)).toBeNull();
  });
});

describe("composite", () => {
  it("EXCLUDES nulls from the average rather than counting them as zero", () => {
    // This is the one that matters. Averaging {100, null} as {100, 0} = 50
    // pushes every application with a gap to the bottom of the list.
    expect(s.composite({ a: 100, b: null })).toBe(100);
    expect(s.composite({ a: 100, b: 50 })).toBe(75);
  });

  it("is null when nothing could be scored at all", () => {
    expect(s.composite({ a: null, b: undefined })).toBeNull();
  });
});

describe("estimate", () => {
  const vacancy = {
    skills_required: ["customs", "french"],
    experience_years_min: 3,
    salary_min: 100,
    salary_max: 200,
  };

  it("MARKS ITSELF PROVISIONAL — it has not opened the CV", () => {
    const out = s.estimate(vacancy, {
      skills: ["customs"],
      experience_years: 3,
      expected_salary: 150,
    });
    expect(out.ai_provisional).toBe(true);
    expect(out.ai_model).toBeNull();
    expect(out.ai_summary).toMatch(/pending/i);
  });

  it("scores from the fields the candidate typed", () => {
    const out = s.estimate(vacancy, {
      skills: ["customs", "french"],
      experience_years: 5,
      expected_salary: 150,
      cv_vault_id: "x",
      portfolio_url: "http://x",
    });
    // skills 100, experience 100, salary 100, portfolio 67 (CV + portfolio, no note)
    expect(out.ai_breakdown.skills).toBe(100);
    expect(out.ai_breakdown.portfolio).toBe(67);
    expect(out.ai_score).toBe(92);
  });

  it("does not throw on an application that filled in nothing", () => {
    const out = s.estimate({}, {});
    expect(out.ai_provisional).toBe(true);
    expect(typeof out.ai_score === "number" || out.ai_score === null).toBe(
      true,
    );
  });
});

describe("parseAssessment", () => {
  it("pulls the object out of a fenced or prose-padded reply", () => {
    expect(s.parseAssessment('```json\n{"overall":80}\n```')).toEqual({
      overall: 80,
    });
    expect(
      s.parseAssessment('Here you go: {"overall":80} — hope that helps'),
    ).toEqual({ overall: 80 });
  });

  it("returns null on prose, so the caller keeps the previous score", () => {
    // A model that answers in sentences must not blank a real assessment.
    expect(s.parseAssessment("I could not assess this candidate.")).toBeNull();
    expect(s.parseAssessment("")).toBeNull();
    expect(s.parseAssessment("{not json}")).toBeNull();
  });
});
