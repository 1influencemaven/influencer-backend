import { parseExpiresInToMs } from './parse-expires-in.util';

describe('parseExpiresInToMs', () => {
  describe('valid formats', () => {
    it('should parse seconds', () => {
      expect(parseExpiresInToMs('30s')).toBe(30_000);
    });

    it('should parse minutes', () => {
      expect(parseExpiresInToMs('15m')).toBe(900_000);
    });

    it('should parse hours', () => {
      expect(parseExpiresInToMs('2h')).toBe(7_200_000);
    });

    it('should parse days', () => {
      expect(parseExpiresInToMs('7d')).toBe(604_800_000);
    });

    it('should parse single digit values', () => {
      expect(parseExpiresInToMs('1d')).toBe(86_400_000);
    });
  });

  describe('invalid formats', () => {
    it('should throw when format is empty', () => {
      expect(() => parseExpiresInToMs('')).toThrow(
        'Invalid expires in format: ',
      );
    });

    it('should throw when unit is missing', () => {
      expect(() => parseExpiresInToMs('15')).toThrow(
        'Invalid expires in format: 15',
      );
    });

    it('should throw when unit is invalid', () => {
      expect(() => parseExpiresInToMs('15x')).toThrow(
        'Invalid expires in format: 15x',
      );
    });

    it('should throw when value is missing', () => {
      expect(() => parseExpiresInToMs('m')).toThrow(
        'Invalid expires in format: m',
      );
    });

    it('should throw when value is not a number', () => {
      expect(() => parseExpiresInToMs('abcm')).toThrow(
        'Invalid expires in format: abcm',
      );
    });

    it('should throw when format has extra characters', () => {
      expect(() => parseExpiresInToMs('15min')).toThrow(
        'Invalid expires in format: 15min',
      );
    });

    it('should throw when format has spaces', () => {
      expect(() => parseExpiresInToMs('15 m')).toThrow(
        'Invalid expires in format: 15 m',
      );
    });
  });
});
