const dotenv = require('dotenv');
dotenv.config();

const CouponService = require('../services/couponService');
const sequelize = require('../config/db');

/**
 * Migration script to convert hard-coded coupons to database records
 * 
 * This script creates database records for the following hard-coded coupons:
 * - FLASHDISCOUNT: 100% off for specific live series
 * - SAVEBIG10: 10,000 NGN off for specific live series
 * - KINGSLEYEXCLUSIVE: 10,000 NGN off for specific live series
 * 
 * All coupons are created as partner coupons with:
 * - Partner: Nigerian Teachers Association (from PARTNER_NIGERIAN_TEACHERS_USER_ID env)
 * - Partner commission: 17%
 * - Student discount: 3%
 */

async function migrateHardcodedCoupons() {
  const couponService = new CouponService();
  
  try {
    console.log('[Migration] Starting hard-coded coupon migration...');
    
    // Get partner user ID from environment
    const partnerUserId = process.env.PARTNER_NIGERIAN_TEACHERS_USER_ID;
    if (!partnerUserId) {
      throw new Error('PARTNER_NIGERIAN_TEACHERS_USER_ID environment variable is not set');
    }
    
    // Get promo series ID from environment
    const promoSeriesId = process.env.LIVE_SERIES_PROMO_SERIES_ID;
    if (!promoSeriesId) {
      console.warn('[Migration] LIVE_SERIES_PROMO_SERIES_ID not set, coupons will apply to all live series');
    }
    
    console.log(`[Migration] Partner User ID: ${partnerUserId}`);
    console.log(`[Migration] Promo Series ID: ${promoSeriesId || 'All live series'}`);
    
    // Admin user ID for audit logging (use 1 for system admin)
    const adminUserId = 1;
    
    // Define coupons to migrate
    const couponsToMigrate = [
      {
        code: 'FLASHDISCOUNT',
        type: 'partner',
        discountType: 'percentage',
        discountValue: 100.00,
        partnerUserId: parseInt(partnerUserId),
        partnerCommissionPercent: 17.00,
        applicableContentTypes: ['live_series'],
        specificContentIds: promoSeriesId ? [promoSeriesId] : null,
        status: 'active',
        usageLimit: null,
        startsAt: new Date('2025-01-01'),
        expiresAt: null
      },
      {
        code: 'SAVEBIG10',
        type: 'partner',
        discountType: 'flat',
        discountValue: 10000.00,
        partnerUserId: parseInt(partnerUserId),
        partnerCommissionPercent: 17.00,
        applicableContentTypes: ['live_series'],
        specificContentIds: promoSeriesId ? [promoSeriesId] : null,
        status: 'active',
        usageLimit: null,
        startsAt: new Date('2025-01-01'),
        expiresAt: null
      },
      {
        code: 'KINGSLEYEXCLUSIVE',
        type: 'partner',
        discountType: 'flat',
        discountValue: 10000.00,
        partnerUserId: parseInt(partnerUserId),
        partnerCommissionPercent: 17.00,
        applicableContentTypes: ['live_series'],
        specificContentIds: promoSeriesId ? [promoSeriesId] : null,
        status: 'active',
        usageLimit: null,
        startsAt: new Date('2025-01-01'),
        expiresAt: null
      }
    ];
    
    // Migrate each coupon
    for (const couponData of couponsToMigrate) {
      try {
        console.log(`[Migration] Creating coupon: ${couponData.code}...`);
        
        // Check if coupon already exists
        const existingCoupon = await couponService.getCouponByCode(couponData.code);
        if (existingCoupon) {
          console.log(`[Migration] ⚠️  Coupon ${couponData.code} already exists, skipping...`);
          continue;
        }
        
        // Create coupon
        const coupon = await couponService.createCoupon(couponData, adminUserId, true);
        
        console.log(`[Migration] ✅ Created coupon: ${coupon.code} (ID: ${coupon.id})`);
        console.log(`[Migration]    - Type: ${coupon.type}`);
        console.log(`[Migration]    - Discount: ${coupon.discountType === 'percentage' ? coupon.discountValue + '%' : 'NGN ' + coupon.discountValue}`);
        console.log(`[Migration]    - Partner Commission: ${coupon.partnerCommissionPercent}%`);
        console.log(`[Migration]    - Applicable to: ${coupon.applicableContentTypes.join(', ')}`);
        if (coupon.specificContentIds) {
          console.log(`[Migration]    - Specific content IDs: ${coupon.specificContentIds.join(', ')}`);
        }
        
      } catch (error) {
        console.error(`[Migration] ❌ Failed to create coupon ${couponData.code}:`, error.message);
        // Continue with next coupon
      }
    }
    
    console.log('[Migration] ✅ Hard-coded coupon migration completed successfully');
    
  } catch (error) {
    console.error('[Migration] ❌ Migration failed:', error);
    throw error;
  }
}

// Run migration if executed directly
if (require.main === module) {
  migrateHardcodedCoupons()
    .then(() => {
      console.log('[Migration] Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Migration] Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateHardcodedCoupons };
