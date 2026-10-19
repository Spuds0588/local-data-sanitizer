import { describe, expect, it } from 'vitest';
import { classifyHeader, extractTypedValue } from '../columns.js';

describe('classifyHeader', () => {
  it('reads a header as the thing its value is', () => {
    expect(classifyHeader('Email')).toBe('email');
    expect(classifyHeader('Mobile Phone')).toBe('phone');
    expect(classifyHeader('Date of Birth')).toBe('dob');
    expect(classifyHeader('Bank Account')).toBe('account');
    expect(classifyHeader('Checking Account')).toBe('account');
    expect(classifyHeader('Account Holder')).toBe('name');
    expect(classifyHeader('Customer ID')).toBe('recordId');
    expect(classifyHeader('Member ID')).toBe('medicalId');
    expect(classifyHeader('Payer')).toBe('organization');
    expect(classifyHeader('City')).toBe('city');
    expect(classifyHeader('Balance')).toBe('amount');
  });

  it('treats a bare id key as an identifier, not a name', () => {
    expect(classifyHeader('id')).toBe('recordId');
    expect(classifyHeader('_id')).toBe('recordId');
    expect(classifyHeader('contact_id')).toBe('recordId');
  });

  it('leaves schema-free headers alone', () => {
    for (const header of ['Description', 'Invoice #', 'Status', 'Currency', 'Notes']) {
      expect(classifyHeader(header), header).toBeNull();
    }
  });
});

describe('extractTypedValue', () => {
  it('turns a company-shaped column value into an organisation', () => {
    expect(extractTypedValue('name', 'City Power & Light')?.type).toBe('organization');
    expect(extractTypedValue('name', 'Whole Foods Market')?.type).toBe('organization');
    expect(extractTypedValue('name', 'Northwind Traders LLC')?.type).toBe('organization');
  });

  it('keeps a person a person', () => {
    expect(extractTypedValue('name', 'Jane Doe')?.type).toBe('name');
    expect(extractTypedValue('name', 'Doe, Jane')?.type).toBe('name');
    expect(extractTypedValue('name', 'Priya')?.type).toBe('name');
  });

  it('accepts the date spellings that appear in real documents', () => {
    for (const value of ['April 17, 1986', 'April 17 1986', '17 April 1986', '1986-04-17', '04/17/1986']) {
      expect(extractTypedValue('dob', value)?.type, value).toBe('dob');
    }
    expect(extractTypedValue('dob', '2050-01-01')).toBeNull();
  });

  it('validates a bare account number by width, and keeps a masked one', () => {
    expect(extractTypedValue('account', '441900273')?.original).toBe('441900273');
    expect(extractTypedValue('account', '****1234')?.original).toBe('****1234');
    expect(extractTypedValue('account', '12345')).toBeNull();
  });
});
