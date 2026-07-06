'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create departments table
    await queryInterface.createTable('departments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      slug: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // Create courses table
    await queryInterface.createTable('courses', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
      },
      department_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'departments',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      link: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      curriculum: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      duration: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      image_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      price_usd: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 35.00
      },
      price_ngn: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 50000.00
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // Create course_enrollments table
    await queryInterface.createTable('course_enrollments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      course_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'courses',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      purchase_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'purchases',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      student_name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      student_email: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      student_phone: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      credentials_sent: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      sent_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // Add indexes for better performance
    await queryInterface.addIndex('departments', ['name'], {
      name: 'idx_departments_name'
    });

    await queryInterface.addIndex('departments', ['slug'], {
      name: 'idx_departments_slug'
    });

    await queryInterface.addIndex('courses', ['department_id'], {
      name: 'idx_courses_department'
    });

    await queryInterface.addIndex('courses', ['is_active'], {
      name: 'idx_courses_active'
    });

    await queryInterface.addIndex('courses', ['name'], {
      name: 'idx_courses_name'
    });

    await queryInterface.addIndex('course_enrollments', ['user_id'], {
      name: 'idx_enrollments_user'
    });

    await queryInterface.addIndex('course_enrollments', ['course_id'], {
      name: 'idx_enrollments_course'
    });

    await queryInterface.addIndex('course_enrollments', ['purchase_id'], {
      name: 'idx_enrollments_purchase'
    });

    await queryInterface.addIndex('course_enrollments', ['credentials_sent'], {
      name: 'idx_enrollments_credentials_sent'
    });

    // Add unique constraint for user-course enrollment (prevent duplicate enrollments)
    await queryInterface.addConstraint('course_enrollments', {
      fields: ['user_id', 'course_id'],
      type: 'unique',
      name: 'unique_user_course_enrollment'
    });

    // Extend existing purchases table to support course content type
    await queryInterface.changeColumn('purchases', 'content_type', {
      type: Sequelize.ENUM('video', 'live_class', 'course'),
      allowNull: false
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove course content type from purchases table
    await queryInterface.changeColumn('purchases', 'content_type', {
      type: Sequelize.ENUM('video', 'live_class'),
      allowNull: false
    });

    // Drop tables in reverse order (due to foreign key constraints)
    await queryInterface.dropTable('course_enrollments');
    await queryInterface.dropTable('courses');
    await queryInterface.dropTable('departments');
  }
};