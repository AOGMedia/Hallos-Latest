const { validationResult } = require('express-validator');
const Registration = require('../models/registrationModel');
const { 
  sendEventRegistrationEmail, 
  sendhallosWelcomeEmail 
} = require('../utils/email');

exports.register = async (req, res) => {
  console.log('Received registration request:', req.body);

  const { role, firstname, lastname, email, location, phone } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  if (!firstname) {
    return res.status(400).json({ message: 'Firstname is required.' });
  }

  if (!phone) {
    return res.status(400).json({ message: 'Phone number is required.' });
  }

  try {
    const existingRegistration = await Registration.findOne({ where: { email } });
    if (existingRegistration) {
      return res.status(400).json({ message: 'This email is already registered.' });
    }

    const newRegistration = await Registration.create({
      role: role || 'Guest',
      firstname,
      lastname,
      email,
      location,
      phone,
    });

    await sendEventRegistrationEmail(email, firstname);
    await sendhallosWelcomeEmail(email, firstname);

    res.status(201).json({
      message: 'Registration successful. Emails sent.',
      registration: newRegistration,
    });
  } catch (error) {
    console.error('Registration or Email Error:', error);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};


exports.getRegistrations = async (req, res) => {
  try {
    const registrations = await Registration.findAll();

    if (registrations.length === 0) {
      return res.status(404).json({ message: 'No registrations found.' });
    }

    res.json({ registrations });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};