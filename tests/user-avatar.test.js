/**
 * Profile pictures: reading them consistently and Google photo sizing.
 */
const { avatarUrlOf, withAvatar } = require('../utils/userAvatar');
const { largerGooglePhoto } = require('../services/oauthAvatarService');

describe('avatarUrlOf', () => {
  test('reads the picture saved by the profile page', () => {
    expect(avatarUrlOf({ socialLinks: { profilePicture: 'https://cdn.example/p.jpg' } })).toBe('https://cdn.example/p.jpg');
    expect(avatarUrlOf({ socialLinks: { profilePicture: '/upload/p.jpg' } })).toBe('/upload/p.jpg');
  });

  test('works with Sequelize instances', () => {
    const user = { get: (key) => (key === 'socialLinks' ? { profilePicture: 'https://cdn.example/p.jpg' } : undefined) };
    expect(avatarUrlOf(user)).toBe('https://cdn.example/p.jpg');
  });

  test('no picture (or anything odd) means null, so the initial is shown', () => {
    expect(avatarUrlOf(null)).toBeNull();
    expect(avatarUrlOf({})).toBeNull();
    expect(avatarUrlOf({ socialLinks: {} })).toBeNull();
    expect(avatarUrlOf({ socialLinks: { profilePicture: '   ' } })).toBeNull();
    expect(avatarUrlOf({ socialLinks: { profilePicture: 'javascript:alert(1)' } })).toBeNull();
  });
});

describe('withAvatar', () => {
  test('adds avatarUrl and drops the raw socialLinks', () => {
    const out = withAvatar({ id: 1, firstname: 'Ada', socialLinks: { profilePicture: 'https://cdn.example/a.jpg', twitter: 'x' } });
    expect(out).toEqual({ id: 1, firstname: 'Ada', avatarUrl: 'https://cdn.example/a.jpg' });
  });

  test('leaves missing users alone', () => {
    expect(withAvatar(null)).toBeNull();
  });
});

describe('Google photos', () => {
  test('asks Google for a sharper photo than its 96px default', () => {
    expect(largerGooglePhoto('https://lh3.googleusercontent.com/a/abc=s96-c')).toBe('https://lh3.googleusercontent.com/a/abc=s256-c');
    expect(largerGooglePhoto('https://lh3.googleusercontent.com/a/abc')).toBe('https://lh3.googleusercontent.com/a/abc');
  });
});
