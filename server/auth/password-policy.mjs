const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', 'qwerty123',
  'admin123', 'letmein123', 'welcome123', 'dawnreach', 'dawnreach123',
]);

export function validatePassword(password, username, minLength = 10) {
  const value = String(password || '');
  const cleanUser = String(username || '').trim().toLowerCase();
  const requiredLength = Math.max(10, Number(minLength) || 10);
  if (value.length < requiredLength) throw new Error(`La contraseña debe tener al menos ${requiredLength} caracteres.`);
  if (value.length > 128) throw new Error('La contraseña no puede superar 128 caracteres.');
  if (COMMON_PASSWORDS.has(value.toLowerCase())) throw new Error('Esa contraseña es demasiado común. Elige otra.');
  if (cleanUser.length >= 3 && value.toLowerCase().includes(cleanUser)) {
    throw new Error('La contraseña no puede contener tu nombre de usuario.');
  }
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  if (classes < 3) throw new Error('Usa al menos tres tipos: minúsculas, mayúsculas, números o símbolos.');
  return true;
}
