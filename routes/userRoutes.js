const express = require('express');
const router = express.Router();
const { getUserInfo } = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/me', authMiddleware, getUserInfo);

module.exports = router;

