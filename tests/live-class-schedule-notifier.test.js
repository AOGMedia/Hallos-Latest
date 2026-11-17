/**
 * Emailing a live class's attendees when its time changes. No database or mail.
 */

jest.mock('../services/notificationService', () => ({ getLiveClassStudents: jest.fn() }));
jest.mock('../utils/email', () => ({ sendLiveClassRescheduledEmail: jest.fn() }));

const notificationService = require('../services/notificationService');
const { sendLiveClassRescheduledEmail } = require('../utils/email');
const { notifyLiveClassRescheduled } = require('../services/liveClassScheduleNotifier');

const liveClass = {
  id: 'class-1',
  userId: 7,
  title: 'Intro to Figma',
  startTime: new Date('2026-12-11T19:00:00Z'),
  endTime: new Date('2026-12-11T20:30:00Z')
};
const flush = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('emails registered and paid attendees, not the creator', async () => {
  notificationService.getLiveClassStudents.mockResolvedValue([
    { id: 1, email: 'a@example.com', firstname: 'Ada' },
    { id: 7, email: 'creator@example.com', firstname: 'Creator' },
    { id: 3, email: '', firstname: 'NoMail' }
  ]);
  sendLiveClassRescheduledEmail.mockResolvedValue();

  await expect(notifyLiveClassRescheduled(liveClass)).resolves.toBe(1);
  await flush();
  expect(sendLiveClassRescheduledEmail).toHaveBeenCalledTimes(1);
  expect(sendLiveClassRescheduledEmail).toHaveBeenCalledWith('a@example.com', 'Ada', {
    liveClassId: 'class-1',
    title: 'Intro to Figma',
    startTime: liveClass.startTime,
    endTime: liveClass.endTime
  });
});

test('nobody registered: nothing sent; lookup failure: 0, no throw', async () => {
  notificationService.getLiveClassStudents.mockResolvedValueOnce([]);
  await expect(notifyLiveClassRescheduled(liveClass)).resolves.toBe(0);
  notificationService.getLiveClassStudents.mockRejectedValueOnce(new Error('db down'));
  await expect(notifyLiveClassRescheduled(liveClass)).resolves.toBe(0);
  await flush();
  expect(sendLiveClassRescheduledEmail).not.toHaveBeenCalled();
});

test('the email shows the time as set and escapes the title', async () => {
  jest.resetModules();
  jest.doMock('../services/mailTransport', () => ({ sendMail: jest.fn() }));
  const transport = require('../services/mailTransport');
  const email = jest.requireActual('../utils/email');

  await email.sendLiveClassRescheduledEmail('a@example.com', 'Ada', {
    liveClassId: 'class-1',
    title: '<b>Figma</b>',
    startTime: liveClass.startTime,
    endTime: liveClass.endTime
  });

  const { html, subject } = transport.sendMail.mock.calls[0][0];
  expect(html).toContain('Friday, December 11, 2026, 7:00 PM to 8:30 PM');
  expect(html).toContain('&lt;b&gt;Figma&lt;/b&gt;');
  expect(html).not.toContain('<b>Figma</b>');
  expect(html).toContain('/live/class-1');
  expect(subject).toBe('New time: <b>Figma</b>');
});
