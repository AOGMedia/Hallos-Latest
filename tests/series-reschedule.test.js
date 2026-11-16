/**
 * Changing a live series' days, start time and start date: which sessions
 * move, that join links (session ids) survive, numbering, the unique
 * (series, session number) rule, and the attendee email. Models are mocked —
 * needs no database. Dates are built in local time, like the server does.
 */

const mockSessions = [];
let mockNextId = 1;

const mockMakeSession = (fields) => {
  const row = {
    id: fields.id || `s${mockNextId++}`,
    status: 'scheduled',
    actualStartTime: null,
    reminderSent: false,
    ...fields,
    async update(changes) {
      if (
        changes.sessionNumber !== undefined &&
        mockSessions.some((o) => o !== row && o.seriesId === row.seriesId && o.sessionNumber === changes.sessionNumber)
      ) {
        throw Object.assign(new Error('duplicate session number'), { name: 'SequelizeUniqueConstraintError' });
      }
      Object.assign(row, changes);
      return row;
    }
  };
  return row;
};

jest.mock('../config/db', () => ({
  transaction: jest.fn(async (fn) => fn({})),
  query: jest.fn(async () => [])
}));
jest.mock('../models/Purchase', () => ({}));
jest.mock('../models/User', () => ({}));
jest.mock('../models/liveSeriesIndex', () => ({
  LiveSeries: { findByPk: jest.fn() },
  LiveSession: {
    findAll: jest.fn(async ({ where }) =>
      mockSessions
        .filter((s) => s.seriesId === where.seriesId)
        .sort((a, b) => new Date(a.scheduledStartTime) - new Date(b.scheduledStartTime) || a.sessionNumber - b.sessionNumber)
    ),
    // Only used by extendSeriesSessions: the highest-numbered session.
    findOne: jest.fn(async ({ where }) =>
      mockSessions
        .filter((s) => s.seriesId === where.seriesId)
        .sort((a, b) => b.sessionNumber - a.sessionNumber)[0] || null
    ),
    count: jest.fn(async ({ where }) =>
      mockSessions.filter((s) => s.seriesId === where.seriesId && (!where.status || s.status === where.status)).length
    ),
    destroy: jest.fn(async ({ where }) => {
      const ids = new Set(where.id);
      for (let i = mockSessions.length - 1; i >= 0; i -= 1) {
        if (ids.has(mockSessions[i].id)) mockSessions.splice(i, 1);
      }
    }),
    bulkCreate: jest.fn(async (rows) => {
      const created = rows.map((r) => {
        if (mockSessions.some((o) => o.seriesId === r.seriesId && o.sessionNumber === r.sessionNumber)) {
          throw Object.assign(new Error('duplicate session number'), { name: 'SequelizeUniqueConstraintError' });
        }
        return mockMakeSession(r);
      });
      mockSessions.push(...created);
      return created;
    })
  }
}));
jest.mock('../services/seriesScheduleNotifier', () => ({
  notifyScheduleChanged: jest.fn(async () => 3)
}));

const { LiveSeries } = require('../models/liveSeriesIndex');
const liveSeriesService = require('../services/liveSeriesService');
const { notifyScheduleChanged } = require('../services/seriesScheduleNotifier');
const controller = require('../controllers/liveSeriesController');

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

const makeSeries = (overrides = {}) => {
  const series = {
    id: 'series-1',
    userId: 7,
    title: 'Design Bootcamp',
    status: 'active',
    startDate: at(2026, 12, 7),
    endDate: at(2026, 12, 20),
    recurrencePattern: { days: ['monday', 'wednesday'], startTime: '19:00', duration: 60 },
    ...overrides,
    async update(changes) {
      Object.assign(series, changes);
      Object.assign(series.dataValues, changes);
      return series;
    },
    getDualPricing: () => ({})
  };
  series.dataValues = { ...series };
  return series;
};

/** Sessions exactly as creation would have made them. */
const seedFromSeries = (series) => {
  liveSeriesService.generateSessionSchedule(series).forEach((s) => mockSessions.push(mockMakeSession(s)));
};

const upcoming = () =>
  mockSessions
    .filter((s) => s.seriesId === 'series-1')
    .sort((a, b) => a.scheduledStartTime - b.scheduledStartTime);

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  mockSessions.length = 0;
  mockNextId = 1;
  jest.clearAllMocks();
});

describe('rescheduleSeries', () => {
  test('not started: new days and time move every session and keep their ids in order', async () => {
    const series = makeSeries();
    seedFromSeries(series); // Mon/Wed Dec 7–20 → 4 sessions
    const idsBefore = upcoming().map((s) => s.id);

    const result = await liveSeriesService.rescheduleSeries(series, {
      days: ['tuesday', 'thursday'],
      startTime: '18:30',
      now: at(2026, 12, 1)
    });

    const after = upcoming();
    expect(after.map((s) => s.id)).toEqual(idsBefore);
    expect(after.map((s) => s.scheduledStartTime.getTime())).toEqual([
      at(2026, 12, 8, 18, 30), at(2026, 12, 10, 18, 30), at(2026, 12, 15, 18, 30), at(2026, 12, 17, 18, 30)
    ].map((d) => d.getTime()));
    expect(after.map((s) => s.sessionNumber)).toEqual([1, 2, 3, 4]);
    expect(after[0].scheduledEndTime.getTime()).toBe(at(2026, 12, 8, 19, 30).getTime());
    expect(series.recurrencePattern).toEqual({ days: ['tuesday', 'thursday'], startTime: '18:30', duration: 60 });
    expect(result).toMatchObject({ upcomingCount: 4, created: 0, removed: 0, moved: 4 });
    expect(result.nextSession).toMatchObject({ id: idsBefore[0], sessionNumber: 1 });
  });

  test('not started: a later start date drops sessions before it; extra days add sessions', async () => {
    const series = makeSeries();
    seedFromSeries(series); // 4 sessions

    await liveSeriesService.rescheduleSeries(series, {
      days: ['monday', 'wednesday', 'friday'],
      startTime: '19:00',
      startDate: at(2026, 12, 9),
      now: at(2026, 12, 1)
    });

    const after = upcoming();
    // Wed 9, Fri 11, Mon 14, Wed 16, Fri 18
    expect(after.map((s) => s.scheduledStartTime.getDate())).toEqual([9, 11, 14, 16, 18]);
    expect(after.map((s) => s.sessionNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(series.startDate.getTime()).toBe(at(2026, 12, 9).getTime());
  });

  test('fewer sessions: the leftover ones are removed', async () => {
    const series = makeSeries({ recurrencePattern: { days: ['monday', 'tuesday', 'wednesday'], startTime: '19:00', duration: 60 } });
    seedFromSeries(series); // 6 sessions
    const firstIds = upcoming().slice(0, 2).map((s) => s.id);

    const result = await liveSeriesService.rescheduleSeries(series, {
      days: ['friday'],
      startTime: '19:00',
      now: at(2026, 12, 1)
    });

    expect(upcoming().map((s) => s.id)).toEqual(firstIds);
    expect(upcoming().map((s) => s.scheduledStartTime.getDate())).toEqual([11, 18]);
    expect(result).toMatchObject({ upcomingCount: 2, removed: 4, created: 0 });
  });

  test('already started: past and ended sessions stay; upcoming ones move and are numbered on', async () => {
    const series = makeSeries();
    seedFromSeries(series); // Mon 7, Wed 9, Mon 14, Wed 16
    const [first, second] = upcoming();
    first.status = 'ended';
    first.actualStartTime = at(2026, 12, 7, 19, 2);
    second.reminderSent = true; // Wed 9 — still ahead at "now"

    await liveSeriesService.rescheduleSeries(series, {
      days: ['thursday'],
      startTime: '20:00',
      now: at(2026, 12, 8, 12)
    });

    const after = upcoming();
    expect(after[0]).toBe(first);
    expect(first.scheduledStartTime.getTime()).toBe(at(2026, 12, 7, 19).getTime());
    expect(first.sessionNumber).toBe(1);
    // Thu 10 and Thu 17, numbered 2 and 3, reusing the next two ids
    expect(after.slice(1).map((s) => s.scheduledStartTime.getTime())).toEqual([
      at(2026, 12, 10, 20).getTime(), at(2026, 12, 17, 20).getTime()
    ]);
    expect(after.slice(1).map((s) => s.sessionNumber)).toEqual([2, 3]);
    expect(after[1]).toBe(second);
    expect(second.reminderSent).toBe(false);
  });

  test('already started: no second class on a day one already ran', async () => {
    const series = makeSeries();
    seedFromSeries(series);
    const [first] = upcoming();
    first.status = 'ended';
    first.actualStartTime = at(2026, 12, 7, 19);

    // Mon 7, 20:30, after the class ended early: moving to 21:00 Mondays
    await liveSeriesService.rescheduleSeries(series, {
      days: ['monday'],
      startTime: '21:00',
      now: at(2026, 12, 7, 20, 30)
    });

    const days = upcoming().filter((s) => s !== first).map((s) => s.scheduledStartTime.getDate());
    expect(days).toEqual([14]);
  });

  test('renumbering never collides on the unique (series, number) index', async () => {
    const series = makeSeries();
    seedFromSeries(series);
    const [first] = upcoming();
    first.status = 'ended';
    first.actualStartTime = at(2026, 12, 7, 19);
    // Out-of-order numbers (e.g. from an older extension) force real renumbering.
    const rest = upcoming().slice(1);
    rest[0].sessionNumber = 4;
    rest[2].sessionNumber = 2;

    await expect(
      liveSeriesService.rescheduleSeries(series, { days: ['monday', 'wednesday'], startTime: '07:00', now: at(2026, 12, 8) })
    ).resolves.toBeDefined();
    expect(upcoming().map((s) => s.sessionNumber)).toEqual([1, 2, 3, 4]);
  });

  test('refuses while a session is live', async () => {
    const series = makeSeries();
    seedFromSeries(series);
    upcoming()[0].status = 'live';
    await expect(
      liveSeriesService.rescheduleSeries(series, { days: ['friday'], startTime: '19:00', now: at(2026, 12, 7, 19, 30) })
    ).rejects.toMatchObject({ code: 'SESSION_LIVE' });
  });

  test('refuses a new start date once a session has run', async () => {
    const series = makeSeries();
    seedFromSeries(series);
    upcoming()[0].status = 'ended';
    await expect(
      liveSeriesService.rescheduleSeries(series, {
        days: ['monday'], startTime: '19:00', startDate: at(2026, 12, 14), now: at(2026, 12, 8)
      })
    ).rejects.toMatchObject({ code: 'ALREADY_STARTED' });
  });

  test('refuses a change that leaves no sessions, and changes nothing', async () => {
    const series = makeSeries({ startDate: at(2026, 12, 7), endDate: at(2026, 12, 8) });
    seedFromSeries(series); // Mon 7 only
    const before = upcoming().map((s) => [s.id, s.scheduledStartTime.getTime()]);

    await expect(
      liveSeriesService.rescheduleSeries(series, { days: ['friday'], startTime: '19:00', now: at(2026, 12, 1) })
    ).rejects.toMatchObject({ code: 'NO_SESSIONS' });
    expect(upcoming().map((s) => [s.id, s.scheduledStartTime.getTime()])).toEqual(before);
    expect(series.recurrencePattern.days).toEqual(['monday', 'wednesday']);
  });

  test('a later end date in the same change covers the extended weeks', async () => {
    const series = makeSeries();
    seedFromSeries(series);
    await liveSeriesService.rescheduleSeries(series, {
      days: ['monday'],
      startTime: '19:00',
      endDate: at(2026, 12, 28),
      now: at(2026, 12, 1)
    });
    expect(upcoming().map((s) => s.scheduledStartTime.getDate())).toEqual([7, 14, 21, 28]);
    expect(series.endDate.getTime()).toBe(at(2026, 12, 28).getTime());
  });
});

describe('updateSeries (PUT /api/live/series/:id)', () => {
  const run = async (series, body) => {
    LiveSeries.findByPk.mockResolvedValue(series);
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await controller.updateSeries({ params: { id: series.id }, user: { id: series.userId }, body }, res);
    return res;
  };

  // A series far enough ahead that "today" never interferes.
  const futureSeries = () => {
    const y = new Date().getFullYear() + 1;
    return makeSeries({
      startDate: new Date(Date.UTC(y, 2, 2)),
      endDate: new Date(Date.UTC(y, 2, 30)),
      recurrencePattern: { days: ['monday', 'wednesday'], startTime: '19:00', duration: 60 }
    });
  };

  test('the form sending back the current schedule and end date is not a change', async () => {
    const series = futureSeries();
    seedFromSeries(series);
    const before = upcoming().map((s) => s.scheduledStartTime.getTime());

    const res = await run(series, {
      title: 'Design Bootcamp II',
      endDate: series.endDate.toISOString().slice(0, 10),
      startDate: series.startDate.toISOString().slice(0, 10),
      recurrencePattern: { days: ['wednesday', 'monday'], startTime: '19:00' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(series.title).toBe('Design Bootcamp II');
    expect(upcoming().map((s) => s.scheduledStartTime.getTime())).toEqual(before);
    expect(notifyScheduleChanged).not.toHaveBeenCalled();
  });

  test('a schedule change moves sessions, saves other fields and tells attendees', async () => {
    const series = futureSeries();
    seedFromSeries(series);

    const res = await run(series, {
      title: 'Renamed',
      recurrencePattern: JSON.stringify({ days: ['friday'], startTime: '08:00' })
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.rescheduled).toMatchObject({ attendeesNotified: 3 });
    expect(res.body.message).toMatch(/3 attendees will get an email/);
    expect(series.title).toBe('Renamed');
    expect(series.recurrencePattern).toMatchObject({ days: ['friday'], startTime: '08:00', duration: 60 });
    expect(upcoming().every((s) => s.scheduledStartTime.getDay() === 5 && s.scheduledStartTime.getHours() === 8)).toBe(true);
    expect(notifyScheduleChanged).toHaveBeenCalledWith(series, expect.objectContaining({ sessionNumber: 1 }));
  });

  test('the save still succeeds when notifying fails', async () => {
    const series = futureSeries();
    seedFromSeries(series);
    notifyScheduleChanged.mockRejectedValueOnce(new Error('smtp down'));
    jest.spyOn(console, 'error').mockImplementationOnce(() => {});

    const res = await run(series, { recurrencePattern: { days: ['friday'], startTime: '19:00' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Schedule updated.');
  });

  test.each([
    [{ recurrencePattern: { days: [] } }, /at least one day/],
    [{ recurrencePattern: { days: ['funday'] } }, /Invalid day/],
    [{ recurrencePattern: { startTime: '25:00' } }, /HH:MM/],
    [{ recurrencePattern: '{bad json' }, /Invalid schedule format/],
    [{ startDate: '2001-01-01' }, /24 hours in the past/]
  ])('rejects bad input %j', async (body, message) => {
    const series = futureSeries();
    seedFromSeries(series);
    const res = await run(series, body);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(message);
  });

  test('a start date on or after the end date is rejected', async () => {
    const series = futureSeries();
    seedFromSeries(series);
    const res = await run(series, { startDate: series.endDate.toISOString().slice(0, 10) });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/before the end date/);
  });

  test('a live session blocks a schedule change with 409', async () => {
    const series = futureSeries();
    seedFromSeries(series);
    upcoming()[0].status = 'live';
    const res = await run(series, { recurrencePattern: { days: ['friday'] } });
    expect(res.statusCode).toBe(409);
  });

  test('a cancelled series cannot be rescheduled', async () => {
    const series = futureSeries();
    series.status = 'cancelled';
    seedFromSeries(series);
    const res = await run(series, { recurrencePattern: { startTime: '10:00' } });
    expect(res.statusCode).toBe(400);
  });

  test('shortening the end date is still refused', async () => {
    const series = futureSeries();
    seedFromSeries(series);
    const earlier = new Date(series.endDate.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const res = await run(series, { endDate: earlier });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/only be extended/);
  });

  test('extending only the end date still adds sessions the old way', async () => {
    const series = futureSeries();
    seedFromSeries(series);
    const count = upcoming().length;
    const later = new Date(series.endDate.getTime() + 14 * 86400000).toISOString().slice(0, 10);
    const res = await run(series, { endDate: later });
    expect(res.statusCode).toBe(200);
    expect(res.body.newSessionsCount).toBe(4);
    expect(upcoming().length).toBe(count + 4);
    expect(notifyScheduleChanged).not.toHaveBeenCalled();
  });
});
