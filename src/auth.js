const USERS_KEY = "pokedole:v2:users";
const SESSION_KEY = "pokedole:v2:active-user";
const AUTH_EVENT = "pokedole:auth-changed";

function readUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function normalizeUserId(identifier) {
  return String(identifier).trim().toLowerCase();
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function previousDayKey(date = new Date()) {
  const previous = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1));
  return previous.toISOString().slice(0, 10);
}

function publicUser(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

function emitAuthChange() {
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: getActiveUser() }));
}

export function subscribeAuth(listener) {
  const handler = (event) => listener(event.detail);
  window.addEventListener(AUTH_EVENT, handler);
  return () => window.removeEventListener(AUTH_EVENT, handler);
}

export function getActiveUser() {
  const id = localStorage.getItem(SESSION_KEY);
  if (!id) return null;
  return publicUser(readUsers()[id]);
}

export function registerUser(identifier, password) {
  const id = normalizeUserId(identifier);
  if (!id || !password) throw new Error("Enter a username/email and password.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");

  const users = readUsers();
  if (users[id]) throw new Error("That username/email already exists.");

  users[id] = {
    id,
    identifier: String(identifier).trim(),
    password,
    streak: 0,
    lastLoginDate: todayKey(),
    lastCompletionDate: null,
  };
  saveUsers(users);
  localStorage.setItem(SESSION_KEY, id);
  emitAuthChange();
  return getActiveUser();
}

export function loginUser(identifier, password) {
  const id = normalizeUserId(identifier);
  const users = readUsers();
  const user = users[id];
  if (!user || user.password !== password) throw new Error("Username/email or password is incorrect.");

  user.lastLoginDate = todayKey();
  users[id] = user;
  saveUsers(users);
  localStorage.setItem(SESSION_KEY, id);
  emitAuthChange();
  return publicUser(user);
}

export function logoutUser() {
  localStorage.removeItem(SESSION_KEY);
  emitAuthChange();
}

export function recordDailyCompletion() {
  const id = localStorage.getItem(SESSION_KEY);
  if (!id) return { user: null, updated: false, reason: "not-signed-in" };

  const users = readUsers();
  const user = users[id];
  if (!user) return { user: null, updated: false, reason: "missing-user" };

  const today = todayKey();
  if (user.lastCompletionDate === today) {
    return { user: publicUser(user), updated: false, reason: "already-completed" };
  }

  if (user.lastLoginDate !== today) {
    return { user: publicUser(user), updated: false, reason: "not-logged-in-today" };
  }

  user.streak = user.lastCompletionDate === previousDayKey() ? user.streak + 1 : 1;
  user.lastCompletionDate = today;
  users[id] = user;
  saveUsers(users);
  emitAuthChange();
  return { user: publicUser(user), updated: true, reason: "completed" };
}