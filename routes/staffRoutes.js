const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const controller = require('../controllers/staffController');
const authMiddleware = require('../middleware/authMiddleware');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');

const router = express.Router();

const setPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
  keyGenerator: (req) => ipKeyGenerator(req.ip || '127.0.0.1'),
});

// Public: the token in the invite link is the credential.
router.post('/set-password', setPasswordLimiter, controller.setPassword);

router.use(authMiddleware);
router.get('/me', controller.me);

// Granting access is for super admins only, and is never a grantable permission.
router.use(requireSuperAdmin);

router.get('/permissions', controller.permissions);
router.get('/activity', controller.activity);

router.get('/roles', controller.listRoles);
router.post('/roles', controller.createRole);
router.put('/roles/:id', controller.updateRole);
router.delete('/roles/:id', controller.deleteRole);

router.get('/members', controller.listStaff);
router.post('/members', controller.addMember);
router.put('/members/:userId', controller.updateMemberRole);
router.delete('/members/:userId', controller.removeMember);
router.post('/members/:userId/resend-invite', controller.resendInvite);

module.exports = router;
