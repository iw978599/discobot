export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'owner', 'root', 'system', 'support', 'help', 'moderator', 'mod', 'staff',
  'discobot', 'official', 'anonymous', 'guest', 'null', 'undefined', 'me', 'api', 'songs', 'song', 'user', 'users',
]);

// Passwords of ten or more characters that appear at the top of every leaked-password list.
const COMMON_PASSWORDS = new Set([
  '1234567890', '0123456789', '0987654321', '9876543210', '1111111111', '0000000000', '1234512345', '1122334455',
  '12345678910', '123456789a', '123456789q', '1234567891', '1234567899', '123123123123', '1q2w3e4r5t', '1q2w3e4r5t6y',
  'q1w2e3r4t5', 'qwertyuiop', 'qwertyuiop123', 'qwerty12345', 'qwerty123456', 'qwerty1234', 'asdfghjkl;', 'asdfghjkl1',
  'zxcvbnm123', '1qaz2wsx3edc', 'qazwsxedcrfv', 'password12', 'password123', 'password1234', 'password12345', 'passwordpassword',
  'password!!', 'password01', 'passw0rd123', 'p@ssw0rd123', 'p@ssword123', 'iloveyou12', 'iloveyou123', 'iloveyou1234',
  'letmein123', 'letmeinnow', 'welcome123', 'welcome1234', 'welcome2024', 'welcome2025', 'welcome2026', 'changeme123',
  'administrator', 'admin12345', 'admin123456', 'adminadmin', 'football123', 'baseball123', 'basketball', 'superman123',
  'batman1234', 'sunshine123', 'princess123', 'dragon1234', 'monkey1234', 'master1234', 'michael123', 'jennifer123',
  'liverpool1', 'liverpool123', 'manchester', 'starwars123', 'pokemon123', 'minecraft1', 'minecraft123', 'computer123',
  'internet123', 'whatever123', 'trustno1234', 'abcdefghij', 'abcdefghijk', 'abcd123456', 'abc1234567', 'abc123abc123',
  'aaaaaaaaaa', 'qqqqqqqqqq', 'zzzzzzzzzz', 'discobot123', 'discobot1234', 'discobotdiscobot', 'synthesizer', 'drummachine',
]);

export function checkUsername(username: unknown): string | null {
  if (typeof username !== 'string') return 'Choose a username.';
  if (username.length < 3 || username.length > 20) return 'A username is 3 to 20 characters long.';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(username)) return 'A username can use letters, numbers, - and _, and starts with a letter or number.';
  if (RESERVED_USERNAMES.has(username.toLowerCase())) return 'That username is not available.';
  return null;
}

export function checkPassword(password: unknown, username: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `A password is at least ${MIN_PASSWORD_LENGTH} characters long.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `A password is at most ${MAX_PASSWORD_LENGTH} characters long.`;
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered) || new Set(lowered).size < 4) return 'That password is too easy to guess. Choose another.';
  if (username && lowered.includes(username.toLowerCase())) return 'A password cannot contain your username.';
  return null;
}
