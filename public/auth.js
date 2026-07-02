let currentUser = null;
let authInitialized = false;

let userData = null;

function mostrarErroLogin(msg) {
  const el = document.getElementById("login-error");
  if (el) { el.textContent = msg; el.style.display = "block"; }
}

function limparErroLogin() {
  const el = document.getElementById("login-error");
  if (el) el.style.display = "none";
}

async function handleLogin(e) {
  e.preventDefault();
  limparErroLogin();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const btn = document.getElementById("login-btn");
  btn.disabled = true;
  btn.textContent = "Entrando...";
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    mostrarErroLogin(tratarErroFirebase(err.code));
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
}

function tratarErroFirebase(code) {
  const map = {
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/weak-password": "Senha muito fraca (mínimo 6 caracteres).",
    "auth/invalid-email": "E-mail inválido.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde e tente novamente.",
  };
  return map[code] || "Erro ao autenticar. Tente novamente.";
}

function formatarBytes(bytes) {
  const b = Math.max(0, bytes || 0);
  if (b === 0) return '0 MB';
  const gb = b / (1024 * 1024 * 1024);
  if (gb >= 1) return gb.toFixed(2) + ' GB';
  const mb = b / (1024 * 1024);
  return mb.toFixed(1) + ' MB';
}

function atualizarStorageBar() {
  if (!userData) return;
  const used = userData.storageUsed || 0;
  const limit = userData.storageLimit || 10 * 1024 * 1024 * 1024;
  const pct = Math.min((used / limit) * 100, 100);
  const fill = document.getElementById("storageFill");
  const text = document.getElementById("storageText");
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = formatarBytes(used) + ' / ' + formatarBytes(limit);
  if (fill) {
    fill.classList.toggle('warning', pct >= 80 && pct < 95);
    fill.classList.toggle('danger', pct >= 95);
  }
}

async function verificarAcesso(user) {
  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists) {
      document.getElementById("app-container").style.display = "none";
      document.getElementById("expired-overlay").style.display = "flex";
      return;
    }
    userData = doc.data();
    const agora = firebase.firestore.Timestamp.now();
    if (userData.expiresAt && userData.expiresAt.toMillis() < agora.toMillis()) {
      document.getElementById("app-container").style.display = "none";
      document.getElementById("expired-overlay").style.display = "flex";
      return;
    }
    document.getElementById("login-page").style.display = "none";
    document.getElementById("app-container").style.display = "flex";
    document.getElementById("expired-overlay").style.display = "none";
    const emailEl = document.getElementById("user-email");
    if (emailEl) emailEl.textContent = user.email;
    atualizarStorageBar();
    if (typeof iniciarCarregamento === "function" && !authInitialized) {
      authInitialized = true;
      iniciarCarregamento();
    }
  } catch (err) {
    console.error("Erro ao verificar acesso:", err);
    document.getElementById("login-page").style.display = "none";
    document.getElementById("app-container").style.display = "flex";
    if (typeof iniciarCarregamento === "function" && !authInitialized) {
      authInitialized = true;
      iniciarCarregamento();
    }
  }
}

auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) {
    verificarAcesso(user);
  } else {
    document.getElementById("login-page").style.display = "flex";
    document.getElementById("app-container").style.display = "none";
    document.getElementById("expired-overlay").style.display = "none";
    authInitialized = false;
    userData = null;
  }
});

function logout() {
  auth.signOut();
}
