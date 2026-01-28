let active = null;

async function loadChats() {
  const r = await fetch("/chats");
  const chats = await r.json();
  const list = document.getElementById("chatList");
  list.innerHTML = "";
  chats.forEach(c => {
    const d = document.createElement("div");
    d.className = "chat-item";
    d.innerText = c._id;
    d.onclick = () => openChat(c._id);
    list.appendChild(d);
  });
}

async function openChat(n) {
  active = n;
  const r = await fetch("/messages/" + n);
  const msgs = await r.json();
  const box = document.getElementById("messages");
  box.innerHTML = "";
  msgs.forEach(m => {
    const d = document.createElement("div");
    d.className = "msg " + m.direction;
    d.innerText = m.text || "[media]";
    box.appendChild(d);
  });
}

async function sendReply() {
  const t = replyInput.value;
  if (!t || !active) return;
  await fetch("/reply", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ to:active, message:t })
  });
  replyInput.value="";
  openChat(active);
}

loadChats();
setInterval(loadChats, 5000);
