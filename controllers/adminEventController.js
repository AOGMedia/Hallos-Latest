const featuredEvent = require('../services/featuredEventService');

/**
 * Admin: the featured event page (/events) and its registrations.
 * Saving is logged by the staff action log like every other change; the
 * registrations export is a read, so it's recorded here explicitly.
 */
const fail = (res, error, what) => {
  if (error instanceof featuredEvent.FeaturedEventError) {
    return res.status(error.status).json({ success: false, message: error.message, field: error.field });
  }
  console.error(`[Admin Event] ${what} failed:`, error);
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};

exports.getEvent = async (req, res) => {
  try {
    return res.json({ success: true, data: await featuredEvent.getForAdmin() });
  } catch (error) {
    return fail(res, error, 'Loading the event');
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const data = await featuredEvent.update(req.body?.content, req.user);
    return res.json({ success: true, message: 'Event page saved.', data });
  } catch (error) {
    return fail(res, error, 'Saving the event');
  }
};

exports.listRegistrations = async (req, res) => {
  try {
    const { status, search, page, limit } = req.query;
    return res.json({ success: true, data: await featuredEvent.listRegistrations({ status, search, page, limit }) });
  } catch (error) {
    return fail(res, error, 'Listing registrations');
  }
};

exports.exportRegistrations = async (req, res) => {
  try {
    const { status, search } = req.query;
    const { csv, count } = await featuredEvent.exportRegistrationsCsv({ status, search });
    if (require('../utils/ensureAdminFoundations').isAdminFoundationsReady()) {
      require('../config/db')
        .query(
          `INSERT INTO admin_action_log (actor_id, actor_role, method, path, status, details, ip, user_agent)
           VALUES (:actorId, :actorRole, 'GET', :path, 200, CAST(:details AS JSONB), :ip, :userAgent)`,
          {
            replacements: {
              actorId: req.user.id,
              actorRole: req.user.role || null,
              path: req.originalUrl.split('?')[0].slice(0, 500),
              details: JSON.stringify({ action: 'event_registrations_export', count, status: status || null, search: search ? String(search).slice(0, 100) : null }),
              ip: String(req.ip || '').slice(0, 64) || null,
              userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
            },
          }
        )
        .catch((error) => console.warn('[StaffActionLog] Could not record the registrations export:', error.message));
    }
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="event-registrations-${day}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(csv);
  } catch (error) {
    return fail(res, error, 'Exporting registrations');
  }
};
