// This route is for the enugu summit sha

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const registrationController = require('../controllers/registrationController');

// Validation for form fields
router.post('/register', [
  body('firstname').not().isEmpty().withMessage('First name is required'),
  body('lastname').not().isEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Invalid email address'),
  body('location').not().isEmpty().withMessage('Location is required'),
], registrationController.register);

router.get('/registrations', registrationController.getRegistrations);

module.exports = router;