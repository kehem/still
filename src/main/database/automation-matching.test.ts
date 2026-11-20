import { expect, it } from 'vitest';
import { sentMatchKeys } from './automation-matching';
const keys = (body: string, signature = '') => sentMatchKeys('Reader@Example.com', 'Hello', body, signature);
it('normalizes newline styles, whitespace, nonbreaking spaces and composed Unicode', () => {
  expect(keys('Café\r\n\r\nHello\u00a0there\tfriend')).toEqual(keys('Cafe\u0301\nHello there friend'));
});
it('normalizes subject and address display formatting without removing Re prefixes', () => {
  expect(sentMatchKeys('Reader <Reader@Example.com>', ' Hello  There ', 'Body')).toEqual(sentMatchKeys('reader@example.com', 'hello there', 'Body'));
  expect(sentMatchKeys('reader@example.com', 'Re: Hello', 'Body')).not.toEqual(keys('Body'));
});
it('only removes a known configured signature as an optional matching variant', () => {
  expect(keys('Hello there\n\nBest,\nAlex', 'Best,\nAlex')).toContain(keys('Hello there')[0]);
  expect(keys('Hello there\n\nNew proposal')).not.toContain(keys('Hello there')[0]);
  expect(keys('Body is different', 'Best, Alex')).not.toContain(keys('Body')[0]);
});
it('does not match an empty body or discard differences in substantive content', () => {
  expect(keys('  ')).toEqual([]);
  expect(keys('Price is $20')).not.toEqual(keys('Price is $200'));
});
