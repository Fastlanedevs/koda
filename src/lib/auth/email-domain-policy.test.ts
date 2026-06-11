import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getEmailDomain,
  isBlockedDisposableEmail,
  isDisposableEmailDomain,
} from './email-domain-policy';

test('getEmailDomain normalizes valid email domains', () => {
  assert.equal(getEmailDomain(' User@Example.COM. '), 'example.com');
  assert.equal(getEmailDomain('missing-at'), null);
});

test('isBlockedDisposableEmail blocks observed abusive disposable domains', () => {
  assert.equal(isBlockedDisposableEmail('yvhunu@1t-mail.com'), true);
  assert.equal(isBlockedDisposableEmail('f1y9p8brce@tempmail.jp'), true);
  assert.equal(isBlockedDisposableEmail('buv2245xf6@gdte.site'), true);
  assert.equal(isBlockedDisposableEmail('happywave23@drafterplus.nl'), true);
  assert.equal(isBlockedDisposableEmail('yoruha78@ai-debate.jp'), true);
});

test('isDisposableEmailDomain blocks common providers and subdomains', () => {
  assert.equal(isDisposableEmailDomain('mailinator.com'), true);
  assert.equal(isDisposableEmailDomain('foo.mailinator.com'), true);
  assert.equal(isDisposableEmailDomain('gmail.com'), false);
});
