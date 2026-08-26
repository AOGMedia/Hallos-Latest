const { Op } = require('sequelize');
const BlogPost = require('../models/BlogPost');
const User = require('../models/User');

const PUBLIC_ATTRIBUTES = [
  'id', 'title', 'slug', 'excerpt', 'body', 'coverImageUrl',
  'status', 'authorId', 'publishedAt', 'createdAt', 'updatedAt'
];

function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

/** Attach a short numeric suffix if the base slug is already taken. Excludes
 *  the post being edited so re-saving a post under its own title doesn't
 *  needlessly bump its slug. */
async function uniqueSlug(baseSlug, excludeId = null) {
  let slug = baseSlug || 'post';
  let suffix = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where = { slug };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    const existing = await BlogPost.findOne({ where, attributes: ['id'] });
    if (!existing) return slug;
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }
}

async function attachAuthorNames(posts) {
  const authorIds = [...new Set(posts.map((p) => p.authorId))];
  if (authorIds.length === 0) return posts;

  const authors = await User.findAll({
    where: { id: { [Op.in]: authorIds } },
    attributes: ['id', 'firstname', 'lastname']
  });
  const byId = new Map(authors.map((a) => [a.id, `${a.firstname ?? ''} ${a.lastname ?? ''}`.trim()]));

  return posts.map((p) => ({ ...p, authorName: byId.get(p.authorId) || null }));
}

class BlogService {
  /**
   * Public listing — published posts only, newest first. `page`/`limit`
   * mirror the pagination shape used across the rest of the quiz/freebies
   * APIs so the frontend's existing pagination components work unchanged.
   */
  async listPublished({ page = 1, limit = 12 } = {}) {
    const offset = (page - 1) * limit;

    const { count, rows } = await BlogPost.findAndCountAll({
      where: { status: 'published' },
      attributes: PUBLIC_ATTRIBUTES,
      order: [['publishedAt', 'DESC']],
      limit,
      offset
    });

    const posts = await attachAuthorNames(rows.map((r) => r.toJSON()));

    return { posts, totalCount: count, page, totalPages: Math.ceil(count / limit) || 1 };
  }

  /** Public detail — 404s (via null) for anything not published, including drafts by slug guessing. */
  async getPublishedBySlug(slug) {
    const post = await BlogPost.findOne({
      where: { slug, status: 'published' },
      attributes: PUBLIC_ATTRIBUTES
    });
    if (!post) return null;
    const [withAuthor] = await attachAuthorNames([post.toJSON()]);
    return withAuthor;
  }

  /** Admin listing — every post regardless of status. */
  async listAll({ page = 1, limit = 20, status } = {}) {
    const offset = (page - 1) * limit;
    const where = status ? { status } : {};

    const { count, rows } = await BlogPost.findAndCountAll({
      where,
      order: [['updatedAt', 'DESC']],
      limit,
      offset
    });

    const posts = await attachAuthorNames(rows.map((r) => r.toJSON()));

    return { posts, totalCount: count, page, totalPages: Math.ceil(count / limit) || 1 };
  }

  async getById(id) {
    const post = await BlogPost.findByPk(id);
    if (!post) throw new Error('Post not found');
    return post;
  }

  async create(authorId, { title, excerpt, body, coverImageUrl, status = 'draft' }) {
    if (!title?.trim()) throw new Error('Title is required');
    if (!excerpt?.trim()) throw new Error('Excerpt is required');
    if (!body?.trim()) throw new Error('Body is required');

    const slug = await uniqueSlug(slugify(title));

    const post = await BlogPost.create({
      title: title.trim(),
      slug,
      excerpt: excerpt.trim(),
      body,
      coverImageUrl: coverImageUrl || null,
      authorId,
      status: status === 'published' ? 'published' : 'draft',
      publishedAt: status === 'published' ? new Date() : null
    });

    return post;
  }

  /**
   * Partial update. Re-slugging only happens if the title actually changed —
   * an admin fixing a typo in the body shouldn't silently break a URL that's
   * already been shared.
   */
  async update(id, { title, excerpt, body, coverImageUrl, status }) {
    const post = await BlogPost.findByPk(id);
    if (!post) throw new Error('Post not found');

    if (title !== undefined && title.trim() && title.trim() !== post.title) {
      post.title = title.trim();
      post.slug = await uniqueSlug(slugify(title), post.id);
    }
    if (excerpt !== undefined) post.excerpt = excerpt.trim();
    if (body !== undefined) post.body = body;
    if (coverImageUrl !== undefined) post.coverImageUrl = coverImageUrl || null;

    if (status !== undefined && status !== post.status) {
      post.status = status === 'published' ? 'published' : 'draft';
      if (post.status === 'published' && !post.publishedAt) {
        post.publishedAt = new Date();
      }
    }

    await post.save();
    return post;
  }

  async delete(id) {
    const post = await BlogPost.findByPk(id);
    if (!post) throw new Error('Post not found');
    await post.destroy();
    return post;
  }
}

module.exports = new BlogService();
