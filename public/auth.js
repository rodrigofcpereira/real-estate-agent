let currentUser = null;
let authInitialized = false;

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

async function handleSignup(e) {
  e.preventDefault();
  limparErroLogin();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (password.length < 6) {
    mostrarErroLogin("A senha deve ter pelo menos 6 caracteres.");
    return;
  }
  const btn = document.getElementById("login-btn");
  btn.disabled = true;
  btn.textContent = "Criando conta...";
  try {
    await auth.createUserWithEmailAndPassword(email, password);
  } catch (err) {
    mostrarErroLogin(tratarErroFirebase(err.code));
    btn.disabled = false;
    btn.textContent = "Criar conta";
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

function toggleAuthMode() {
  const isLogin = document.getElementById("login-btn").textContent === "Entrar";
  const toggle = document.getElementById("login-toggle");
  const title = document.getElementById("login-title");
  if (isLogin) {
    title.textContent = "Criar conta";
    document.getElementById("login-btn").textContent = "Criar conta";
    document.getElementById("login-btn").onclick = handleSignup;
    toggle.innerHTML = 'Já tem conta? <a href="#" onclick="toggleAuthMode();return false">Entrar</a>';
  } else {
    title.textContent = "Entrar";
    document.getElementById("login-btn").textContent = "Entrar";
    document.getElementById("login-btn").onclick = handleLogin;
    toggle.innerHTML = 'Não tem conta? <a href="#" onclick="toggleAuthMode();return false">Criar conta</a>';
  }
  limparErroLogin();
  document.getElementById("login-password").value = "";
}

auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) {
    document.getElementById("login-page").style.display = "none";
    document.getElementById("app-container").style.display = "flex";
    const emailEl = document.getElementById("user-email");
    if (emailEl) emailEl.textContent = user.email;
    if (typeof iniciarCarregamento === "function" && !authInitialized) {
      authInitialized = true;
      iniciarCarregamento();
    }
  } else {
    document.getElementById("login-page").style.display = "flex";
    document.getElementById("app-container").style.display = "none";
    authInitialized = false;
  }
});

function logout() {
  auth.signOut();
}
