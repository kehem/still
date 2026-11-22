import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('node:net', async original => ({ ...await original<typeof import('node:net')>(), createConnection: mocks.connect }));
import { probeRecipient } from './recipient-check';
let socket: EventEmitter & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
beforeEach(() => {
  socket = Object.assign(new EventEmitter(), { write: vi.fn(), destroy: vi.fn() });
  mocks.connect.mockReturnValue(socket);
});
afterEach(() => vi.useRealTimers());
const reply = (value: string) => socket.emit('data', Buffer.from(value));
it('handles multiline EHLO and accepts RCPT without ever sending DATA', async () => {
  const check = probeRecipient('8.8.8.8', 'person@example.com');
  reply('220 ready\r\n'); reply('250-server\r\n250 PIPELINING\r\n'); reply('250 sender ok\r\n'); reply('250 recipient accepted\r\n'); reply('550 5.1.1 unknown test mailbox\r\n');
  expect((await check).status).toBe('valid');
  expect(socket.write.mock.calls.slice(0, 3).map(call => call[0])).toEqual(['EHLO still.invalid\r\n', 'MAIL FROM:<>\r\n', 'RCPT TO:<person@example.com>\r\n']);
  expect(socket.write.mock.calls[3][0]).toMatch(/^RCPT TO:<still-check-[a-f0-9-]+@example\.com>\r\n$/);
  expect(socket.write.mock.calls.some(call => String(call[0]).startsWith('DATA'))).toBe(false);
  expect(socket.destroy).toHaveBeenCalled();
});
it('falls back to HELO for servers without EHLO support', async () => {
  const check = probeRecipient('8.8.8.8', 'person@example.com');
  reply('220 ready\r\n'); reply('502 not implemented\r\n'); reply('250 hello\r\n'); reply('250 sender ok\r\n'); reply('250 accepted\r\n'); reply('550 5.1.1 unknown test mailbox\r\n');
  expect((await check).status).toBe('valid');
  expect(socket.write).toHaveBeenCalledWith('HELO still.invalid\r\n');
});
it('distinguishes nonexistent mailboxes from policy blocks and greylisting', async () => {
  for (const [response, status] of [['550 5.1.1 No such user', 'invalid'], ['550 5.7.1 Policy rejected', 'unknown'], ['451 Try later', 'unknown'], ['252 Cannot verify', 'unknown']]) {
    const check = probeRecipient('8.8.8.8', 'person@example.com');
    reply('220 ready\r\n'); reply('250 hello\r\n'); reply('250 sender ok\r\n'); reply(`${response}\r\n`);
    expect((await check).status).toBe(status);
  }
});
it('bounds stalled SMTP checks and closes the connection', async () => {
  vi.useFakeTimers();
  const check = probeRecipient('8.8.8.8', 'person@example.com', 1000);
  await vi.advanceTimersByTimeAsync(1000);
  expect((await check).status).toBe('unknown');
  expect(socket.destroy).toHaveBeenCalled();
});

it('classifies catch-all acceptance as sendable but not mailbox-verified', async () => {
  const check = probeRecipient('8.8.8.8', 'person@example.com');
  reply('220 ready\r\n'); reply('250 hello\r\n'); reply('250 sender ok\r\n'); reply('250 accepted\r\n'); reply('250 also accepted\r\n');
  const result = await check;
  expect(result.status).toBe('catch_all');
  expect(result.detail).toContain('unverified');
  expect(socket.write.mock.calls.some(call => String(call[0]).startsWith('DATA'))).toBe(false);
});
it('retains real recipient acceptance if the catch-all probe times out', async () => {
  vi.useFakeTimers();
  const check = probeRecipient('8.8.8.8', 'person@example.com', 1000);
  reply('220 ready\r\n'); reply('250 hello\r\n'); reply('250 sender ok\r\n'); reply('250 accepted\r\n');
  await vi.advanceTimersByTimeAsync(1000);
  expect((await check).status).toBe('valid');
});
