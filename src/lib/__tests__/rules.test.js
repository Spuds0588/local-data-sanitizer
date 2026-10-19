import { describe, expect, it } from 'vitest';
import { detectInText, luhnValid, digitCount } from '../rules.js';

const ALL = { rules: { email: true, phone: true, ssn: true, creditCard: true }, customKeywords: [] };

describe('luhnValid', () => {
  it('accepts a known-valid test card and rejects a bad one', () => {
    expect(luhnValid('4111 1111 1111 1111')).toBe(true);
    expect(luhnValid('4111 1111 1111 1112')).toBe(false);
    expect(luhnValid('123')).toBe(false);
  });
});

describe('detectInText', () => {
  it('finds every enabled rule type', () => {
    const text = 'Reach a.b@corp.io, call (555) 123-4567, SSN 123-45-6789, card 4111 1111 1111 1111.';
    const types = detectInText(text, ALL).map((m) => m.type);
    expect(types).toContain('email');
    expect(types).toContain('phone');
    expect(types).toContain('ssn');
    expect(types).toContain('creditCard');
  });

  it('respects disabled rules', () => {
    const found = detectInText('a@b.com', { rules: { email: false }, customKeywords: [] });
    expect(found).toHaveLength(0);
  });

  it('does not report an SSN as a phone number', () => {
    const found = detectInText('123-45-6789', { rules: { phone: true, ssn: true }, customKeywords: [] });
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('ssn');
  });

  it('rejects long digit runs that fail the Luhn check', () => {
    expect(detectInText('9999999999999999', { rules: { creditCard: true }, customKeywords: [] })).toHaveLength(0);
  });

  it('matches custom keywords case-insensitively and returns actual casing', () => {
    const found = detectInText('project phoenix and PROJECT PHOENIX', {
      rules: {},
      customKeywords: ['Project Phoenix'],
    });
    expect(found).toHaveLength(2);
    expect(found[0].value).toBe('project phoenix');
    expect(found[1].value).toBe('PROJECT PHOENIX');
  });

  it('gives non-empty digit counts for validation helpers', () => {
    expect(digitCount('(555) 123-4567')).toBe(10);
  });

  it('leaves transaction and account numbers alone instead of calling them phones', () => {
    const cfg = { rules: { phone: true }, customKeywords: [] };
    expect(detectInText('TXN 4509123456789012', cfg)).toHaveLength(0);
    expect(detectInText('reference 4509-1234-5678-9012', cfg)).toHaveLength(0);
    expect(detectInText('invoice 1234567890', cfg)).toHaveLength(0);
  });

  it('still accepts real phone formats', () => {
    const cfg = { rules: { phone: true }, customKeywords: [] };
    expect(detectInText('call 555-123-4567', cfg)).toHaveLength(1);
    expect(detectInText('call +1 (555) 123-4567', cfg)).toHaveLength(1);
    expect(detectInText('call 555.123.4567', cfg)).toHaveLength(1);
  });

  it('flags masked and last-four card fragments', () => {
    const cfg = { rules: { creditCardPartial: true }, customKeywords: [] };
    expect(detectInText('card **** **** **** 4242', cfg)[0].value).toBe('**** **** **** 4242');
    expect(detectInText('on file: xxxx-xxxx-xxxx-4242', cfg)[0].value).toBe('xxxx-xxxx-xxxx-4242');
    expect(detectInText('ends in 4242', cfg)[0].value).toBe('ends in 4242');
    expect(detectInText('last four digits: 4242', cfg)[0].value).toBe('last four digits: 4242');
  });

  it('flags monetary amounts and leaves dates, percents and IDs alone', () => {
    const cfg = { rules: { amount: true }, customKeywords: [] };
    const values = detectInText(
      'Invoice $1,234.56 · retainer 5,000.00 · fee 1200.75 · budget USD 2,000',
      cfg,
    ).map((m) => m.value);
    expect(values).toEqual(['$1,234.56', '5,000.00', '1200.75', 'USD 2,000']);

    expect(detectInText('dated 2024.01.15', cfg)).toHaveLength(0);
    expect(detectInText('rate 123.45%', cfg)).toHaveLength(0);
    expect(detectInText('txn 4509123456789012', cfg)).toHaveLength(0);
    expect(detectInText('zero $0.00', cfg)).toHaveLength(0);
    // European grouping is out of scope — better to miss it than rewrite "€1"
    // out of "€1.234,56" and leave the rest of the number behind.
    expect(detectInText('total €1.234,56', cfg)).toHaveLength(0);
  });

  it('captures signed and accounting-style amounts whole', () => {
    const cfg = { rules: { amount: true }, customKeywords: [] };
    expect(detectInText('refund ($1,000.00)', cfg)[0].value).toBe('($1,000.00)');
    expect(detectInText('charge -$1,000.00', cfg)[0].value).toBe('-$1,000.00');
  });

  it('types national IDs by scheme and ignores look-alikes', () => {
    const cfg = { rules: { nationalId: true }, customKeywords: [] };
    expect(detectInText('NI AB 12 34 56 C', cfg)[0].type).toBe('nationalId');
    expect(detectInText('NHS 943 476 5919', cfg)[0].value).toBe('943 476 5919');
    expect(detectInText('CPF 529.982.247-25', cfg)[0].value).toBe('529.982.247-25');
    expect(detectInText('Aadhaar 2341 2341 2346', cfg)[0].value).toBe('2341 2341 2346');
    expect(detectInText('SIN 046-454-765', cfg)[0].value).toBe('046-454-765');

    // A failed check digit, an SSN, a card and a date are not national IDs.
    expect(detectInText('CPF 529.982.247-26', cfg)).toHaveLength(0);
    expect(detectInText('123-45-6789', cfg)).toHaveLength(0);
    expect(detectInText('4111 1111 1111 1111', cfg)).toHaveLength(0);
    expect(detectInText('1991-04-17', cfg)).toHaveLength(0);
  });

  it('reads labelled DNI and PESEL, and rejects a bad check letter', () => {
    const cfg = { rules: { nationalId: true }, customKeywords: [] };
    expect(detectInText('DNI: 12345678Z', cfg)[0].value).toBe('12345678Z');
    expect(detectInText('DNI: 12345678A', cfg)).toHaveLength(0);
    expect(detectInText('PESEL 44051401359', cfg)[0].value).toBe('44051401359');
    expect(detectInText('PESEL 44051401358', cfg)).toHaveLength(0);
  });

  it('catches a titled name in prose without swallowing the sentence', () => {
    const cfg = { rules: { name: true }, customKeywords: [] };
    expect(detectInText('Met Dr. Anna Weber at the clinic.', cfg).map((m) => m.value)).toEqual([
      'Anna Weber',
    ]);
    expect(detectInText('Signed by Mr John Smith, Director', cfg).map((m) => m.value)).toContain(
      'John Smith',
    );
  });

  it('reads a sentence-start label in any casing without matching prose', () => {
    const cfg = { rules: { name: true }, customKeywords: [] };
    expect(detectInText('Account Holder: Marcus Webb', cfg).map((m) => m.value)).toEqual([
      'Marcus Webb',
    ]);
    expect(detectInText('Patient: Jane Doe', cfg).map((m) => m.value)).toEqual(['Jane Doe']);
    expect(detectInText('Beneficiary: Doe, Jane', cfg).map((m) => m.value)).toEqual(['Doe, Jane']);
    // Case-folding the label must not turn lowercase prose into a name.
    expect(detectInText('contact us about the invoice', cfg)).toHaveLength(0);
  });

  it('handles newer street suffixes and social profiles', () => {
    expect(detectInText('12 Windmill Close', { rules: { address: true }, customKeywords: [] })[0].value).toBe(
      '12 Windmill Close',
    );
    expect(
      detectInText('https://instagram.com/jane.doe', { rules: { profileUrl: true }, customKeywords: [] })[0]
        .value,
    ).toBe('https://instagram.com/jane.doe');
  });

  it('separates an IPv6 address from a MAC and a clock time', () => {
    const cfg = { rules: { ipv6: true, macAddress: true }, customKeywords: [] };
    expect(detectInText('2001:db8:85a3::8a2e:370:7334', cfg).map((m) => m.type)).toEqual(['ipv6']);
    expect(detectInText('00:1B:44:11:3A:B7', cfg).map((m) => m.type)).toEqual(['macAddress']);
    expect(detectInText('at 14:22:05 the job ran', cfg)).toHaveLength(0);
    expect(detectInText('2024:02:03', cfg)).toHaveLength(0);
  });

  it('finds VINs only when they are labelled', () => {
    const cfg = { rules: { vin: true }, customKeywords: [] };
    expect(detectInText('VIN: 1HGCM82633A004352', cfg)[0].value).toBe('1HGCM82633A004352');
    expect(detectInText('chassis 1HGCM82633A004352', cfg)).toHaveLength(1);
    expect(detectInText('1HGCM82633A004352', cfg)).toHaveLength(0);
  });

  it('keeps wallet address prefixes and lengths', () => {
    const cfg = { rules: { cryptoWallet: true }, customKeywords: [] };
    const values = detectInText(
      '0x71C7656EC7ab88b098defB751B7401B5f6d8976F bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      cfg,
    ).map((m) => m.type);
    expect(values).toEqual(['cryptoWallet', 'cryptoWallet', 'cryptoWallet']);
  });

  it('swallows a whole private key block as one match', () => {
    const cfg = { rules: { privateKey: true }, customKeywords: [] };
    const block = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
    const found = detectInText(`key follows\n${block}\nend`, cfg);
    expect(found).toHaveLength(1);
    expect(found[0].value).toBe(block);
  });

  it('prefers a password-bearing connection string over the email inside it', () => {
    const cfg = { rules: { credentialUrl: true, email: true }, customKeywords: [] };
    const found = detectInText('postgres://app:hunter2@db.internal:5432/prod', cfg);
    expect(found.map((m) => m.type)).toEqual(['credentialUrl']);
    expect(detectInText('https://example.com/docs', cfg)).toHaveLength(0);
  });

  it('captures a cookie header from its first name, keeping the spacing', () => {
    const cfg = { rules: { cookie: true }, customKeywords: [] };
    expect(detectInText('Cookie: session=abc123; theme=dark', cfg)[0].value).toBe(
      'session=abc123; theme=dark',
    );
    expect(detectInText('Set-Cookie: id=a3fWa; Path=/; HttpOnly', cfg)[0].value).toBe(
      'id=a3fWa; Path=/; HttpOnly',
    );
  });

  it('reads a labelled coordinate pair as one value', () => {
    const cfg = { rules: { coordinates: true }, customKeywords: [] };
    expect(detectInText('geo: 35.6895, 139.6917', cfg)[0].value).toBe('35.6895, 139.6917');
    expect(detectInText('Coordinates: 51.5074,-0.1278', cfg)[0].value).toBe('51.5074,-0.1278');
    expect(detectInText('price 12.3456', cfg)).toHaveLength(0);
  });

  it('keeps every postcode scheme it recognises', () => {
    const cfg = { rules: { postalCode: true }, customKeywords: [] };
    expect(detectInText('SW1A 1AA', cfg)[0].value).toBe('SW1A 1AA');
    expect(detectInText('K1A 0B1', cfg)[0].value).toBe('K1A 0B1');
    expect(detectInText('01310-100', cfg)[0].value).toBe('01310-100');
    expect(detectInText('postcode: T12 X8Y2', cfg)[0].value).toBe('T12 X8Y2');
    expect(detectInText('ZIP: 84101-1234', cfg)[0].value).toBe('84101-1234');
    // B is not an Eircode routing letter, and a bare ZIP is too common.
    expect(detectInText('B02 X285', cfg)).toHaveLength(0);
    expect(detectInText('84101', cfg)).toHaveLength(0);
  });

  it('accepts national phone formats without eating dates or amounts', () => {
    const cfg = { rules: { phone: true }, customKeywords: [] };
    expect(detectInText('call 0161 496 0123', cfg)[0].value).toBe('0161 496 0123');
    expect(detectInText('branch 020 7946 0958', cfg)[0].value).toBe('020 7946 0958');
    expect(detectInText('on 2024 02 03', cfg)).toHaveLength(0);
    expect(detectInText('0 800 123 456', cfg)).toHaveLength(0);
  });

  it('finds the wider set of API key shapes', () => {
    const cfg = { rules: { apiKey: true }, customKeywords: [] };
    const keys = [
      'AIzaSyA1234567890abcdefghijklmnopqrstuv',
      // Assembled at runtime so the synthetic value is not a literal secret in
      // the repository (GitHub push protection scans committed text).
      `sk_live_${'51H8xYzABCdefGHIjklMNOpqr'}`,
      'npm_abcdefghijklmnopqrstuvwxyz0123456789',
      'SG.abcdefghijklmnop.qrstuvwxyz0123456789ABCD',
      `dop_v1_${'a'.repeat(64)}`,
      'https://hooks.slack.com/services/T000/B000/XXXX',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
      'https://api.example.com?access_token=abcdef1234567890abcdef',
    ];
    for (const key of keys) {
      expect(detectInText(key, cfg).length, key).toBeGreaterThan(0);
    }
  });

  it('does not mistake a SQL variable for an @handle', () => {
    const cfg = { rules: { profileUrl: true }, customKeywords: [] };
    expect(detectInText('SET @OLD_CHARACTER_SET_CLIENT=@@X', cfg)).toHaveLength(0);
    expect(detectInText('ping @janedoe', cfg)[0].value).toBe('@janedoe');
  });

  it('accepts only MRZ blocks whose check digits hold', () => {
    const cfg = { rules: { mrz: true }, customKeywords: [] };
    const line1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
    const line2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
    const found = detectInText(`Passport\n${line1}\n${line2}\n`, cfg);
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('mrz');

    // One wrong check digit and it is not an MRZ.
    const broken = `${line2.slice(0, 9)}9${line2.slice(10)}`;
    expect(detectInText(`${line1}\n${broken}`, cfg)).toHaveLength(0);
  });

  it('finds local bank codes and labelled plates', () => {
    const bank = { rules: { bankCode: true }, customKeywords: [] };
    expect(detectInText('Sort code: 12-34-56', bank)[0].value).toBe('12-34-56');
    expect(detectInText('BSB 062-000', bank)[0].value).toBe('062-000');
    expect(detectInText('IFSC: HDFC0001234', bank)[0].value).toBe('HDFC0001234');
    expect(detectInText(`CLABE: ${'0'.repeat(18)}`, bank)[0].value).toHaveLength(18);
    expect(detectInText('sort order 12-34-56', bank)).toHaveLength(0);

    const plate = { rules: { plate: true }, customKeywords: [] };
    expect(detectInText('Plate: AB12 CDE', plate)[0].value).toBe('AB12 CDE');
    expect(detectInText('registration: 8XYZ123', plate)[0].value).toBe('8XYZ123');
    expect(detectInText('registered 1234', plate)).toHaveLength(0);
  });

  it('handles PGP private key blocks and secret env vars', () => {
    const cfg = { rules: { privateKey: true, apiKey: true }, customKeywords: [] };
    const pgp = '-----BEGIN PGP PRIVATE KEY BLOCK-----\nabc\n-----END PGP PRIVATE KEY BLOCK-----';
    expect(detectInText(pgp, cfg).map((m) => m.type)).toContain('privateKey');
    for (const line of [
      'AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz123456',
      'CLIENT_SECRET: s3cr3t-value-that-is-long',
      'REFRESH_TOKEN="1//0gabcdefghijklmnopqrstuvwxyz"',
    ]) {
      expect(detectInText(line, cfg).map((m) => m.type), line).toContain('apiKey');
    }
  });

  it('does not double-report a full card number as a fragment', () => {
    const found = detectInText('4111 1111 1111 1111', {
      rules: { creditCard: true, creditCardPartial: true },
      customKeywords: [],
    });
    expect(found.map((m) => m.type)).toEqual(['creditCard']);
  });
});
