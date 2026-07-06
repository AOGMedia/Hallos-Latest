const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/db');

const CourseEnrollment = sequelize.define('CourseEnrollment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id',
    validate: {
      notEmpty: true,
      isInt: true
    }
  },
  courseId: {
    type: DataTypes.UUID,
    allowNull: true,  // ✅ Changed to nullable for monthly/yearly access
    field: 'course_id',
    validate: {
      isUUID: 4
    }
  },
  purchaseId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'purchase_id',
    validate: {
      notEmpty: true
    }
  },
  studentName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'student_name',
    validate: {
      notEmpty: true,
      len: [1, 255]
    }
  },
  studentEmail: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'student_email',
    validate: {
      notEmpty: true,
      isEmail: true,
      len: [1, 255]
    }
  },
  studentPhone: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'student_phone',
    validate: {
      notEmpty: true,
      len: [1, 50]
    }
  },
  // ✅ NEW: Access type field
  accessType: {
    type: DataTypes.ENUM('individual', 'monthly', 'yearly'),
    allowNull: false,
    defaultValue: 'individual',
    field: 'access_type',
    validate: {
      isIn: [['individual', 'monthly', 'yearly']]
    }
  },
  // ✅ NEW: Expiry date field
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'expires_at',
    comment: 'Expiry date for monthly/yearly access. NULL for individual courses'
  },
  credentialsSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'credentials_sent'
  },
  sentBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'sent_by',
    validate: {
      isInt: true
    }
  },
  sentAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'sent_at'
  },
}, {
  tableName: 'course_enrollments',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeUpdate: (enrollment) => {
      // Auto-set sentAt timestamp when credentialsSent is toggled to true
      if (enrollment.changed('credentialsSent') && enrollment.credentialsSent === true) {
        enrollment.sentAt = new Date();
      }
      // Clear sentAt if credentialsSent is toggled to false
      if (enrollment.changed('credentialsSent') && enrollment.credentialsSent === false) {
        enrollment.sentAt = null;
        enrollment.sentBy = null;
      }
    }
  },
  scopes: {
    pending: {
      where: { credentialsSent: false }
    },
    completed: {
      where: { credentialsSent: true }
    },
    // ✅ NEW: Scope for expired enrollments
    expired: {
      where: {
        accessType: ['monthly', 'yearly'],
        expiresAt: {
          [Op.lt]: new Date()
        }
      }
    },
    // ✅ NEW: Scope for active subscriptions
    activeSubscriptions: {
      where: {
        accessType: ['monthly', 'yearly'],
        expiresAt: {
          [Op.gt]: new Date()
        }
      }
    },
    // ✅ NEW: Scope for expiring soon (within 7 days)
    expiringSoon: {
      where: {
        accessType: ['monthly', 'yearly'],
        expiresAt: {
          [Op.between]: [
            new Date(),
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          ]
        }
      }
    },
    withDetails: {
      include: [
        {
          model: sequelize.models.Course,
          as: 'course',
          required: false,  // ✅ Changed to false for monthly/yearly (no course)
          include: [{
            model: sequelize.models.Department,
            as: 'department'
          }]
        },
        {
          model: sequelize.models.User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email']
        },
        {
          model: sequelize.models.Purchase,
          as: 'purchase',
          attributes: ['id', 'amount', 'currency', 'paymentGateway', 'paymentReference', 'createdAt']
        }
      ]
    }
  }
});

// Instance methods
CourseEnrollment.prototype.markCredentialsSent = async function(adminId) {
  this.credentialsSent = true;
  this.sentBy = adminId;
  this.sentAt = new Date();
  return await this.save();
};

CourseEnrollment.prototype.markCredentialsNotSent = async function() {
  this.credentialsSent = false;
  this.sentBy = null;
  this.sentAt = null;
  return await this.save();
};

CourseEnrollment.prototype.getStudentDetails = function() {
  return {
    name: this.studentName,
    email: this.studentEmail,
    phone: this.studentPhone
  };
};

// ✅ NEW: Check if enrollment is expired
CourseEnrollment.prototype.isExpired = function() {
  if (!this.expiresAt) return false; // Individual courses never expire
  return new Date() > new Date(this.expiresAt);
};

// ✅ NEW: Get days until expiry
CourseEnrollment.prototype.getDaysUntilExpiry = function() {
  if (!this.expiresAt) return null; // Individual courses never expire
  const now = new Date();
  const expiry = new Date(this.expiresAt);
  const diffTime = expiry - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

// ✅ NEW: Get access description
CourseEnrollment.prototype.getAccessDescription = function() {
  const descriptions = {
    individual: 'Individual Course',
    monthly: 'Monthly All-Access',
    yearly: 'Yearly All-Access'
  };
  return descriptions[this.accessType] || this.accessType;
};

CourseEnrollment.prototype.toJSON = function() {
  const values = Object.assign({}, this.get());
  
  // Add computed fields
  values.studentDetails = this.getStudentDetails();
  values.isExpired = this.isExpired();
  values.daysUntilExpiry = this.getDaysUntilExpiry();
  values.accessDescription = this.getAccessDescription();
  
  return values;
};

// Class methods
CourseEnrollment.findPendingForAdmin = function(options = {}) {
  return this.scope(['pending', 'withDetails']).findAll({
    order: [['createdAt', 'DESC']],
    ...options
  });
};

CourseEnrollment.findCompletedForAdmin = function(options = {}) {
  return this.scope(['completed', 'withDetails']).findAll({
    order: [['sentAt', 'DESC']],
    ...options
  });
};

CourseEnrollment.findByUser = function(userId, options = {}) {
  return this.scope('withDetails').findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    ...options
  });
};

CourseEnrollment.findByCourse = function(courseId, options = {}) {
  return this.scope('withDetails').findAll({
    where: { courseId },
    order: [['createdAt', 'DESC']],
    ...options
  });
};

CourseEnrollment.getStatistics = async function() {
  const [totalEnrollments, pendingEnrollments, completedEnrollments] = await Promise.all([
    this.count(),
    this.count({ where: { credentialsSent: false } }),
    this.count({ where: { credentialsSent: true } })
  ]);

  return {
    total: totalEnrollments,
    pending: pendingEnrollments,
    completed: completedEnrollments,
    completionRate: totalEnrollments > 0 ? (completedEnrollments / totalEnrollments * 100).toFixed(2) : 0
  };
};

module.exports = CourseEnrollment;