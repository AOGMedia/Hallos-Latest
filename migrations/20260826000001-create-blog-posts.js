'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('blog_posts', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false
      },
      slug: {
        type: Sequelize.STRING(220),
        allowNull: false,
        unique: true
      },
      excerpt: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      cover_image_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('draft', 'published'),
        allowNull: false,
        defaultValue: 'draft'
      },
      author_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      published_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('blog_posts', ['status', 'published_at'], {
      name: 'blog_posts_status_published_at_idx'
    });
    await queryInterface.addIndex('blog_posts', ['author_id'], {
      name: 'blog_posts_author_id_idx'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('blog_posts');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_blog_posts_status";');
  }
};
