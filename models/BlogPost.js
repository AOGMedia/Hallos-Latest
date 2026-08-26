const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * BlogPost Model
 *
 * A single "Company" article — title, markdown body, one cover image, and an
 * excerpt used on the public listing. Deliberately no tags/categories/comments;
 * this is the minimum shape a blog needs to be usable, matching the scope of
 * the freebies/UGC content models rather than inventing a full CMS.
 */
const BlogPost = sequelize.define('BlogPost', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    validate: { notEmpty: true, len: [1, 200] }
  },
  slug: {
    type: DataTypes.STRING(220),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      is: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ // lowercase, hyphen-separated, URL-safe
    }
  },
  excerpt: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: { notEmpty: true, len: [1, 500] }
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: { notEmpty: true }
  },
  coverImageUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'cover_image_url'
  },
  status: {
    type: DataTypes.ENUM('draft', 'published'),
    allowNull: false,
    defaultValue: 'draft'
  },
  authorId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'author_id',
    references: { model: 'Users', key: 'id' }
  },
  publishedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'published_at'
  }
}, {
  tableName: 'blog_posts',
  timestamps: true,
  underscored: true
});

BlogPost.associate = (models) => {
  BlogPost.belongsTo(models.User, { foreignKey: 'authorId', as: 'author' });
};

module.exports = BlogPost;
