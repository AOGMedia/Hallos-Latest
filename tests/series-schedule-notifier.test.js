/**
 * Emailing attendees when a series' schedule changes: who gets it, and that a
 * failing send never throws back into the creator's save. No database or mail.
 */

jest.mock('../services/notificationService', () => ({ getEnrolledStudents: jest.fn() }));
jest.mock('../utils/email', () => ({ sendSeriesScheduleChangedEmail: jest.fn() }));

const notificationService = require('../services/notificationService');
const { sendSeriesScheduleChangedEmail } = require('../utils/email');
const { notifyScheduleChanged } = require('../services/seriesScheduleNotifier');

const series = {
  id: 'series-1',
  userId: 7,
  title: 'Design Bootcamp',
  recurrencePattern: { days: ['friday'], startTime: '08:00', duration: 60 }
};
const next = { sessionNumber: 3, scheduledStartTime: new Date('2026-12-11T08:00:00Z') };
const flush = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('emails every enrolled person except the creator and anyone without an email', async () => {
  notificationService.getEnrolledStudents.mockResolvedValue([
    { id: 1, email: 'a@example.com', firstname: 'Ada' },
    { id: 7, email: 'creator@example.com', firstname: 'Creator' },
    { id: 2, email: null, firstname: 'NoMail' },
    ...Array.from({ length: 11 }, (_, i) => ({ id: 100 + i, email: `p${i}@example.com`, firstname: 'P' }))
  ]);
  sendSeriesScheduleChangedEmail.mockResolvedValue();

  await expect(notifyScheduleChanged(series, next)).resolves.toBe(12);
  await flush();
  for (let i = 0; i < 5; i += 1) await flush();

  expect(sendSeriesScheduleChangedEmail).toHaveBeenCalledTimes(12);
  expect(sendSeriesScheduleChangedEmail).toHaveBeenCalledWith('a@example.com', 'Ada', {
    seriesId: 'series-1',
    seriesTitle: 'Design Bootcamp',
    days: ['friday'],
    nextSessionStart: next.scheduledStartTime,
    nextSessionNumber: 3
  });
  expect(sendSeriesScheduleChangedEmail).not.toHaveBeenCalledWith('creator@example.com', expect.anything(), expect.anything());
});

test('a failed email is logged and the rest still go', async () => {
  notificationService.getEnrolledStudents.mockResolvedValue([
    { id: 1, email: 'a@example.com', firstname: 'A' },
    { id: 2, email: 'b@example.com', firstname: 'B' }
  ]);
  sendSeriesScheduleChangedEmail.mockRejectedValueOnce(new Error('smtp down')).mockResolvedValueOnce();

  await expect(notifyScheduleChanged(series, next)).resolves.toBe(2);
  await flush();
  expect(sendSeriesScheduleChangedEmail).toHaveBeenCalledTimes(2);
});

test('nobody enrolled: nothing is sent', async () => {
  notificationService.getEnrolledStudents.mockResolvedValue([]);
  await expect(notifyScheduleChanged(series, next)).resolves.toBe(0);
  await flush();
  expect(sendSeriesScheduleChangedEmail).not.toHaveBeenCalled();
});

test('the email escapes the creator-written title', async () => {
  jest.unmock('../utils/email');
  jest.resetModules();
  jest.doMock('../services/mailTransport', () => ({ sendMail: jest.fn() }));
  const transport = require('../services/mailTransport');
  const email = jest.requireActual('../utils/email');

  await email.sendSeriesScheduleChangedEmail('a@example.com', 'Ada', {
    seriesId: 'series-1',
    seriesTitle: '<script>x</script> Bootcamp',
    days: ['wednesday', 'monday'],
    nextSessionStart: next.scheduledStartTime,
    nextSessionNumber: 3
  });

  const { html, subject } = transport.sendMail.mock.calls[0][0];
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('Mondays and Wednesdays');
  expect(html).toContain('Friday, December 11, 2026, 08:00 AM UTC');
  expect(subject).toBe('Schedule update: <script>x</script> Bootcamp');
});
