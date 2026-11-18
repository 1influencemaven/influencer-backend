jest.mock('./brand-business-contact.service', () => ({
  BrandBusinessContactService: class BrandBusinessContactService {},
}));

jest.mock('./lead-discovery.service', () => ({
  LeadDiscoveryService: class LeadDiscoveryService {},
}));

jest.mock('./unlocker-diagnostics.service', () => ({
  UnlockerDiagnosticsService: class UnlockerDiagnosticsService {},
}));

jest.mock('../agency-discovery/agency-contact-commercial-reader.service', () => ({
  AgencyContactCommercialReaderService: class AgencyContactCommercialReaderService {},
}));

import { NotFoundException } from '@nestjs/common';

import { AgencyContactCommercialReaderService } from '../agency-discovery/agency-contact-commercial-reader.service';
import { BrandBusinessContactService } from './brand-business-contact.service';
import { LeadDiscoveryController } from './lead-discovery.controller';
import { LeadDiscoveryService } from './lead-discovery.service';
import { UnlockerDiagnosticsService } from './unlocker-diagnostics.service';
import { UNLOCKER_DIAGNOSTIC_ALLOWED_URL } from './utils/unlocker-diagnostics.constants';

describe('LeadDiscoveryController', () => {
  const leadDiscoveryService = {} as LeadDiscoveryService;
  const brandBusinessContactService = {
    listByBrandCandidateId: jest.fn(),
  };
  const agencyContactCommercialReader = {
    listForInfluencer: jest.fn(),
  };
  const unlockerDiagnosticsService = {
    probe: jest.fn(),
  };

  let controller: LeadDiscoveryController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new LeadDiscoveryController(
      leadDiscoveryService,
      brandBusinessContactService as unknown as BrandBusinessContactService,
      agencyContactCommercialReader as unknown as AgencyContactCommercialReaderService,
      unlockerDiagnosticsService as unknown as UnlockerDiagnosticsService,
    );
  });

  describe('listBusinessContacts', () => {
    it('delegates to BrandBusinessContactService', async () => {
      const contacts = [{ id: 'bbc1', email: 'partnerships@brand.com' }];
      brandBusinessContactService.listByBrandCandidateId.mockResolvedValue(
        contacts,
      );

      await expect(
        controller.listBusinessContacts({ brandCandidateId: 'b1' }),
      ).resolves.toEqual(contacts);
      expect(
        brandBusinessContactService.listByBrandCandidateId,
      ).toHaveBeenCalledWith('b1');
    });

    it('propagates NotFoundException when brand is missing', async () => {
      brandBusinessContactService.listByBrandCandidateId.mockRejectedValue(
        new NotFoundException('Brand candidate b1 not found'),
      );

      await expect(
        controller.listBusinessContacts({ brandCandidateId: 'b1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns empty list when service returns empty', async () => {
      brandBusinessContactService.listByBrandCandidateId.mockResolvedValue([]);

      await expect(
        controller.listBusinessContacts({ brandCandidateId: 'b1' }),
      ).resolves.toEqual([]);
    });
  });

  describe('listAgencyContacts (2C.4.7)', () => {
    it('delegates to AgencyContactCommercialReaderService', async () => {
      const contacts = [
        {
          agencyContactId: 'ac-1',
          origin: 'AGENCY_CONTACT_RESEARCH',
          track: '2C',
        },
      ];
      agencyContactCommercialReader.listForInfluencer.mockResolvedValue(
        contacts,
      );

      await expect(
        controller.listAgencyContacts({ influencerId: 'inf-1' }),
      ).resolves.toEqual(contacts);
      expect(
        agencyContactCommercialReader.listForInfluencer,
      ).toHaveBeenCalledWith({
        influencerId: 'inf-1',
        contactKind: undefined,
        commercialRelevance: undefined,
      });
    });

    it('propagates NotFoundException when influencer missing', async () => {
      agencyContactCommercialReader.listForInfluencer.mockRejectedValue(
        new NotFoundException('Influencer inf-1 not found'),
      );

      await expect(
        controller.listAgencyContacts({ influencerId: 'inf-1' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('probeUnlocker', () => {
    it('delegates to UnlockerDiagnosticsService', async () => {
      const diagnostic = {
        url: UNLOCKER_DIAGNOSTIC_ALLOWED_URL,
        outcome: 'ok',
        apiHttpStatus: 200,
        bodyLength: 10,
        elapsedMs: 100,
        zone: 'mcp_unlocker',
      };
      unlockerDiagnosticsService.probe.mockResolvedValue(diagnostic);

      await expect(
        controller.probeUnlocker({ url: UNLOCKER_DIAGNOSTIC_ALLOWED_URL }),
      ).resolves.toEqual(diagnostic);
      expect(unlockerDiagnosticsService.probe).toHaveBeenCalledWith(
        UNLOCKER_DIAGNOSTIC_ALLOWED_URL,
      );
    });
  });
});
