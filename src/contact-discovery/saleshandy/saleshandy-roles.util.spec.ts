import {
  isPriorityCollaborationRole,
  rankCollaborationRole,
} from './saleshandy-roles.util';

describe('rankCollaborationRole', () => {
  it('ranks influencer/partnership roles above PR above brand marketing', () => {
    const influencer = rankCollaborationRole('Influencer Marketing Manager');
    const pr = rankCollaborationRole('PR Manager');
    const director = rankCollaborationRole('Director of Marketing');
    const manager = rankCollaborationRole('Marketing Manager');
    expect(influencer).toBeGreaterThan(pr);
    expect(pr).toBeGreaterThan(director);
    expect(director).toBeGreaterThan(manager);
    expect(manager).toBeGreaterThan(0);
  });

  it('adds a decision-maker bonus', () => {
    expect(rankCollaborationRole('Director of Marketing', true)).toBe(
      rankCollaborationRole('Director of Marketing') + 10,
    );
  });

  it('never spends credits on non-collaboration marketing roles', () => {
    expect(rankCollaborationRole('Lifecycle Marketing Manager')).toBe(0);
    expect(rankCollaborationRole('Director of Performance Marketing')).toBe(0);
    expect(rankCollaborationRole('Email Marketing Specialist')).toBe(0);
    expect(rankCollaborationRole('Software Engineer')).toBe(0);
    expect(rankCollaborationRole('Brand Designer')).toBe(0);
    expect(rankCollaborationRole('Content Creator')).toBe(0);
    expect(rankCollaborationRole('Global Educator & Brand Ambassador')).toBe(0);
    expect(rankCollaborationRole('Brand Ambassador')).toBe(0);
    expect(rankCollaborationRole('')).toBe(0);
    expect(rankCollaborationRole(undefined)).toBe(0);
  });

  it('keeps people who manage creators/ambassadors', () => {
    expect(rankCollaborationRole('Creator Partnerships Manager')).toBeGreaterThanOrEqual(100);
    expect(rankCollaborationRole('Brand Ambassador Program Lead')).toBeGreaterThanOrEqual(100);
    expect(rankCollaborationRole('Influencer & Community Coordinator')).toBeGreaterThanOrEqual(100);
  });

  it('flags the strategy high-priority allowlist', () => {
    expect(isPriorityCollaborationRole('Brand Partnerships Lead')).toBe(true);
    expect(isPriorityCollaborationRole('Social Media Manager')).toBe(true);
    expect(isPriorityCollaborationRole('Marketing Manager')).toBe(false);
  });
});
