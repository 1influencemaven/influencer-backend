import { PersonQueryLadderBuilder } from './person-query-ladder.builder';

describe('PersonQueryLadderBuilder', () => {
  const builder = new PersonQueryLadderBuilder();

  it('builds role and brand queries', () => {
    const queries = builder.build({
      brandName: 'Liquid I.V.',
      priorityRoles: ['Influencer Marketing'],
    });

    expect(queries).toContain('"Liquid I.V." "Influencer Marketing"');
    expect(queries).toContain(
      'site:linkedin.com/in "Liquid I.V." "Influencer Marketing"',
    );
    expect(queries).toContain('"Liquid I.V." influencer marketing');
  });

  it('deduplicates roles', () => {
    const queries = builder.build({
      brandName: 'Gymshark',
      priorityRoles: ['CEO', 'CEO'],
    });
    const ceoQueries = queries.filter((q) => q.includes('"CEO"'));
    expect(ceoQueries.length).toBe(3);
  });
});
