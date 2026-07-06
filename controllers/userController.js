const User = require('../models/User');

exports.getUserInfo = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findByPk(userId, {
      attributes: ['id', 'firstname', 'lastname', 'email', 'role', 'createdAt']
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      userId: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

