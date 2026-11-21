import type { IbpGenerationOutput } from '../capabilities/ibp';
import type { TalentInterpretationOutput } from '../capabilities/talent-profile-interpretation';

export const insufficientTalentInterpretationFixture: TalentInterpretationOutput =
  {
    outputVersion: '1.0',
    insufficientEvidence: true,
    summary: null,
    niches: [],
    contentCategories: [],
    commercialSignals: [],
    limitations: ['No Instagram research evidence in test fixture.'],
  };

/** Adds required talentInterpretation to legacy IBP field bags in unit tests. */
export function withTalentInterpretation(
  ibp: Omit<IbpGenerationOutput, 'talentInterpretation'>,
  interpretation: TalentInterpretationOutput = insufficientTalentInterpretationFixture,
): IbpGenerationOutput {
  return {
    ...ibp,
    talentInterpretation: interpretation,
  };
}
