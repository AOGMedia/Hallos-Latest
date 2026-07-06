const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Coupon = sequelize.define('Coupon', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    validate: {
      len: [3, 50],
      isAlphanumericWithHyphens(value) {
        if (!/^[A-Z0-9-]+$/i.test(value)) {
          throw new Error('Coupon code must contain only alphanumeric characters and hyphens');
        }
      }
    },
    set(value) {
      // Always store in uppercase
      this.setDataValue('code', value.toUpperCase().trim());
    }
  },
  type: {
    type: DataTypes.ENUM('partner', 'creator'),
    allowNull: false
  },
  discountType: {
    type: DataTypes.ENUM('percentage', 'flat'),
    allowNull: false,
    field: 'discount_type'
  },
  discountValue: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'discount_value',
    validate: {
      min: 0
    }
  },
  partnerUserId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'partner_user_id'
  },
  partnerCommissionPercent: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    field: 'partner_commission_percent',
    validate: {
      min: 0,
      max: 100
    }
  },
  creatorId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'creator_id'
  },
  applicableContentTypes: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: false,
    field: 'applicable_content_types',
    defaultValue: []
  },
  specificContentIds: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: true,
    field: 'specific_content_ids'
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'expired'),
    allowNull: false,
    defaultValue: 'active'
  },
  usageLimit: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'usage_limit',
    validate: {
      min: 1
    }
  },
  usageCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'usage_count'
  },
  startsAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'starts_at'
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'expires_at'
  }
}, {
  tableName: 'coupons',
  timestamps: true,
  underscored: true,
  validate: {
    validPartnerCoupon() {
      if (this.type === 'partner') {
        if (!this.partnerUserId || !this.partnerCommissionPercent) {
          throw new Error('Partner coupons must have partner_user_id and partner_commission_percent');
        }
        if (this.creatorId) {
          throw new Error('Partner coupons cannot have creator_id');
        }
      }
    },
    validCreatorCoupon() {
      if (this.type === 'creator') {
        if (!this.creatorId) {
          throw new Error('Creator coupons must have creator_id');
        }
        if (this.partnerUserId || this.partnerCommissionPercent) {
          throw new Error('Creator coupons cannot have partner_user_id or partner_commission_percent');
        }
      }
    },
    validDateRange() {
      if (this.startsAt && this.expiresAt && this.startsAt >= this.expiresAt) {
        throw new Error('starts_at must be before expires_at');
      }
    },
    validPercentageDiscount() {
      if (this.discountType === 'percentage' && (this.discountValue < 0 || this.discountValue > 100)) {
        throw new Error('Percentage discount must be between 0 and 100');
      }
    }
  }
});

// Instance methods
Coupon.prototype.isActive = function() {
  return this.status === 'active';
};

Coupon.prototype.isExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > new Date(this.expiresAt);
};

Coupon.prototype.hasStarted = function() {
  if (!this.startsAt) return true;
  return new Date() >= new Date(this.startsAt);
};

Coupon.prototype.isWithinDateRange = function() {
  return this.hasStarted() && !this.isExpired();
};

Coupon.prototype.hasReachedUsageLimit = function() {
  if (!this.usageLimit) return false;
  return this.usageCount >= this.usageLimit;
};

Coupon.prototype.canBeUsed = function() {
  return this.isActive() && this.isWithinDateRange() && !this.hasReachedUsageLimit();
};

Coupon.prototype.isPartnerCoupon = function() {
  return this.type === 'partner';
};

Coupon.prototype.isCreatorCoupon = function() {
  return this.type === 'creator';
};

Coupon.prototype.appliesToContentType = function(contentType) {
  return this.applicableContentTypes.includes(contentType);
};

Coupon.prototype.appliesToContentId = function(contentId) {
  if (!this.specificContentIds || this.specificContentIds.length === 0) {
    return true; // No specific content restriction
  }
  return this.specificContentIds.includes(contentId);
};

module.exports = Coupon;
